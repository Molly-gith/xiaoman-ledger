import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addExpense, emptyLedger, exportLedger, openLedger, seedLedger } from "./ledger-helpers";

const endpoint = "https://xiaoman-ai-test.example/api/ai/assistant";
const input = (page: Page) => page.getByRole("textbox", { name: "记账或问小满", exact: true });
const answer = (page: Page) => page.getByTestId("ai-answer");
const preview = (page: Page) => page.getByRole("region", { name: "待保存账目" });
const names = { personal: "个人账本", family: "家庭账本", travel: "旅行账本" } as const;
type Kind = keyof typeof names;
type Request = { protocolVersion: number; text: string; ledgerKind: Kind; memory: { recentMessages: { role: string; content: string }[]; previousQuery?: unknown }; clarification?: unknown; [key: string]: unknown };
const tx = (id: string, date: string, amount: number, category = "餐饮") => ({ id, type: "expense", amount, date, category, note: `${id}仅本机私人备注`, icon: "记", source: "text", cycleId: null, nature: "消费", spendKind: "variable" });
function fixture() {
  const empty = emptyLedger();
  const book = { profile: empty.profile, activeCycleId: empty.activeCycleId, cycles: empty.cycles, budgets: empty.budgets, transactions: empty.transactions,
    investmentAccounts: empty.investmentAccounts, investmentFlows: empty.investmentFlows, marketValueSnapshots: empty.marketValueSnapshots, settings: empty.settings };
  return { ...emptyLedger(), version: 4, transactions: [tx("personal-aug", "2026-08-05", 30), tx("personal-jul", "2026-07-05", 10), tx("personal-sep", "2026-09-05", 50, "购物")],
    otherLedgers: { family: { ...book, transactions: [tx("family-aug", "2026-08-05", 70), tx("family-jul", "2026-07-05", 20)] }, travel: book } };
}
async function send(page: Page, text: string) {
  await input(page).fill(text);
  await page.getByRole("button", { name: "发送给小满", exact: true }).click();
}
async function switchBook(page: Page, kind: Kind) {
  await page.getByRole("button", { name: /^切换账本，当前：/ }).click();
  await page.getByRole("dialog", { name: "切换账本", exact: true }).getByRole("button", { name: names[kind], exact: true }).click();
  await expect(page.getByRole("button", { name: `切换账本，当前：${names[kind]}`, exact: true })).toBeVisible();
}
async function history(page: Page, kind: Kind) {
  const details = page.locator(".conversation-history");
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
  return page.getByRole("log", { name: `${names[kind]}对话记录`, exact: true });
}
async function memoryPanel(page: Page) {
  await page.getByRole("button", { name: "记忆与偏好", exact: true }).click();
  const panel = page.getByRole("region", { name: "助手记忆与偏好", exact: true });
  await expect(panel.getByRole("button", { name: "添加分类偏好", exact: true })).toBeVisible();
  return panel;
}
async function exportMemory(page: Page) {
  const panel = await memoryPanel(page);
  await panel.locator("summary").filter({ hasText: "助手记忆备份" }).click();
  const pending = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出助手记忆", exact: true }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).toBeTruthy();
  const backup = JSON.parse(await readFile(path!, "utf8"));
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  return { backup, path: path! };
}
const mockDraft = (extra: Record<string, unknown> = {}) => ({ type: "expense", amount: 200, category: "健康", occurred_at: "2026-09-15", note: "健身课", nature_suggestion: "消费", confidence: 0.9, ambiguous: false, ...extra });
const drafts = (items: unknown[]) => ({ status: "transactions", drafts: items, modelVersion: "test-only", workflowVersion: "test-only" });
const ledgerContent = (state: Record<string, unknown>) => Object.fromEntries(Object.entries(state).filter(([key]) => key !== "exportedAt"));

