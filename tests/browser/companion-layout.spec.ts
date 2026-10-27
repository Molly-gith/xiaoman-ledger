import { test, expect, type Page } from "@playwright/test";
import { openLedger } from "./ledger-helpers";

const input = (page: Page) => page.getByRole("textbox", { name: "记账或问小满", exact: true });
const send = (page: Page) => page.getByRole("button", { name: "发送给小满", exact: true });
const conversation = (page: Page) => page.getByRole("log", { name: "个人账本对话记录", exact: true });

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function seedLongConversation(page: Page) {
  // Wait until the fresh local identity is ready, then seed only this test context.
  await input(page).fill("等待本机记忆就绪");
  await expect(send(page)).toBeEnabled();
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("xiaoman-assistant-memory-db", 2);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("memory", "readwrite"), store = tx.objectStore("memory");
      const owner = store.get("localOwnerId");
      owner.onsuccess = () => store.put({
        version: 2, ownerId: owner.result, ledgerKind: "personal", revision: 10,
        conversation: Array.from({ length: 50 }, (_, index) => ({
          id: `layout-history-${index}`, role: index % 2 ? "assistant" : "user",
          content: `历史消息${index}：这是一段用来检查手机对话阅读和翻页的虚拟内容。`.repeat(3),
          createdAt: "2026-09-15T04:00:00.000Z",
        })),
        preferences: [], clarification: null,
        companion: { tone: "playful", remindersEnabled: true, dailyExpenseTarget: null, lunchReference: null, mutedUntil: null },
      }, JSON.stringify([owner.result, "personal"]));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await expect(conversation(page).locator(".conversation-message")).toHaveCount(0);
}

test.describe("companion responsive layout", () => {
  test.beforeEach(async ({ page }) => {
    // A layout check must never spend model credit, including in a live-endpoint build.
    await page.route("**/api/ai/**", route => route.fulfill({ status: 503, json: { error: "layout_test_no_model" } }));
  });

  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 768, height: 900 }]) {
    test(`empty start keeps the composer close and visible at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openLedger(page);
      await expect(page.locator(".chat-welcome")).toBeVisible();
      await expect(input(page)).toBeInViewport({ ratio: 1 });
      await expect(send(page)).toBeInViewport({ ratio: 1 });
      const welcome = await page.locator(".chat-welcome").boundingBox();
      const composer = await page.locator(".natural-composer").boundingBox();
      expect(welcome).not.toBeNull(); expect(composer).not.toBeNull();
      // A comfortable separation is fine; hundreds of empty pixels are not.
      expect(composer!.y - (welcome!.y + welcome!.height)).toBeLessThanOrEqual(64);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("archived history scrolls locally and returning restores a compact current composer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLedger(page); await seedLongConversation(page);
    await page.getByRole("button", { name: "查看历史对话", exact: true }).click();
    await expect(conversation(page).locator(".conversation-message")).toHaveCount(20);
    const initialPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const dimensions = await conversation(page).evaluate(element => ({ visible: element.clientHeight, all: element.scrollHeight }));
    expect(dimensions.all).toBeGreaterThan(dimensions.visible * 2);
    await expect(input(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "返回当前对话", exact: true })).toBeInViewport({ ratio: 1 });
    await conversation(page).evaluate(element => { element.scrollTop = 0; });
    await conversation(page).getByRole("button", { name: "加载更早的对话", exact: true }).click();
    await expect(conversation(page).locator(".conversation-message")).toHaveCount(40);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(initialPageHeight + 64);
    await page.getByRole("button", { name: "返回当前对话", exact: true }).click();
    await expect(input(page)).toBeInViewport({ ratio: 1 });
    await expect(send(page)).toBeInViewport({ ratio: 1 });
    await input(page).fill("继续聊聊");
    await expect(send(page)).toBeEnabled();
    await expectNoHorizontalOverflow(page);
  });

  test("a keyboard-sized viewport keeps typing and manual entry usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLedger(page); await seedLongConversation(page);
    await input(page).fill("本月支出多少？"); await send(page).click();
    await expect(page.getByTestId("ai-answer")).toBeVisible();
    await input(page).focus();
    // Desktop browser viewport reduction exercises the resize contract; this is
    // not a claim that a physical iOS keyboard was used in the test.
    await page.setViewportSize({ width: 390, height: 420 });
    await input(page).fill("今天午饭28元");
    await expect(input(page)).toBeInViewport({ ratio: 1 });
    await expect(send(page)).toBeEnabled();
    await send(page).scrollIntoViewIfNeeded();
    await expect(send(page)).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "手动记一笔", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "记账", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "收入", exact: true }).click();
    await dialog.locator('[name="amount"]').fill("100");
    const save = dialog.getByRole("button", { name: "记好了", exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
  });
});
