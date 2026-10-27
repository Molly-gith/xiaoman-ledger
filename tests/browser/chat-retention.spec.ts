import { test, expect, type Page } from "@playwright/test";
import { emptyLedger, exportLedger, fixedNow, openLedger, seedLedger } from "./ledger-helpers";
const day = 24 * 60 * 60 * 1000;
const input = (page: Page) => page.getByRole("textbox", { name: "记账或问小满", exact: true });
async function memoryRows(page: Page) {
  return page.evaluate(async () => new Promise<Record<string, { revision: number; conversation: { id: string; replyTo?: string }[]; preferences: unknown[]; companion: { tone: string }; clarification: unknown }>>((resolve, reject) => {
    const opening = indexedDB.open("xiaoman-assistant-memory-db", 2);
    opening.onsuccess = () => { const db = opening.result, tx = db.transaction("memory"), store = tx.objectStore("memory"), owner = store.get("localOwnerId"); const all: Record<string, { revision: number; conversation: { id: string; replyTo?: string }[]; preferences: unknown[]; companion: { tone: string }; clarification: unknown }> = {};
      owner.onsuccess = () => { for (const kind of ["personal", "family", "travel"]) { const read = store.get(JSON.stringify([owner.result, kind])); read.onsuccess = () => { all[kind] = read.result; }; } };
      tx.oncomplete = () => { db.close(); resolve(all); }; tx.onerror = () => reject(tx.error);
    }; opening.onerror = () => reject(opening.error);
  }));
}
async function seedMemory(page: Page) {
  await input(page).fill("等待读取完成"); await expect(page.getByRole("button", { name: "发送给小满", exact: true })).toBeEnabled();
  await page.evaluate(async ({ now, dayMs }) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("xiaoman-assistant-memory-db", 2);
    opening.onsuccess = () => { const db = opening.result, tx = db.transaction("memory", "readwrite"), store = tx.objectStore("memory"), owner = store.get("localOwnerId");
      owner.onsuccess = () => { for (const kind of ["personal", "family", "travel"]) store.put({ version: 2, ownerId: owner.result, ledgerKind: kind, revision: 10,
        conversation: [
          { id: "expired", role: "user", content: "过期聊天原文", createdAt: new Date(now - 91 * dayMs).toISOString() },
          { id: "kept", role: "assistant", content: "近期聊天保留", createdAt: new Date(now - 89 * dayMs).toISOString(), replyTo: "expired" }
        ], preferences: [{ id: "preference", keyword: "健身课", category: "健康", nature: "投资" }], clarification: { originalText: "过期补问原文", question: "旧补问" },
        companion: { tone: "gentle", remindersEnabled: false, dailyExpenseTarget: 50, lunchReference: 14, mutedUntil: null }
      }, JSON.stringify([owner.result, kind])); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    }; opening.onerror = () => reject(opening.error);
  }), { now: fixedNow.getTime(), dayMs: day });
}

