import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openLedger, setFunds, expectBalance, returnHome } from './ledger-helpers';

async function setup(page: import("@playwright/test").Page) {
  await openLedger(page);
  await setFunds(page);
}

test("investment account keeps asset value separate from cycle cash flow", async ({ page }) => {
  await setup(page);
  await page.getByTestId("home-action-assets").click();

  await page.locator('[name="investmentAccountName"]').fill("纳指 + 标普");
  await page.locator('[name="investmentMarketValue"]').fill("78724.80");
  await page.locator('[name="investmentOpeningContribution"]').fill("70000");
  await page.getByRole("button", { name: "保存投资账户", exact: true }).click();
  await expect(page.getByTestId("investment-account")).toContainText("纳指 + 标普");
  await expect(page.getByTestId("market-value")).toHaveText("¥78,724.80");
  await expect(page.getByText("¥70,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("+¥8,724.80", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "投入 / 取出", exact: true }).click();
  await page.locator('[name="investmentFlowAmount"]').fill("5000");
  await page.getByRole("button", { name: "保存资金变化", exact: true }).click();
  await expect(page.getByText("¥75,000.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /返回/ }).click();
  await expectBalance(page, "¥5,000.00");
  await page.getByTestId("home-action-bills").click();
  await expect(page.locator('.budget-row').filter({ hasText: '已发生投资' })).toContainText('¥5,000.00');
  await expect(page.locator('.budget-row').filter({ hasText: '投资目标' })).toContainText('¥2,500.00');
  await returnHome(page);

  await page.getByTestId("home-action-assets").click();
  await page.getByRole("button", { name: "更新市值", exact: true }).click();
  await page.locator('[name="marketValueUpdate"]').fill("80136.50");
  await page.getByRole("button", { name: "保存当前市值", exact: true }).click();
  await expect(page.getByTestId("market-value")).toHaveText("¥80,136.50");

  await page.getByRole("button", { name: /返回/ }).click();
  await page.getByTestId("home-action-bills").click();
  await expect(page.locator(".tx-row")).toHaveCount(0);
  await returnHome(page);
  await expectBalance(page, "¥5,000.00");

  await page.reload();
  await page.getByTestId("home-action-assets").click();
  await expect(page.getByTestId("market-value")).toHaveText("¥80,136.50");
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/investment-account.png", fullPage: true });
});
