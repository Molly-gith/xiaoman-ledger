import { test, expect, type Page } from "@playwright/test";
import type { SalaryBudgetSettings, Transaction } from "../../lib/domain/types";
import { addEntry, emptyLedger, exportLedger, openBills, openLedger, seedLedger } from "./ledger-helpers";

const panel = (page: Page) => page.getByTestId("salary-budget");
const config = (extra: Partial<SalaryBudgetSettings> = {}): SalaryBudgetSettings => ({
  enabled: true, periodMode: "calendar_month", salaryDay: null, expectedSalary: 6000,
  percentages: { 消费: 60, 浪费: 0, 投资: 20 }, periodOverride: null, ...extra,
});
const recordedExpense: Transaction = {
  id: "budget-existing-expense", type: "expense", amount: 23, date: "2026-09-15",
  category: "餐饮", nature: "消费", note: "保留的午餐", icon: "食", source: "text",
  cycleId: null, spendKind: "variable",
};
function fixture(settings: SalaryBudgetSettings | null = null, transactions: Transaction[] = []) {
  const blank = () => ({
    profile: null, activeCycleId: null, cycles: [], budgets: [], transactions: [],
    investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [], salaryBudget: null,
    settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
  });
  return {
    ...emptyLedger(), version: 4, salaryBudget: settings, transactions,
    otherLedgers: { family: blank(), travel: blank() },
  };
}
async function expand(page: Page) {
  const budget = panel(page);
  if (await budget.getAttribute("open") === null) await budget.locator(":scope > summary").click();
  await expect(budget).toHaveAttribute("open", "");
}
async function fillPlan(page: Page, salary = "6000", consumption = "60", waste = "0", investment = "20") {
  const budget = panel(page);
  await budget.getByLabel("每月到手工资（元，必填）", { exact: true }).fill(salary);
  await budget.getByLabel("消费（%）", { exact: true }).fill(consumption);
  await budget.getByLabel("浪费（%）", { exact: true }).fill(waste);
  await budget.getByLabel("投资（%）", { exact: true }).fill(investment);
}
async function enable(page: Page) {
  await panel(page).getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(panel(page).locator(".salary-budget-rows")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "保存并启用", exact: true })).toHaveCount(0);
}
async function editSettings(page: Page) {
  await expand(page);
  await panel(page).getByRole("button", { name: "调整薪资与比例", exact: true }).click();
}
async function switchBook(page: Page, name: string) {
  await page.getByRole("button", { name: /^切换账本，当前：/ }).click();
  const dialog = page.getByRole("dialog", { name: "切换账本", exact: true });
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "切换账本，当前：" + name, exact: true })).toBeVisible();
}

test("salary budgeting starts collapsed and optional without blocking an ordinary entry", async ({ page }) => {
  await openLedger(page);
  const budget = panel(page);
  await expect(budget.locator(":scope > summary")).toContainText("薪资预算 · 选填");
  await expect(budget).not.toHaveAttribute("open", "");
  await expect(budget.getByLabel("每月到手工资（元，必填）", { exact: true })).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addEntry(page, { amount: "12", note: "不启用预算也能记账" });
  const { state } = await exportLedger(page);
  expect(state.salaryBudget).toBeNull();
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0]).toMatchObject({ amount: 12, note: "不启用预算也能记账", cycleId: null });
  expect(state.cycles).toEqual([]);
});

test("first-time salary uses 70/5/25 and salary edits preserve custom percentages after saving", async ({ page }) => {
  await seedLedger(page, fixture());
  await openLedger(page); await expand(page);
  const budget = panel(page);
  const salary = budget.getByLabel("每月到手工资（元，必填）", { exact: true });
  await salary.fill("10000");
  for (const [nature, ratio, money] of [["消费", "70", "¥7,000.00"], ["浪费", "5", "¥500.00"], ["投资", "25", "¥2,500.00"]]) {
    await expect(budget.getByLabel(nature + "（%）", { exact: true })).toHaveValue(ratio);
    await expect(budget.getByLabel(nature + "预算金额", { exact: true })).toHaveText(money);
  }
  await enable(page);
  await editSettings(page);
  await expect(budget.getByLabel("消费（%）", { exact: true })).toHaveValue("70");
  await expect(budget.getByLabel("浪费（%）", { exact: true })).toHaveValue("5");
  await expect(budget.getByLabel("投资（%）", { exact: true })).toHaveValue("25");
  await fillPlan(page, "10000", "60", "0", "20");
  await salary.fill("8000");
  await expect(budget.getByLabel("消费预算金额", { exact: true })).toHaveText("¥4,800.00");
  await expect(budget.getByLabel("浪费预算金额", { exact: true })).toHaveText("¥0.00");
  await expect(budget.getByLabel("投资预算金额", { exact: true })).toHaveText("¥1,600.00");
  await budget.getByRole("button", { name: "保存预算设置", exact: true }).click();
  await expect(budget.getByRole("button", { name: "保存预算设置", exact: true })).toHaveCount(0);
  await expect(budget.locator(".salary-budget-base")).toContainText("¥8,000.00");
  await expect(budget.locator(".salary-budget-row").first()).toContainText("额度 ¥4,800.00");
  await page.reload(); await editSettings(page);
  await expect(budget.getByLabel("消费（%）", { exact: true })).toHaveValue("60");
  await expect(budget.getByLabel("浪费（%）", { exact: true })).toHaveValue("0");
  await expect(budget.getByLabel("投资（%）", { exact: true })).toHaveValue("20");
  const saved = (await exportLedger(page)).state;
  expect(saved.salaryBudget).toMatchObject({ expectedSalary: 8000, percentages: { 消费: 60, 浪费: 0, 投资: 20 } });
  expect(saved.transactions).toEqual([]);
});

