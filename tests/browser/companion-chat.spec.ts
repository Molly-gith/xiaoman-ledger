import { test, expect, type Page } from "@playwright/test";
import { addExpense, emptyLedger, exportLedger, openLedger, seedLedger } from "./ledger-helpers";

const endpoint = "https://xiaoman-ai-test.example/api/ai/assistant";
const composer = (page: Page) => page.getByRole("textbox", { name: "记账或问小满", exact: true });
const log = (page: Page, name = "个人账本") => page.getByRole("log", { name: name + "对话记录", exact: true });
const preferences = (page: Page) => page.locator(".companion-settings");
const openHistory = (page: Page) => page.getByRole("button", { name: "查看历史对话", exact: true }).click();
const returnCurrent = (page: Page) => page.getByRole("button", { name: "返回当前对话", exact: true }).click();
const defaults: { tone: "playful" | "gentle" | "plain"; remindersEnabled: boolean; lunchReference: number | null; dailyExpenseTarget: number | null; mutedUntil: string | null } = { tone: "playful", remindersEnabled: true, lunchReference: null, dailyExpenseTarget: null, mutedUntil: null };
const draft = { type: "expense", amount: 28, category: "餐饮", occurred_at: "2026-09-15", note: "奶茶", nature_suggestion: "消费", confidence: .9, ambiguous: false };
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "发送给小满", exact: true }).click();
}
async function setMemory(page: Page, conversation: unknown[], companion = defaults) {
  await composer(page).fill("等记忆就绪");
  await expect(page.getByRole("button", { name: "发送给小满", exact: true })).toBeEnabled();
  await composer(page).fill("");
  await page.evaluate(async ({ conversation, companion }) => {
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open("xiaoman-assistant-memory-db", 2);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction("memory", "readwrite"), store = tx.objectStore("memory");
        const owner = store.get("localOwnerId");
        owner.onsuccess = () => store.put({ version: 2, ownerId: owner.result, ledgerKind: "personal", revision: 10, conversation, preferences: [], clarification: null, companion }, JSON.stringify([owner.result, "personal"]));
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  }, { conversation, companion });
  await page.reload();
  await expect(composer(page)).toBeVisible();
}
async function storedMemory(page: Page) {
  return page.evaluate(async () => new Promise<{ conversation: { id: string; content: string; reminderId?: string; replyTo?: string }[]; companion: typeof defaults }>((resolve, reject) => {
    const opening = indexedDB.open("xiaoman-assistant-memory-db", 2);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction("memory"), store = tx.objectStore("memory");
      const owner = store.get("localOwnerId"); owner.onsuccess = () => {
        const read = store.get(JSON.stringify([owner.result, "personal"]));
        read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      }; tx.oncomplete = () => db.close();
    };
  }));
}
async function switchBook(page: Page, name: string) {
  await page.getByRole("button", { name: /^切换账本，当前：/ }).click();
  await page.getByRole("dialog", { name: "切换账本", exact: true }).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("button", { name: "切换账本，当前：" + name, exact: true })).toBeVisible();
}

test("refresh starts empty while all history remains available by page and Hong Kong date", async ({ page }) => {
  await openLedger(page);
  const messages = Array.from({ length: 50 }, (_, index) => ({ id: "archive-" + index, role: index % 2 ? "assistant" : "user",
    content: "历史消息编号" + String(index).padStart(2, "0"), createdAt: index < 30 ? "2026-08-01T12:00:00.000Z" : "2026-09-14T18:00:00.000Z" }));
  await setMemory(page, messages);
  await expect(log(page).locator(".conversation-message")).toHaveCount(0);
  await expect(log(page)).not.toContainText("历史消息编号49");
  await openHistory(page);
  await expect(log(page).locator(".conversation-message")).toHaveCount(20);
  await expect(log(page)).toContainText("历史消息编号49");
  await expect(composer(page)).toBeHidden();
  await log(page).getByRole("button", { name: "加载更早的对话", exact: true }).click();
  await expect(log(page).locator(".conversation-message")).toHaveCount(40);
  await log(page).getByRole("button", { name: "加载更早的对话", exact: true }).click();
  await expect(log(page)).toContainText("历史消息编号00");
  await page.getByText("按日期找对话", { exact: true }).click();
  await page.getByLabel("对话日期（北京时间）", { exact: true }).fill("2026-08-01");
  await expect(log(page)).toContainText("历史消息编号29");
  await expect(log(page)).not.toContainText("历史消息编号49");
  await page.getByLabel("对话日期（北京时间）", { exact: true }).fill("2026-09-15");
  await expect(log(page)).toContainText("历史消息编号49");
  await page.getByLabel("对话日期（北京时间）", { exact: true }).fill("2026-09-14");
  await expect(log(page)).toContainText("这一天还没有保存的对话");
  await returnCurrent(page);
  await expect(log(page).locator(".conversation-message")).toHaveCount(0);
  await send(page, "本月支出多少？");
  await expect(page.getByTestId("ai-answer")).toBeVisible();
  const persisted = await storedMemory(page);
  expect(persisted.conversation).toHaveLength(52);
  expect(persisted.conversation[0].content).toBe("历史消息编号00");
  await openHistory(page); await expect(log(page)).toContainText("本月支出多少？");
  await returnCurrent(page); await expect(log(page)).toContainText("本月支出多少？");
  await page.reload();
  await expect(log(page).locator(".conversation-message")).toHaveCount(0);
  await openHistory(page); await expect(log(page)).toContainText("本月支出多少？");
  await returnCurrent(page); await expect(log(page).locator(".conversation-message")).toHaveCount(0);
});