test("local dining follow-ups compare months and read another ledger without switching or changing it", async ({ page }) => {
  let calls = 0;
  await page.route(endpoint, route => { calls++; return route.abort(); });
  await seedLedger(page, fixture()); await openLedger(page);
  const before = (await exportLedger(page)).state;
  await send(page, "上个月餐饮花了多少？");
  await expect(answer(page)).toContainText("2026-08-01 至 2026-08-31");
  await expect(answer(page)).toContainText("支出30元");
  await send(page, "跟前一个月比呢");
  await expect(answer(page)).toContainText("前一个完整月（2026-07-01 至 2026-07-31）支出10元");
  await expect(answer(page)).toContainText("差额：支出20元");
  await send(page, "只看家庭账本");
  await expect(answer(page)).toContainText("家庭账本");
  await expect(answer(page)).toContainText("支出70元");
  await expect(answer(page)).toContainText("差额：支出50元");
  await expect(page.getByRole("button", { name: "切换账本，当前：个人账本", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/conversation-family-read-only.png", fullPage: true });
  expect(ledgerContent((await exportLedger(page)).state)).toEqual(ledgerContent(before));
  expect(calls).toBe(0);
});

test("refresh retains query context, each book has its own history, and clearing a conversation keeps the ledger", async ({ page }) => {
  await seedLedger(page, fixture()); await openLedger(page);
  await send(page, "上个月餐饮花了多少？"); await expect(answer(page)).toContainText("支出30元");
  await page.reload();
  await expect(await history(page, "personal")).toContainText("上个月餐饮花了多少？");
  await expect(page.locator(".conversation-history")).toContainText("当时的回答");
  await send(page, "跟前一个月比呢"); await expect(answer(page)).toContainText("差额：支出20元");
  await switchBook(page, "family");
  await expect(page.locator(".conversation-history")).toHaveCount(0);
  await send(page, "上个月餐饮花了多少？"); await expect(answer(page)).toContainText("支出70元");
  const familyHistory = await history(page, "family");
  await expect(familyHistory).not.toContainText("支出30元");
  await switchBook(page, "personal");
  await expect(await history(page, "personal")).toContainText("差额：支出20元");
  await expect(await history(page, "personal")).not.toContainText("支出70元");
  const before = (await exportLedger(page)).state;
  const panel = await memoryPanel(page);
  await panel.getByRole("button", { name: "清除本账本对话", exact: true }).click();
  await panel.getByRole("button", { name: "确认清除对话", exact: true }).click();
  await expect(panel).toContainText("本账本对话已清除");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".conversation-history")).toHaveCount(0);
  expect(ledgerContent((await exportLedger(page)).state)).toEqual(ledgerContent(before));
  await switchBook(page, "family");
  await expect(await history(page, "family")).toContainText("支出70元");
});

test("a stale tab rejects a conversation write instead of overwriting another tab's history", async ({ page, context }) => {
  await seedLedger(page, fixture()); await openLedger(page);
  const stale = await context.newPage(); await openLedger(stale);
  // Ensure both have finished reading the same initial memory revision.
  await input(stale).fill("上个月餐饮花了多少？");
  await expect(stale.getByRole("button", { name: "发送给小满", exact: true })).toBeEnabled();
  await send(page, "本月支出多少？"); await expect(answer(page)).toContainText("支出50元");
  await stale.getByRole("button", { name: "发送给小满", exact: true }).click();
  await expect(stale.getByRole("alert")).toContainText("其他页面");
  await expect(input(stale)).toHaveValue("上个月餐饮花了多少？");
  await expect(answer(stale)).toHaveCount(0);
  await stale.reload();
  const log = await history(stale, "personal");
  await expect(log).toContainText("本月支出多少？");
  await expect(log).not.toContainText("上个月餐饮花了多少？");
});

test("a query reads the latest saved records when another tab added an expense", async ({ page, context }) => {
  await openLedger(page);
  const other = await context.newPage(); await openLedger(other);
  await addExpense(other, "35", "另一个页面的新午饭");
  await send(page, "本月支出多少？");
  await expect(answer(page)).toContainText("支出35元");
  await expect(answer(page)).not.toContainText("没有匹配");
});

test("a rejected stale-tab clear preserves conversation memory as well as newer ledger records", async ({ page, context }) => {
  await openLedger(page);
  await send(page, "本月支出多少？"); await expect(answer(page)).toBeVisible();
  const before = (await exportMemory(page)).backup;
  const stale = await context.newPage(); await openLedger(stale);
  await expect(await history(stale, "personal")).toContainText("本月支出多少？");
  await addExpense(page, "35", "已保存的新账目");
  await stale.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await stale.getByRole("button", { name: "清空这台设备的数据", exact: true }).click();
  await stale.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(stale.getByRole("alert")).toContainText("其他页面更新");
  expect((await exportMemory(page)).backup.ledgers).toEqual(before.ledgers);
  expect((await exportLedger(page)).state.transactions).toHaveLength(1);
});

test("320px and reduced viewport keep conversation, preference editing and modal controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seedLedger(page, fixture()); await openLedger(page);
  await send(page, "上个月餐饮花了多少？"); await expect(answer(page)).toContainText("支出30元");
  await input(page).focus();
  // A reduced viewport exercises the layout constraint, not a claim of testing a real OS keyboard.
  await page.setViewportSize({ width: 320, height: 320 });
  await input(page).fill("跟前一个月比呢");
  await page.getByRole("button", { name: "发送给小满", exact: true }).click();
  await expect(answer(page)).toContainText("差额：支出20元");
  const panel = await memoryPanel(page);
  await panel.getByRole("button", { name: "添加分类偏好", exact: true }).click();
  await panel.getByLabel("关键词（必填）", { exact: true }).fill("健身课");
  await panel.getByRole("combobox", { name: "性质（选填）", exact: true }).selectOption("投资");
  await panel.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(panel).toContainText("分类偏好已保存");
  const sizes = await page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!;
    const bounds = sheet.getBoundingClientRect();
    return { documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, left: bounds.left, right: bounds.right, sheetWidth: sheet.scrollWidth, clientWidth: sheet.clientWidth };
  });
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.left).toBeGreaterThanOrEqual(0); expect(sizes.right).toBeLessThanOrEqual(321);
  expect(sizes.sheetWidth).toBeLessThanOrEqual(sizes.clientWidth + 1);
  await page.screenshot({ path: "test-results/conversation-preference-320px.png" });
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await expect(input(page)).toBeVisible();
});