test("monthly salary allocation previews money, rejects over 100 percent and creates no income", async ({ page }) => {
  await seedLedger(page, fixture(null, [recordedExpense]));
  await openLedger(page);
  await expand(page);
  await fillPlan(page, "6000", "80", "0", "30");
  await panel(page).getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("合计不能超过 100%");
  await expect(panel(page).getByLabel("每月到手工资（元，必填）", { exact: true })).toHaveValue("6000");
  await fillPlan(page);
  await expect(panel(page).getByLabel("消费预算金额", { exact: true })).toHaveText("¥3,600.00");
  await expect(panel(page).getByLabel("浪费预算金额", { exact: true })).toHaveText("¥0.00");
  await expect(panel(page).getByLabel("投资预算金额", { exact: true })).toHaveText("¥1,200.00");
  await expect(panel(page).locator(".salary-budget-percentages")).toContainText("未分配 20%（¥1,200.00）");
  // The optional payday controls stay unopened; a calendar budget needs no payday.
  await enable(page);
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("2026-09-01 至 2026-09-30");
  await expect(panel(page).locator(".salary-budget-row").filter({ has: page.locator("dt", { hasText: "消费" }) })).toContainText("已用 ¥23.00");
  await expect(panel(page).locator(".salary-budget-unallocated")).toContainText("¥1,200.00");
  const { state } = await exportLedger(page);
  expect(state.salaryBudget).toEqual(config());
  expect(state.transactions).toEqual([recordedExpense]);
  expect(state.cycles).toEqual([]);
  expect(state.budgets).toEqual([]);
  await page.reload();
  await expect(panel(page)).not.toHaveAttribute("open", "");
  await expect(panel(page).locator(":scope > summary")).toContainText("已启用");
  await expand(page);
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥6,000.00");
});

test("a payday can be stored without changing the month; salary periods require an explicit choice", async ({ page }) => {
  await seedLedger(page, fixture());
  await openLedger(page);
  await expand(page);
  await fillPlan(page);
  await panel(page).locator(".salary-budget-cycle > summary").click();
  const salaryPeriod = panel(page).getByLabel("按发薪周期计算预算（选用）", { exact: true });
  await expect(salaryPeriod).toBeDisabled();
  await panel(page).getByRole("combobox", { name: "发薪日（选填）", exact: true }).selectOption("20");
  await expect(salaryPeriod).toBeEnabled();
  await expect(salaryPeriod).not.toBeChecked();
  await enable(page);
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("2026-09-01 至 2026-09-30");
  expect((await exportLedger(page)).state.salaryBudget).toMatchObject({ periodMode: "calendar_month", salaryDay: 20 });
  await editSettings(page);
  await panel(page).locator(".salary-budget-cycle > summary").click();
  await salaryPeriod.check();
  await panel(page).getByRole("button", { name: "保存预算设置", exact: true }).click();
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("2026-08-20 至 2026-09-19");
  const { state } = await exportLedger(page);
  expect(state.salaryBudget).toMatchObject({ periodMode: "salary_based", salaryDay: 20 });
  expect(state.transactions).toEqual([]);
  expect(state.profile).toBeNull();
  await openBills(page);
  await page.getByRole("button", { name: "发薪周期", exact: true }).click();
  await expect(page.getByRole("region", { name: "统计日期筛选" })).toContainText("2026-08-20 — 2026-09-19");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "记账", exact: true }).click();
  await expand(page);
  await panel(page).getByRole("button", { name: "查看本期账目", exact: true }).click();
  await expect(page.getByRole("button", { name: "发薪周期", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "统计日期筛选" })).toContainText("2026-08-20 — 2026-09-19");
});