test("companion preferences allow zero daily target, persist and stay in their own book", async ({ page }) => {
  await openLedger(page);
  await preferences(page).locator(":scope > summary").click();
  await preferences(page).getByRole("radio", { name: "温柔", exact: true }).check();
  await preferences(page).getByText("生活基准 · 选填", { exact: true }).click();
  await preferences(page).getByLabel("一顿午餐（元，选填）", { exact: true }).fill("14");
  await preferences(page).getByLabel("每天花费目标（元，选填）", { exact: true }).fill("0");
  await preferences(page).getByRole("checkbox", { name: "今天少唠叨", exact: true }).check();
  await preferences(page).getByRole("button", { name: "保存陪伴偏好", exact: true }).click();
  await expect(preferences(page)).not.toHaveAttribute("open", "");
  expect((await storedMemory(page)).companion).toMatchObject({ tone: "gentle", lunchReference: 14, dailyExpenseTarget: 0, mutedUntil: "2026-09-15" });
  await page.reload(); await preferences(page).locator(":scope > summary").click();
  await expect(preferences(page).getByRole("radio", { name: "温柔", exact: true })).toBeChecked();
  await preferences(page).getByText("生活基准 · 选填", { exact: true }).click();
  await expect(preferences(page).getByLabel("一顿午餐（元，选填）", { exact: true })).toHaveValue("14");
  await switchBook(page, "家庭账本"); await preferences(page).locator(":scope > summary").click();
  await expect(preferences(page).getByRole("radio", { name: "轻毒舌", exact: true })).toBeChecked();
  await expect(preferences(page).getByRole("checkbox", { name: "今天少唠叨", exact: true })).not.toBeChecked();
  await preferences(page).getByText("生活基准 · 选填", { exact: true }).click();
  await expect(preferences(page).getByLabel("一顿午餐（元，选填）", { exact: true })).toHaveValue("");
});

test("reminders persist once per threshold and a later entry can surface another unseen fact", async ({ page }) => {
  const empty = emptyLedger();
  const blank = { profile: null, activeCycleId: null, cycles: [], budgets: [], transactions: [], investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [], salaryBudget: null, settings: empty.settings };
  const salaryBudget = { enabled: true, periodMode: "calendar_month", salaryDay: null, expectedSalary: 100, percentages: { 消费: 70, 浪费: 5, 投资: 25 }, periodOverride: null };
  const expense = { id: "expense-before", type: "expense", amount: 56, category: "餐饮", date: "2026-09-15", note: "已记花费", icon: "记", source: "text", cycleId: null, nature: "消费", spendKind: "variable" };
  await seedLedger(page, { ...empty, version: 4, salaryBudget, transactions: [expense], otherLedgers: { family: blank, travel: blank } });
  await openLedger(page);
  await setMemory(page, [], { ...defaults, dailyExpenseTarget: 50 });
  await expect(log(page)).toContainText("已达到八成");
  await expect.poll(async () => (await storedMemory(page)).conversation.filter(item => item.reminderId).length).toBe(1);
  await addExpense(page, "1", "接下来一笔");
  await expect(log(page)).toContainText("超过你设置的日支出参考目标");
  let reminders = (await storedMemory(page)).conversation.filter(item => item.reminderId);
  expect(reminders).toHaveLength(2); expect(new Set(reminders.map(item => item.reminderId)).size).toBe(2);
  await page.reload(); await expect(log(page).locator(".conversation-message")).toHaveCount(0);
  await openHistory(page); await expect(log(page)).toContainText("已达到八成");
  await expect(log(page).getByRole("button", { name: "今天少唠叨", exact: true })).toHaveCount(0);
  await returnCurrent(page);
  reminders = (await storedMemory(page)).conversation.filter(item => item.reminderId);
  expect(reminders).toHaveLength(2);
  await preferences(page).locator(":scope > summary").click();
  await preferences(page).getByRole("checkbox", { name: "今天少唠叨", exact: true }).check();
  await preferences(page).getByRole("button", { name: "保存陪伴偏好", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "今天安静陪你" })).toBeVisible();
  await addExpense(page, "50", "安静时跨过更高阈值");
  expect((await storedMemory(page)).conversation.filter(item => item.reminderId)).toHaveLength(2);
});

