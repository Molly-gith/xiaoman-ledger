import { test, expect } from "@playwright/test";
import { addExpense, expectBalance, exportLedger, openCycle, openLedger, saveCycle, setFunds } from "./ledger-helpers";

test("a fresh ledger starts a natural month and can record spending without treating missing funds as zero", async ({ page }) => {
  await openLedger(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addExpense(page, "38", "第一笔午餐");
  await page.getByTestId("home-action-bills").click();
  await expect(page.getByTestId("safe-to-spend")).toHaveText("未设置");
  await expect(page.locator("body")).not.toContainText("已超支");
  await expect(page.locator("body")).not.toContainText("超出预算");
  await expect(page.getByTestId("safe-to-spend")).not.toContainText("0.00");
  const { state } = await exportLedger(page);
  expect(state.activeCycleId).toBe("cycle-2026-09-01-calendar");
  expect(state.cycles).toHaveLength(1);
  expect(state.cycles[0]).toMatchObject({ cycleType: "calendar_month", startDate: "2026-09-01", endDate: "2026-09-30" });
  expect(state.budgets[0]).toMatchObject({ availableIncome: 0, availableIncomeKnown: false, plannedSavings: 0, plannedSavingsKnown: false });
  expect(state.transactions[0]).toMatchObject({ amount: 38, nature: "消费", category: "餐饮", cycleId: state.activeCycleId });
});

test("funds can be added and cleared from My settings without changing transactions or inventing a target", async ({ page }) => {
  await openLedger(page);
  await addExpense(page, "38", "保留的账目");
  await setFunds(page, "1000", "");
  await expectBalance(page, "¥962.00");
  let state = (await exportLedger(page)).state;
  expect(state.budgets[0]).toMatchObject({ availableIncome: 1000, plannedSavings: 0, plannedSavingsKnown: false });
  await openCycle(page);
  await page.locator('[name="availableIncome"]').fill("");
  await saveCycle(page);
  await expectBalance(page, "未设置");
  await page.reload();
  await expectBalance(page, "未设置");
  state = (await exportLedger(page)).state;
  expect(state.budgets[0]).toMatchObject({ availableIncome: 0, availableIncomeKnown: false, plannedSavings: 0, plannedSavingsKnown: false });
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0].note).toBe("保留的账目");
});

test("calendar month rollover opens an unknown new budget and preserves the previous month", async ({ page }) => {
  await openLedger(page);
  await setFunds(page, "1000", "100");
  await addExpense(page, "20", "九月的账目");
  const before = (await exportLedger(page)).state;
  await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectBalance(page, "未设置");
  await addExpense(page, "7", "十月的账目");
  const after = (await exportLedger(page)).state;
  expect(after.activeCycleId).toBe("cycle-2026-10-01-calendar");
  expect(after.cycles).toHaveLength(2);
  expect(after.budgets.find((item: { cycleId: string }) => item.cycleId === before.activeCycleId)).toEqual(before.budgets[0]);
  expect(after.budgets.find((item: { cycleId: string }) => item.cycleId === after.activeCycleId)).toMatchObject({ availableIncome: 0, availableIncomeKnown: false, plannedSavings: 0, plannedSavingsKnown: false });
  expect(after.transactions).toHaveLength(2);
  expect(after.transactions.find((item: { note: string }) => item.note === "九月的账目").cycleId).toBe(before.activeCycleId);
});

test("an existing transaction and budget survive changing natural month to a salary period", async ({ page }) => {
  await openLedger(page);
  await setFunds(page, "1000", "");
  await addExpense(page, "58", "更换周期也要保留的餐费");
  const before = (await exportLedger(page)).state;
  await openCycle(page);
  await page.getByRole("button", { name: /^按发薪日/ }).click();
  await page.locator('[name="salaryDay"]').fill("10");
  await saveCycle(page);
  await expectBalance(page, "¥942.00");
  await page.reload();
  const after = (await exportLedger(page)).state;
  expect(after.activeCycleId).not.toBe(before.activeCycleId);
  expect(after.cycles).toHaveLength(1);
  expect(after.cycles[0]).toMatchObject({ cycleType: "salary_based", salaryDay: 10, startDate: "2026-09-10", endDate: "2026-10-09" });
  expect(after.budgets).toHaveLength(1);
  expect(after.budgets[0]).toEqual({ ...before.budgets[0], cycleId: after.activeCycleId });
  expect(after.transactions).toEqual([{ ...before.transactions[0], cycleId: after.activeCycleId }]);
});

test("existing custom cycle, explicit amounts and transaction nature survive loading and expiry", async ({ page }) => {
  await page.addInitScript(() => {
    const key = "xiaoman-ledger-local-v1";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      app: "xiaoman-ledger", version: 3, revision: 7, ledgerKind: "personal", profile: null, activeCycleId: "cycle-2026-09-10-2026-09-22-custom",
      cycles: [{ id: "cycle-2026-09-10-2026-09-22-custom", salaryDay: 10, startDate: "2026-09-10", endDate: "2026-09-22", nextSalaryDate: "2026-09-23", cycleType: "custom" }],
      budgets: [{ cycleId: "cycle-2026-09-10-2026-09-22-custom", availableIncome: 2000, plannedSavings: 1000, necessaryReserve: 0, model: "nature" }],
      transactions: [{ id: "saved", type: "expense", amount: 30, date: "2026-09-15", category: "学习", note: "原有投资性质", icon: "学", source: "text", cycleId: "cycle-2026-09-10-2026-09-22-custom", nature: "投资", spendKind: "variable" }],
      investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [], settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
    }));
  });
  await openLedger(page);
  const before = (await exportLedger(page)).state;
  await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = (await exportLedger(page)).state;
  expect(after.activeCycleId).toBe(before.activeCycleId);
  expect(after.cycles).toEqual(before.cycles);
  expect(after.budgets).toEqual(before.budgets);
  expect(after.transactions).toEqual(before.transactions);
});

test("clear and importing an empty backup both return directly to an unknown natural month", async ({ page }) => {
  await openLedger(page);
  await addExpense(page, "12", "待清空");
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.getByRole("button", { name: "清空这台设备的数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(page.getByTestId("home-action-add")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let state = (await exportLedger(page)).state;
  expect(state.activeCycleId).toBe("cycle-2026-09-01-calendar");
  expect(state.transactions).toHaveLength(0);
  expect(state.budgets[0].availableIncomeKnown).toBe(false);
  const empty = { ...state, activeCycleId: null, cycles: [], budgets: [], transactions: [] };
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "empty-ledger.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)) });
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectBalance(page, "未设置");
  state = (await exportLedger(page)).state;
  expect(state.cycles).toHaveLength(1);
  expect(state.activeCycleId).toBe("cycle-2026-09-01-calendar");
  expect(state.budgets[0]).toMatchObject({ availableIncome: 0, availableIncomeKnown: false, plannedSavings: 0, plannedSavingsKnown: false });
});
