import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
export const fixedNow = new Date("2026-09-15T04:00:00Z");
export const emptyLedger = () => ({
  app: "xiaoman-ledger", version: 3, revision: 0, ledgerKind: "personal", profile: null, activeCycleId: null,
  cycles: [], budgets: [], transactions: [], investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [],
  settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
});
export async function seedLedger(page: Page, state: unknown) {
  await page.addInitScript(value => {
    if (!localStorage.getItem("xiaoman-ledger-local-v1")) localStorage.setItem("xiaoman-ledger-local-v1", JSON.stringify(value));
  }, state);
}
export async function openLedger(page: Page) {
  await page.clock.install({ time: fixedNow }); await page.goto("./");
  await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toBeVisible();
}
export async function returnHome(page: Page) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "记账", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toBeVisible();
}
export async function openBills(page: Page) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "账单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "账单与统计", exact: true })).toBeVisible();
}
export async function openAssets(page: Page) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click();
  await page.getByTestId("home-action-assets").click();
  await expect(page.getByRole("heading", { name: "投资账户", exact: true })).toBeVisible();
}
export async function openCycle(page: Page) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click();
  const setting = page.locator(".optional-settings");
  if (!await setting.getByRole("button", { name: "预算计划", exact: true }).isVisible()) await setting.locator("summary").click();
  await setting.getByRole("button", { name: "预算计划", exact: true }).click();
  await expect(page.locator('[name="availableIncome"]')).toBeVisible();
}
export async function expandInvestmentTarget(page: Page) {
  const field = page.locator('[name="plannedSavings"]');
  if (!await field.isVisible()) await page.locator("summary").filter({ hasText: "投资目标（选填）" }).click();
  await expect(field).toBeVisible();
}
export async function saveCycle(page: Page) {
  await page.getByRole("button", { name: "保存周期设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await returnHome(page);
}
export async function setFunds(page: Page, available = "10000", investment = "2500") {
  await openCycle(page); await page.locator('[name="availableIncome"]').fill(available);
  await expandInvestmentTarget(page); await page.locator('[name="plannedSavings"]').fill(investment); await saveCycle(page);
}
export async function expectReport(page: Page, income: string, expense: string, balance: string) {
  await openBills(page); await expect(page.locator(".bill-summary > div > b")).toHaveText([income, expense, balance]);
}
export async function expandEntryOptions(page: Page) {
  const details = page.getByRole("dialog").locator(".entry-more");
  if (!await details.locator('[name="date"]').isVisible()) await details.locator("summary").click();
}
export async function addEntry(page: Page, options: { amount: string; note?: string; date?: string; type?: "income" | "expense"; category?: string; nature?: string }) {
  await page.getByRole("button", { name: "手动记一笔", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记账", exact: true });
  if (options.type === "income") await dialog.getByRole("button", { name: "收入", exact: true }).click();
  await dialog.locator('[name="amount"]').fill(options.amount);
  if (options.type !== "income") {
    await dialog.locator('[name="category"]').selectOption(options.category ?? "餐饮");
    await dialog.getByRole("button", { name: options.nature ?? "消费", exact: true }).click();
  }
  if (options.note || options.date) {
    await expandEntryOptions(page);
    if (options.note) await dialog.locator('[name="note"]').fill(options.note);
    if (options.date) await dialog.locator('[name="date"]').fill(options.date);
  }
  await dialog.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function addExpense(page: Page, amount: string, note = "", category = "餐饮", nature = "消费") {
  await addEntry(page, { amount, note, category, nature });
}
export async function exportLedger(page: Page) {
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份", exact: false }).click();
  const download = await pending, path = await download.path(); expect(path).toBeTruthy();
  const state = JSON.parse(await readFile(path!, "utf8"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  return { state, path: path! };
}
