import { test, expect } from "@playwright/test";
import { addEntry, emptyLedger, exportLedger, expectReport, openBills, openLedger, seedLedger } from "./ledger-helpers";
test("month and arbitrary date filters include endpoints and cycle-free entries across years", async ({ page }) => {
  await openLedger(page);
  await addEntry(page, { amount: "10.1", note: "去年末", date: "2025-12-31" });
  await addEntry(page, { amount: "20.2", note: "新年首日", date: "2026-01-01", nature: "浪费" });
  await addEntry(page, { amount: "100", note: "一月收入", date: "2026-01-31", type: "income" });
  await addEntry(page, { amount: "30.3", note: "二月首日", date: "2026-02-01", category: "学习", nature: "投资" });
  await addEntry(page, { amount: "5", note: "今天" });
  await expectReport(page, "¥0.00", "¥5.00", "¥-5.00");
  await page.getByLabel("查看月份", { exact: true }).fill("2026-01");
  await expect(page.locator(".bill-summary b")).toHaveText(["¥100.00", "¥20.20", "¥79.80"]);
  await expect(page.locator(".bill-list .tx-row")).toHaveCount(2);
  await page.getByRole("button", { name: "上个月", exact: true }).click();
  await expect(page.getByLabel("查看月份", { exact: true })).toHaveValue("2025-12");
  await expect(page.locator(".bill-summary b")).toHaveText(["¥0.00", "¥10.10", "¥-10.10"]);
  await page.getByRole("button", { name: "自定义日期", exact: true }).click();
  await page.getByLabel("开始日期", { exact: true }).fill("2025-12-31");
  await page.getByLabel("结束日期", { exact: true }).fill("2026-02-01");
  await expect(page.locator(".bill-summary b")).toHaveText(["¥100.00", "¥60.60", "¥39.40"]);
  await expect(page.locator(".nature-summary strong")).toHaveText(["¥10.10", "¥20.20", "¥30.30", "¥0.00"]);
  await expect(page.locator(".bill-list .tx-row")).toHaveCount(4);
  await page.screenshot({path:"test-results/everyday-statistics-mobile.png",fullPage:true});
  await page.locator('[aria-label="筛选账目"]').getByRole("button", { name: "收入", exact: true }).click();
  await expect(page.locator(".bill-list .tx-row")).toHaveCount(1);
  await expect(page.locator(".bill-summary b")).toHaveText(["¥100.00", "¥60.60", "¥39.40"]);
  const { state } = await exportLedger(page);
  expect(state.cycles).toEqual([]); expect(state.budgets).toEqual([]);
  expect(state.transactions).toHaveLength(5); expect(state.transactions.every((tx: { cycleId: unknown }) => tx.cycleId === null)).toBe(true);
});
test("invalid range hides stale totals and month selection returns to this month", async ({ page }) => {
  await openLedger(page); await openBills(page);
  await page.getByLabel("查看月份", { exact: true }).fill("1900-01");
  await expect(page.getByRole("button", { name: "上个月", exact: true })).toBeDisabled();
  await page.getByLabel("查看月份", { exact: true }).fill("9998-12");
  await expect(page.getByRole("button", { name: "下个月", exact: true })).toBeDisabled();
  await page.getByLabel("查看月份", { exact: true }).fill("2025-01");
  await page.getByRole("button", { name: "本月", exact: true }).click();
  await expect(page.getByLabel("查看月份", { exact: true })).toHaveValue("2026-09");
  await page.getByRole("button", { name: "自定义日期", exact: true }).click();
  await page.getByLabel("开始日期", { exact: true }).fill("2026-09-20");
  await page.getByLabel("结束日期", { exact: true }).fill("2026-09-01");
  await expect(page.getByRole("alert")).toContainText("结束日期不能早于开始日期");
  await expect(page.locator(".bill-summary")).toHaveCount(0);
  await expect(page.getByTestId("home-action-review")).toHaveCount(0);
  await page.getByLabel("结束日期", { exact: true }).fill("2026-09-20");
  await expect(page.locator(".bill-summary")).toHaveCount(0);
  await expect(page.getByText("这段时间还没有账目", { exact: true })).toBeVisible();
});
test("time rollover preserves historical plans and permits new records without setup", async ({ page }) => {
  const prior = { ...emptyLedger(), revision: 7, activeCycleId: "cycle-2026-09-01-calendar",
    cycles: [{ id: "cycle-2026-09-01-calendar", salaryDay: 1, startDate: "2026-09-01", endDate: "2026-09-30", nextSalaryDate: "2026-10-01", cycleType: "calendar_month" }],
    budgets: [{ cycleId: "cycle-2026-09-01-calendar", availableIncome: 2000, plannedSavings: 1000, necessaryReserve: 0, model: "nature" }],
    transactions: [{ id: "saved", type: "expense", amount: 30, date: "2026-09-15", category: "学习", note: "原有投资性质", icon: "学", source: "text", cycleId: "cycle-2026-09-01-calendar", nature: "投资", spendKind: "variable" }],
  };
  await seedLedger(page, prior); await openLedger(page);
  const before = (await exportLedger(page)).state;
  await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z")); await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0); await addEntry(page, { amount: "12", note: "新月份" });
  const after = (await exportLedger(page)).state;
  expect(after.cycles).toEqual(before.cycles); expect(after.budgets).toEqual(before.budgets);
  expect(after.activeCycleId).toBe(before.activeCycleId);
  expect(after.transactions.find((tx: { id: string }) => tx.id === "saved")).toEqual(before.transactions[0]);
  expect(after.transactions.find((tx: { note: string }) => tx.note === "新月份")).toMatchObject({ date: "2026-10-01", cycleId: null });
});
test("clear and restore empty backup leave no synthetic periods", async ({ page }) => {
  await openLedger(page); await addEntry(page, { amount: "12" });
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.getByRole("button", { name: "清空这台设备的数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let state = (await exportLedger(page)).state;
  expect(state.transactions).toEqual([]); expect(state.cycles).toEqual([]); expect(state.activeCycleId).toBeNull();
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "empty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(emptyLedger())) });
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = (await exportLedger(page)).state;
  expect(state.transactions).toEqual([]); expect(state.cycles).toEqual([]); expect(state.budgets).toEqual([]);
});
