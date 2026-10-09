import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

export const fixedNow = new Date("2026-09-15T04:00:00Z");

export async function openLedger(page: Page) {
  await page.clock.install({ time: fixedNow });
  await page.goto("./");
  await expect(page.getByTestId("home-action-add")).toBeVisible();
}

export async function returnHome(page: Page) {
  for (let count = 0; count < 2 && !await page.getByTestId("home-action-add").isVisible(); count++) {
    await page.getByRole("button", { name: /^(返回小满|← 返回)$/ }).click();
  }
  await expect(page.getByRole("textbox", { name: "问小满", exact: true })).toBeVisible();
  await expect(page.getByTestId("assistant-conversation")).toHaveCount(0);
}

export async function openCycle(page: Page) {
  await returnHome(page);
  await page.getByRole("button", { name: "我的设置", exact: true }).click();
  await page.getByRole("button", { name: "记账周期", exact: true }).click();
  await expect(page.locator('[name="availableIncome"]')).toBeVisible();
}

export async function expandInvestmentTarget(page: Page) {
  const field = page.locator('[name="plannedSavings"]');
  if (!await field.isVisible()) await page.locator("summary").filter({ hasText: "投资目标（选填）" }).click();
  await expect(field).toBeVisible();
}

export async function saveCycle(page: Page) {
  await page.getByRole("button", { name: "保存周期设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await returnHome(page);
}

export async function setFunds(page: Page, available = "10000", investment = "2500") {
  await openCycle(page);
  await page.locator('[name="availableIncome"]').fill(available);
  await expandInvestmentTarget(page);
  await page.locator('[name="plannedSavings"]').fill(investment);
  await saveCycle(page);
}

export async function expectBalance(page: Page, value: string) {
  await returnHome(page);
  await page.getByTestId("home-action-bills").click();
  await expect(page.getByTestId("safe-to-spend")).toHaveText(value);
  await returnHome(page);
}

export async function addExpense(page: Page, amount: string, note = "", category = "餐饮", nature = "消费") {
  await page.getByTestId("home-action-add").click();
  await page.locator('[name="amount"]').fill(amount);
  await page.getByRole("button", { name: category, exact: true }).click();
  await page.getByRole("button", { name: nature, exact: true }).click();
  if (note) await page.locator('[name="note"]').fill(note);
  await page.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function exportLedger(page: Page) {
  await returnHome(page);
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份", exact: false }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).toBeTruthy();
  const state = JSON.parse(await readFile(path!, "utf8"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  return { state, path: path! };
}