test.describe("conversation protocol with mocked AI", () => {
  test.skip(process.env.AI_BROWSER_TEST !== "1", "Run against the AI-enabled mock endpoint build");

  test("preference confirmation, explanation, edit and delete affect only new drafts in their own book", async ({ page }) => {
    let calls = 0;
    await page.route(endpoint, route => { calls++; return route.fulfill({ json: drafts([mockDraft()]) }); });
    await openLedger(page);
    await send(page, "记住，以后健身课算投资");
    const proposal = page.getByRole("region", { name: "待确认分类偏好" });
    await expect(proposal).toContainText("投资");
    await expect(proposal.getByRole("button", { name: "确认记住", exact: true })).toBeVisible();
    expect(calls).toBe(0);
    expect((await exportMemory(page)).backup.ledgers.personal.preferences).toEqual([]);
    await proposal.getByRole("button", { name: "确认记住", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await switchBook(page, "family");
    const familyPanel = await memoryPanel(page);
    await expect(familyPanel).toContainText("还没有保存偏好");
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await switchBook(page, "personal");
    await page.reload();
    await send(page, "今天健身课200元");
    await expect(preview(page)).toContainText("支出 · 投资");
    await expect(preview(page).locator(".preference-reason")).toContainText("本账本保存的“健身课”偏好");
    await preview(page).getByRole("button", { name: "保存这笔", exact: true }).click();
    await expect(preview(page)).toHaveCount(0);
    const original = (await exportLedger(page)).state.transactions[0];
    expect(original.nature).toBe("投资");
    let panel = await memoryPanel(page);
    await panel.getByRole("button", { name: "修改偏好：健身课", exact: true }).click();
    await panel.getByRole("combobox", { name: "性质（选填）", exact: true }).selectOption("消费");
    await panel.getByRole("button", { name: "保存偏好", exact: true }).click();
    await expect(panel).toContainText("分类偏好已保存");
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await send(page, "今天健身课200元");
    await expect(preview(page)).toContainText("支出 · 消费");
    await expect(preview(page).locator(".preference-reason")).toContainText("建议性质为消费");
    await preview(page).getByRole("button", { name: "不保存", exact: true }).click();
    panel = await memoryPanel(page);
    await panel.getByRole("button", { name: "删除偏好：健身课", exact: true }).click();
    await expect(panel).toContainText("偏好已删除");
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await send(page, "今天健身课200元");
    await expect(preview(page)).toBeVisible(); await expect(preview(page).locator(".preference-reason")).toHaveCount(0);
    await preview(page).getByRole("button", { name: "不保存", exact: true }).click();
    expect((await exportLedger(page)).state.transactions).toEqual([original]);
    await switchBook(page, "family");
    panel = await memoryPanel(page); await expect(panel).toContainText("还没有保存偏好");
    expect(calls).toBe(3);
  });

  test("pending clarification survives refresh and reset clears it persistently", async ({ page }) => {
    const requests: Request[] = [];
    await page.route(endpoint, route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: requests.length === 2 ? drafts([mockDraft({ amount: 28, category: "餐饮", note: "午饭" })]) : { status: "clarification", question: "这次午饭花了多少钱？" } });
    });
    await openLedger(page); await send(page, "今天吃了午饭");
    await expect(page.locator(".clarification")).toContainText("这次午饭花了多少钱？");
    await page.reload();
    await expect(page.locator(".clarification")).toContainText("这次午饭花了多少钱？");
    await send(page, "28元");
    await expect(preview(page)).toContainText("¥28.00");
    expect(requests[1].clarification).toEqual({ originalText: "今天吃了午饭", question: "这次午饭花了多少钱？", answer: "28元" });
    expect((await exportLedger(page)).state.transactions).toEqual([]);
    await preview(page).getByRole("button", { name: "不保存", exact: true }).click();
    await send(page, "今天吃了午饭"); await expect(page.locator(".clarification")).toBeVisible();
    await page.getByRole("button", { name: "重新说一笔", exact: true }).click();
    await expect(page.locator(".clarification")).toHaveCount(0);
    const { backup } = await exportMemory(page);
    expect(backup.ledgers.personal.clarification).toBeNull();
    await page.reload(); await expect(page.locator(".clarification")).toHaveCount(0);
  });

  test("clarification keeps the original one-time nature override ahead of a saved preference", async ({ page }) => {
    let calls = 0;
    await page.route(endpoint, route => {
      calls++;
      return route.fulfill({ json: calls === 1 ? { status: "clarification", question: "这次健身课花了多少钱？" } : drafts([mockDraft()]) });
    });
    await openLedger(page); await send(page, "以后健身课算投资");
    await page.getByRole("region", { name: "待确认分类偏好" }).getByRole("button", { name: "确认记住", exact: true }).click();
    await expect(page.getByRole("region", { name: "待确认分类偏好" })).toHaveCount(0);
    await send(page, "健身课，这次不算投资");
    await expect(page.locator(".clarification")).toContainText("这次健身课花了多少钱？");
    await send(page, "200元");
    await expect(preview(page)).toContainText("支出 · 消费");
    await expect(preview(page).locator(".preference-reason")).toHaveCount(0);
    expect((await exportLedger(page)).state.transactions).toEqual([]);
  });

  test("V2 sends at most eight messages from this book and never sends full ledger records", async ({ page }) => {
    const requests: Request[] = [];
    await page.route(endpoint, route => {
      expect(route.request().headers().authorization).toBeUndefined();
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { status: "answer", answer: "可以记账、查账，也可以管理分类偏好。", nextActions: [] } });
    });
    await seedLedger(page, fixture()); await openLedger(page);
    await switchBook(page, "family");
    await send(page, "请说明小满有哪些功能，家庭独有话题"); await expect(answer(page)).toBeVisible();
    await switchBook(page, "personal");
    for (let i = 0; i < 6; i++) { await send(page, `请说明小满有哪些功能，第${i}个个人话题`); await expect(answer(page)).toBeVisible(); }
    const request = requests.at(-1)!;
    expect(request.protocolVersion).toBe(2); expect(request.ledgerKind).toBe("personal");
    expect(Object.keys(request).sort()).toEqual(["context", "defaultRange", "ledgerKind", "memory", "protocolVersion", "text"]);
    expect(request.memory.recentMessages).toHaveLength(8);
    expect(request.memory.recentMessages.filter(message => message.role === "user").map(message => message.content)).toEqual([1, 2, 3, 4].map(i => `请说明小满有哪些功能，第${i}个个人话题`));
    expect(request.memory.recentMessages.every(message => message.content.length <= 1000)).toBe(true);
    expect(JSON.stringify(request)).not.toMatch(/家庭独有话题|仅本机私人备注|transactions|otherLedgers|ownerId|personal-aug|family-aug|apiKey/);
    expect(requests[1].memory.recentMessages).toEqual([]);
  });

  test("a model query is validated and executed against local records while an invalid plan cannot run", async ({ page }) => {
    const requests: Request[] = [];
    const plan = { range: { startDate: "2026-08-01", endDate: "2026-08-31" }, ledgerKind: "family", type: "expense", categories: ["餐饮"], metric: "total" };
    await page.route(endpoint, route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { status: "query", plan: requests.length === 1 ? plan : { ...plan, sql: "DELETE FROM transactions" } } }); });
    await seedLedger(page, fixture()); await openLedger(page);
    const before = (await exportLedger(page)).state;
    await send(page, "请帮我理解家里上次的吃饭开销");
    await expect(answer(page)).toContainText("家庭账本"); await expect(answer(page)).toContainText("支出70元");
    await expect(answer(page)).toContainText("金额由本机账目计算");
    await expect(page.getByRole("button", { name: "切换账本，当前：个人账本", exact: true })).toBeVisible();
    await send(page, "请继续帮我理解这些开销");
    await expect(page.getByRole("alert")).toContainText("可靠结果");
    await expect(input(page)).toHaveValue("请继续帮我理解这些开销");
    await expect(answer(page)).toHaveCount(0);
    expect(ledgerContent((await exportLedger(page)).state)).toEqual(ledgerContent(before));
    expect(requests).toHaveLength(2);
    expect(requests[1].memory.previousQuery).toEqual(plan);
  });
});
