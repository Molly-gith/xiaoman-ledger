import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const fixedNow = new Date("2026-09-15T04:00:00Z");

async function setup(page: import("@playwright/test").Page) {
  await page.clock.install({ time: fixedNow });
  await page.goto("./");
  await page.locator('[name="salaryDay"]').fill("20");
  await page.locator('[name="availableIncome"]').fill("10000");
  await page.getByRole("button", { name: "开始这个周期", exact: true }).click();
  await expect(page.getByTestId("safe-to-spend")).toHaveText("¥7,500.00");
}

async function returnHome(page: import("@playwright/test").Page) {
  const back = page.locator('.bottom-nav > button').first();
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByTestId('assistant-conversation')).toBeVisible();
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
  await expect(page.getByTestId("safe-to-spend")).toHaveText("¥5,000.00");
  await page.getByTestId("home-action-bills").click();
  await expect(page.getByText("¥5,000.00 / ¥2,500.00", { exact: true })).toBeVisible();
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
  await expect(page.getByTestId("safe-to-spend")).toHaveText("¥5,000.00");

  await page.reload();
  await page.getByTestId("home-action-assets").click();
  await expect(page.getByTestId("market-value")).toHaveText("¥80,136.50");
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/investment-account.png", fullPage: true });
});