test.describe("continuous companion with mocked AI", () => {
  test.skip(process.env.AI_BROWSER_TEST !== "1", "Uses only the configured mock AI endpoint");
  test("a tired follow-up sees the saved milk tea and its receipt without adding a second expense", async ({ page }) => {
    const requests: { text: string; memory: { recentMessages: { content: string }[] }; companion?: unknown }[] = [];
    await page.route(endpoint, route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: requests.length === 1 ? { status: "transactions", drafts: [draft], modelVersion: "mock", workflowVersion: "mock" }
        : { status: "answer", answer: "那今天就好好享受这杯吧。累了想喝点喜欢的，不需要每次都给自己判分。", nextActions: [] } });
    });
    await openLedger(page); await send(page, "今天奶茶28元");
    await page.getByRole("region", { name: "待保存账目", exact: true }).getByRole("button", { name: "保存这笔", exact: true }).click();
    await expect(log(page)).toContainText("已确认，1 笔账目已保存");
    await composer(page).fill("今天累就是想喝");
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "账单", exact: true }).click();
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "记账", exact: true }).click();
    await expect(composer(page)).toHaveValue("今天累就是想喝");
    await expect(log(page)).toContainText("已确认，1 笔账目已保存");
    await send(page, "今天累就是想喝");
    await expect(page.getByTestId("ai-answer")).toContainText("好好享受这杯");
    expect(requests[1].memory.recentMessages.map(item => item.content).join("\n")).toContain("今天奶茶28元");
    expect(requests[1].memory.recentMessages.map(item => item.content).join("\n")).toContain("已确认，1 笔账目已保存");
    expect(requests[1].companion).toBeTruthy();
    await expect(log(page)).toContainText("今天累就是想喝");
    await expect(page.locator(".answer-copy,.conversation-history")).toHaveCount(0);
    expect((await exportLedger(page)).state.transactions).toHaveLength(1);
    await page.reload(); await expect(log(page).locator(".conversation-message")).toHaveCount(0);
    await openHistory(page); await expect(log(page)).toContainText("好好享受这杯");
    await expect(page.getByRole("button", { name: "保存这笔", exact: true })).toHaveCount(0);
  });
  test("chatting does not discard the pending draft and double confirmation still saves once", async ({ page }) => {
    let calls = 0;
    await page.route(endpoint, route => { calls++; return route.fulfill({ json: calls === 1
      ? { status: "transactions", drafts: [draft], modelVersion: "mock", workflowVersion: "mock" }
      : { status: "answer", answer: "可以先想一想，这笔还没保存。", nextActions: [] } }); });
    await page.setViewportSize({ width: 320, height: 568 }); await openLedger(page);
    await send(page, "奶茶28元"); await expect(page.getByRole("region", { name: "待保存账目", exact: true })).toBeVisible();
    await composer(page).fill("还没发出的想法");
    await openHistory(page);
    await expect(log(page)).toContainText("尚未保存");
    await expect(composer(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "保存这笔", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "修改第1笔", exact: true })).toHaveCount(0);
    expect((await exportLedger(page)).state.transactions).toHaveLength(0);
    await returnCurrent(page);
    await expect(composer(page)).toHaveValue("还没发出的想法");
    await expect(page.getByRole("region", { name: "待保存账目", exact: true })).toBeVisible();
    await send(page, "先陪我聊一句"); await expect(page.getByTestId("ai-answer")).toContainText("还没保存");
    const pending = page.getByRole("region", { name: "待保存账目", exact: true });
    await expect(pending).toContainText("¥28.00");
    await pending.getByRole("button", { name: "保存这笔", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(pending).toHaveCount(0);
    await expect(log(page)).toContainText("已确认，1 笔账目已保存");
    await page.setViewportSize({ width: 320, height: 320 }); await composer(page).fill("还想继续聊");
    await page.getByRole("button", { name: "发送给小满", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "发送给小满", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await exportLedger(page)).state.transactions).toHaveLength(1);
    expect(calls).toBe(2);
  });
});