test("temporary salary changes only the current period and leaves the income ledger untouched", async ({ page }) => {
  await seedLedger(page, fixture(config(), [recordedExpense]));
  await openLedger(page);
  await expand(page);
  await panel(page).getByRole("button", { name: "仅调整本期薪资", exact: true }).click();
  await panel(page).getByLabel("本期薪资（元，必填）", { exact: true }).fill("8000");
  await panel(page).getByRole("button", { name: "仅保存本期薪资", exact: true }).click();
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥8,000.00");
  await expect(panel(page).locator(".salary-budget-base")).toContainText("仅本期调整");
  await expect(panel(page).locator(".salary-budget-row").first()).toContainText("额度 ¥4,800.00");
  const saved = (await exportLedger(page)).state;
  expect(saved.salaryBudget).toEqual(config({ periodOverride: { startDate: "2026-09-01", endDate: "2026-09-30", salary: 8000 } }));
  expect(saved.transactions).toEqual([recordedExpense]);
  await page.reload();
  await expand(page);
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥8,000.00");
  await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
  await page.reload();
  await expand(page);
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥6,000.00");
  await expect(panel(page).locator(".salary-budget-base")).not.toContainText("仅本期调整");
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("2026-10-01 至 2026-10-31");
  expect((await exportLedger(page)).state.transactions).toEqual([recordedExpense]);
});

test("budgets remain isolated by ledger and disabling preserves records and saved preferences", async ({ page }) => {
  await seedLedger(page, fixture(config(), [recordedExpense]));
  await openLedger(page);
  await switchBook(page, "家庭账本");
  await expect(panel(page).locator(":scope > summary")).toContainText("选填");
  await expand(page);
  await fillPlan(page, "9000", "50", "0", "0");
  await enable(page);
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("家庭账本");
  await switchBook(page, "个人账本");
  await expand(page);
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥6,000.00");
  await expect(panel(page).locator(".salary-budget-row").first()).toContainText("¥23.00");
  await editSettings(page);
  await panel(page).getByRole("button", { name: "停用薪资预算", exact: true }).click();
  await expect(panel(page)).not.toHaveAttribute("open", "");
  await expect(panel(page).locator(":scope > summary")).toContainText("选填");
  await page.reload();
  await expand(page);
  await expect(panel(page).getByLabel("每月到手工资（元，必填）", { exact: true })).toHaveValue("6000");
  await expect(panel(page).getByLabel("消费（%）", { exact: true })).toHaveValue("60");
  const { state } = await exportLedger(page);
  expect(state.salaryBudget).toEqual(config({ enabled: false }));
  expect(state.transactions).toEqual([recordedExpense]);
  expect(state.otherLedgers.family.salaryBudget).toMatchObject({ enabled: true, expectedSalary: 9000, percentages: { 消费: 50, 浪费: 0, 投资: 0 } });
  expect(state.otherLedgers.family.transactions).toEqual([]);
  await switchBook(page, "家庭账本");
  await expand(page);
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥9,000.00");
});

test("an open current-salary editor resets to the new period when midnight rolls over", async ({ page }) => {
  await seedLedger(page, fixture(config({
    expectedSalary: 10000,
    periodOverride: { startDate: "2026-08-01", endDate: "2026-08-31", salary: 8000 },
  })));
  await page.clock.install({ time: new Date("2026-08-31T15:59:00Z") });
  await page.goto("./");
  await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toBeVisible();
  await expand(page);
  await panel(page).getByRole("button", { name: "仅调整本期薪资", exact: true }).click();
  const salaryInput = panel(page).getByLabel("本期薪资（元，必填）", { exact: true });
  await expect(salaryInput).toHaveValue("8000");
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("2026-08-01 至 2026-08-31");

  // Hong Kong midnight changes the period while the editor stays open.
  // The existing 30-second refresh timer must remount the period-scoped draft.
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:01Z"));
  await page.clock.fastForward(30_100);
  await expect(panel(page).locator(".salary-budget-scope")).toContainText("2026-09-01 至 2026-09-30");
  await expect(salaryInput).toBeVisible();
  await expect(salaryInput).toHaveValue("10000");
  await panel(page).getByRole("button", { name: "仅保存本期薪资", exact: true }).click();
  await expect(panel(page).locator(".salary-budget-base")).toContainText("¥10,000.00");
  const { state } = await exportLedger(page);
  expect(state.salaryBudget.periodOverride).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30", salary: 10000 });
  expect(state.transactions).toEqual([]);
});
