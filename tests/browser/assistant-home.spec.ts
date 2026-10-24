import { test, expect } from "@playwright/test";
import { exportLedger, openAssets, openBills, openLedger, returnHome } from "./ledger-helpers";
test("fresh home offers natural input and manual entry without creating a budget cycle", async ({ page }) => {
  await openLedger(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "小满", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "手动记一笔", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送给小满" })).toBeDisabled();
  await expect(page.locator('[name="availableIncome"]')).toHaveCount(0);
  const { state } = await exportLedger(page);
  expect(state.cycles).toEqual([]); expect(state.budgets).toEqual([]); expect(state.activeCycleId).toBeNull();
  await openBills(page);
  await expect(page.getByLabel("查看月份", { exact: true })).toHaveValue("2026-09");
  await expect(page.locator(".bill-summary b")).toHaveText(["¥0.00", "¥0.00", "¥0.00"]);
  await openAssets(page); await expect(page.getByRole("heading", { name: "新建投资账户" })).toBeVisible();
  await returnHome(page); await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("date-range review transfers the visible range into the same composer without auto-sending", async ({ page }) => {
  await openLedger(page); await openBills(page);
  await page.getByRole("button", { name: "自定义日期", exact: true }).click();
  await page.getByLabel("开始日期", { exact: true }).fill("2026-08-20");
  await page.getByLabel("结束日期", { exact: true }).fill("2026-09-10");
  await page.getByTestId("home-action-review").click();
  const input = page.getByRole("textbox", { name: "记账或问小满", exact: true });
  await expect(input).toHaveValue(/2026-08-20 至 2026-09-10/); await expect(input).toBeFocused();
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "待保存账目" })).toHaveCount(0);
});
