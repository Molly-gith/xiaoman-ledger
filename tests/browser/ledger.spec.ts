import { test, expect } from "@playwright/test";
import { addEntry, addExpense, emptyLedger, expectReport, exportLedger, openBills, openLedger, returnHome, seedLedger } from "./ledger-helpers";
test("manual CRUD, income, backup restore and offline reload preserve exact totals", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openLedger(page); await addExpense(page, "37.8", "午餐");
  await expectReport(page, "¥0.00", "¥37.80", "¥-37.80");
  await page.locator(".bill-list").getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator('[name="amount"]').fill("100");
  await page.locator('[name="category"]').selectOption("学习");
  await page.getByRole("button", { name: "投资", exact: true }).click();
  await page.locator('[name="note"]').fill("课程");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expectReport(page, "¥0.00", "¥100.00", "¥-100.00");
  await addEntry(page, { amount: "10000", note: "工资", type: "income" });
  await addExpense(page, "3000", "房租", "居住");
  await expectReport(page, "¥10,000.00", "¥3,100.00", "¥6,900.00");
  await page.locator(".bill-list .tx-row").filter({ hasText: "课程" }).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expectReport(page, "¥10,000.00", "¥3,000.00", "¥7,000.00");
  const { path } = await exportLedger(page);
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.getByRole("button", { name: "清空这台设备的数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await expectReport(page, "¥0.00", "¥0.00", "¥0.00");
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expectReport(page, "¥10,000.00", "¥3,000.00", "¥7,000.00");
  await page.reload(); await expectReport(page, "¥10,000.00", "¥3,000.00", "¥7,000.00");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true); await page.reload();
  await expectReport(page, "¥10,000.00", "¥3,000.00", "¥7,000.00"); expect(errors).toEqual([]);
});
test("legacy unclassified expense counts immediately and can be corrected without a budget", async ({ page }) => {
  await seedLedger(page, { ...emptyLedger(), version: 1, transactions: [{ id: "old", type: "expense", amount: 50, date: "2026-09-15", category: "购物", note: "旧账", icon: "购", source: "text" }] });
  await openLedger(page); await expectReport(page, "¥0.00", "¥50.00", "¥-50.00");
  await expect(page.locator(".nature-summary strong")).toHaveText(["¥0.00", "¥0.00", "¥0.00", "¥50.00"]);
  await page.locator(".bill-list").getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "浪费", exact: true }).click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".nature-summary strong")).toHaveText(["¥0.00", "¥50.00", "¥0.00", "¥0.00"]);
  expect((await exportLedger(page)).state.cycles).toEqual([]);
});
test("stale tabs cannot overwrite or append with an old ledger revision", async ({ page, context }) => {
  await openLedger(page);
  const second = await context.newPage(); await openLedger(second);
  await addExpense(page, "20", "已保存");
  await second.getByRole("button", { name: "手动记一笔", exact: true }).click();
  await second.locator('[name="amount"]').fill("90");
  await second.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("其他页面更新");
  await expect(second.locator('[name="amount"]')).toHaveValue("90");
  await second.getByRole("button", { name: "重新载入账本", exact: true }).click();
  await expectReport(second, "¥0.00", "¥20.00", "¥-20.00");
  expect((await exportLedger(second)).state.transactions).toHaveLength(1);
});
test("failed durable write retains manual inputs and never claims success", async ({ page }) => {
  await seedLedger(page, { ...emptyLedger(), revision: 1 });
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("空间不足", "QuotaExceededError"); }; });
  await openLedger(page);
  await page.getByRole("button", { name: "手动记一笔", exact: true }).click();
  await page.locator('[name="amount"]').fill("100");
  await page.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("空间不足");
  await expect(page.locator('[name="amount"]')).toHaveValue("100");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoman-ledger-local-v1")!).transactions)).toEqual([]);
});
test("online navigation refreshes old offline HTML and preserves the new no-setup home", async ({ page }) => {
  await openLedger(page); await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready, cache = await caches.open("xiaoman-shell-v3");
    await cache.put(new URL("./", registration.scope), new Response("<html>old-release-marker</html>", { headers: { "content-type": "text/html" } }));
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "记账或问小满" })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready, cache = await caches.open("xiaoman-shell-v3");
    return (await (await cache.match(new URL("./", registration.scope)))!.text()).includes("old-release-marker");
  })).toBe(false);
  await page.context().setOffline(true); await page.reload();
  await expect(page.getByRole("textbox", { name: "记账或问小满" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("legacy timestamps disclose date uncertainty and require an explicit date before editing", async ({ page }) => {
  const cycleId = "cycle-2026-08-20-20";
  await seedLedger(page, { ...emptyLedger(), revision: 1, profile: { salaryDay: 20 }, activeCycleId: cycleId,
    cycles: [{ id: cycleId, salaryDay: 20, startDate: "2026-08-20", endDate: "2026-09-19", nextSalaryDate: "2026-09-20" }],
    budgets: [{ cycleId, availableIncome: 1000, plannedSavings: 0, necessaryReserve: 0 }],
    transactions: [{ id: "old", type: "expense", amount: 50, date: "2026-08-19T16:30:00Z", cycleId, nature: "消费", spendKind: "variable", category: "餐饮", note: "旧时间记录", icon: "餐", source: "text" }],
  });
  await openLedger(page); await openBills(page); await page.getByLabel("查看月份").fill("2026-08");
  await expect(page.getByText("有 1 笔旧账暂按本机日期计入，建议打开账目核对日期。")).toBeVisible();
  await page.locator(".bill-list").getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator('[name="date"]')).toHaveValue("");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('[name="date"]').fill("2026-08-20");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/旧账暂按本机日期计入/)).toHaveCount(0);
  await returnHome(page);
});
