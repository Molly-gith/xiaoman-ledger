import { test, expect, type Page } from "@playwright/test";
import { openLedger, setFunds, returnHome } from "./ledger-helpers";

async function expectComposerAtBottom(page: Page) {
  await expect(page.locator(".assistant-composer")).toBeVisible();
  expect(await page.locator(".assistant-composer").evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.bottom <= window.innerHeight + 2 && rect.bottom >= window.innerHeight - 36;
  })).toBeTruthy();
}

test("home opens without setup or overview and keeps the four tasks and AI input reachable", async ({ page }) => {
  await openLedger(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "小满", exact: true })).toBeVisible();
  await expect(page.getByTestId("assistant-conversation")).toHaveCount(0);
  await expect(page.getByTestId("assistant-readiness")).toHaveCount(0);
  await expect(page.getByTestId("safe-to-spend")).toHaveCount(0);
  await expect(page.locator('[name="availableIncome"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /记账周期|调整结构|开启新周期/ })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "问小满", exact: true })).toBeVisible();
  await expect(page.getByText("AI 分析暂未启用 · 记账与财务看板可正常使用", { exact: true })).toBeVisible();
  await expectComposerAtBottom(page);
  for (const [action, label] of [["add", "记一笔"], ["bills", "看看这个月"], ["assets", "我的资产"], ["review", "帮我复盘"]]) {
    await expect(page.getByTestId(`home-action-${action}`)).toContainText(label);
  }
  await expect(page.locator(".bottom-nav")).toHaveCount(0);
  await page.screenshot({ path: "docs/screenshots/home-without-overview.png", fullPage: true });
  await page.getByTestId("home-action-bills").click();
  await expect(page.getByRole("heading", { name: "财务", exact: true })).toBeVisible();
  await expect(page.getByTestId("safe-to-spend")).toHaveText("未设置");
  await expect(page.getByRole("button", { name: /调整结构|记账周期/ })).toHaveCount(0);
  await returnHome(page);
  await page.getByTestId("home-action-assets").click();
  await expect(page.getByText("投资账户", { exact: true }).first()).toBeVisible();
  await returnHome(page);
  await page.getByTestId("home-action-review").click();
  await expect(page.getByRole("heading", { name: "周期复盘", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /调整结构|记账周期/ })).toHaveCount(0);
  await returnHome(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await expectComposerAtBottom(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("legacy review remains available in finance without resurrecting the removed home overview", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("xiaoman-ledger-local-v1", JSON.stringify({
    app: "xiaoman-ledger", version: 1, ledgerKind: "personal",
    settings: { monthlyBudget: 15000, savingsCurrent: 0, savingsGoal: 100000 },
    transactions: [{ id: "old", type: "expense", amount: 50, date: "2026-09-15", category: "购物", note: "旧账", icon: "购", source: "text" }],
  })));
  await openLedger(page);
  await setFunds(page, "1000", "0");
  await expect(page.getByTestId("assistant-conversation")).toHaveCount(0);
  await expectComposerAtBottom(page);
  await page.getByTestId("home-action-bills").click();
  await expect(page.getByTestId("safe-to-spend")).toHaveText("待核对旧账");
  await expect(page.locator(".tx-row")).toContainText("旧账");
});