test("opening clears expired text from every local book but leaves ledger and confirmed preferences", async ({ page }) => {
  let calls = 0; await page.route("**/api/ai/**", route => { calls++; return route.abort(); });
  const ledger = { ...emptyLedger(), transactions: [{ id: "old-ledger", type: "expense", amount: 35, category: "餐饮", date: "2025-01-01", note: "账目长期保留", icon: "记", source: "text", cycleId: null, nature: "消费", spendKind: "variable" }] };
  await seedLedger(page, ledger); await openLedger(page); await seedMemory(page); await page.reload();
  await expect(page.getByRole("button", { name: "查看历史对话", exact: true })).toBeVisible();
  const all = await memoryRows(page);
  for (const kind of ["personal", "family", "travel"]) {
    expect(all[kind].conversation).toEqual([expect.objectContaining({ id: "kept" })]);
    expect(all[kind].conversation[0].replyTo).toBeUndefined(); expect(all[kind].revision).toBe(11);
    expect(all[kind].preferences).toEqual([{ id: "preference", keyword: "健身课", category: "健康", nature: "投资" }]);
    expect(all[kind].companion.tone).toBe("gentle"); expect(all[kind].clarification).toBeNull();
  }
  await page.getByRole("button", { name: "查看历史对话", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("近期聊天保留"); await expect(page.getByRole("log")).not.toContainText("过期聊天原文");
  await page.getByRole("button", { name: "返回当前对话", exact: true }).click();
  expect((await exportLedger(page)).state.transactions).toEqual(ledger.transactions); expect(calls).toBe(0);
});

test("returning to the foreground expires newly old local history without touching preferences", async ({ page }) => {
  await page.route("**/api/ai/**", route => route.abort()); await openLedger(page); await seedMemory(page); await page.reload();
  await expect(page.getByRole("button", { name: "查看历史对话", exact: true })).toBeVisible();
  await page.clock.setSystemTime(new Date(fixedNow.getTime() + 2 * day));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await memoryRows(page)).personal.conversation.length).toBe(0);
  const all = await memoryRows(page);
  for (const kind of ["personal", "family", "travel"]) { expect(all[kind].conversation).toEqual([]); expect(all[kind].preferences).toHaveLength(1); expect(all[kind].companion.tone).toBe("gentle"); }
  await expect(page.getByRole("button", { name: "查看历史对话", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "记忆与偏好", exact: true }).click();
  await expect(page.getByRole("region", { name: "助手记忆与偏好" })).toContainText("聊天原文保留90天");
});

test("an expired current clarification cannot borrow another device's fresh source", async ({ page }) => {
  test.skip(process.env.AI_BROWSER_TEST !== "1", "Run against the AI-enabled mock endpoint build");
  const requests: { clarification?: unknown; memory: { recentMessages: unknown[] } }[] = [];
  await page.route("https://xiaoman-ai-test.example/api/ai/assistant", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: requests.length === 1
      ? { status: "clarification", question: "这次花了多少钱？" }
      : { status: "answer", answer: "请重新告诉我想记什么。", nextActions: [] } });
  });
  await openLedger(page);
  await input(page).fill("今天吃了午饭"); await page.getByRole("button", { name: "发送给小满", exact: true }).click();
  await expect(page.locator(".clarification")).toContainText("这次花了多少钱？");
  await expect(input(page)).toHaveValue("");
  await page.clock.setSystemTime(new Date(fixedNow.getTime() + 91 * day));
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("xiaoman-assistant-memory-db", 2);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction("memory", "readwrite"), store = tx.objectStore("memory"), owner = store.get("localOwnerId");
      owner.onsuccess = () => {
        const key = JSON.stringify([owner.result, "personal"]), read = store.get(key);
        read.onsuccess = () => {
          const current = read.result, clarification = { originalText: "另一设备刚买了咖啡", question: "这次花了多少钱？" };
          store.put({ ...current, revision: current.revision + 1, clarification,
            conversation: [...current.conversation, { id: "other-device-source", role: "assistant", content: clarification.question,
              createdAt: new Date().toISOString(), clarification }] }, key);
        };
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
    opening.onerror = () => reject(opening.error);
  }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await memoryRows(page)).personal.conversation.map(item => item.id)).toEqual(["other-device-source"]);
  expect((await memoryRows(page)).personal.clarification).toEqual({ originalText: "另一设备刚买了咖啡", question: "这次花了多少钱？" });
  await expect(input(page)).toHaveAttribute("placeholder", "比如：今天午饭35元");
  await input(page).fill("28元"); await page.getByRole("button", { name: "发送给小满", exact: true }).click();
  await expect(page.getByTestId("ai-answer")).toContainText("请重新告诉我想记什么。");
  expect(requests).toHaveLength(2);
  expect(requests[1].clarification).toBeUndefined();
  expect(requests[1].memory.recentMessages).toEqual([]);
});
