import { test, expect } from "@playwright/test";
import { addExpense, expectBalance, exportLedger, openCycle, openLedger, returnHome, saveCycle, setFunds, expandInvestmentTarget } from "./ledger-helpers";

test("manual CRUD, investments, income, backup restore and offline reload preserve money", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openLedger(page);
  await setFunds(page);
  await addExpense(page, "37.8");
  await expectBalance(page, "¥7,462.20");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator('[name="amount"]').fill("100");
  await page.getByRole("button", { name: "学习", exact: true }).click();
  await page.getByRole("button", { name: "投资", exact: true }).click();
  await page.locator('[name="note"]').fill("课程");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expectBalance(page, "¥7,500.00");
  await page.reload();
  await expectBalance(page, "¥7,500.00");
  await expect(page.locator(".tx-copy small")).toContainText("学习 · 投资");

  await page.getByTestId("home-action-add").click();
  await page.getByRole("button", { name: "收入", exact: true }).last().click();
  await page.locator('[name="amount"]').fill("10000");
  await page.locator('[name="note"]').fill("工资");
  await page.getByRole("button", { name: "记好了", exact: true }).click();
  await expectBalance(page, "¥7,500.00");
  await addExpense(page, "3000", "房租", "居住");
  await expectBalance(page, "¥4,500.00");
  await expect(page.getByText(/账单预留/)).toHaveCount(0);
  await setFunds(page, "11000", "2500");
  await expectBalance(page, "¥5,500.00");

  await page.getByTestId("home-action-bills").click();
  const course = page.locator(".tx-row").filter({ hasText: "课程" });
  await course.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByText(/账目已删除/)).toBeVisible();
  await expectBalance(page, "¥5,500.00");
  const { path } = await exportLedger(page);
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.getByRole("button", { name: "清空这台设备的数据", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectBalance(page, "未设置");
  await page.getByRole("button", { name: "本地数据与备份", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expectBalance(page, "¥5,500.00");
  await page.reload();
  await expectBalance(page, "¥5,500.00");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expectBalance(page, "¥5,500.00");
  expect(errors).toEqual([]);
});

test("legacy data requires review and manual editing preserves user choices", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("xiaoman-ledger-local-v1", JSON.stringify({
    app: "xiaoman-ledger", version: 1, ledgerKind: "personal",
    settings: { monthlyBudget: 15000, savingsCurrent: 0, savingsGoal: 100000 },
    transactions: [{ id: "old", type: "expense", amount: 50, date: "2026-09-15", category: "购物", note: "旧账", icon: "购", source: "text" }],
  })));
  await openLedger(page);
  await setFunds(page, "1000", "0");
  await expectBalance(page, "待核对旧账");
  await page.getByTestId("home-action-bills").click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "浪费", exact: true }).click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expectBalance(page, "¥950.00");
});

test("stale tabs cannot overwrite newer cycle amounts", async ({ page, context }) => {
  await openLedger(page);
  await setFunds(page);
  const second = await context.newPage();
  await openLedger(second);
  await expectBalance(second, "¥7,500.00");
  await setFunds(page, "12000", "2500");
  await openCycle(second);
  await second.locator('[name="availableIncome"]').fill("9000");
  await second.getByRole("button", { name: "保存周期设置", exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("其他页面更新");
  await second.getByRole("button", { name: "重新载入账本", exact: true }).click();
  await returnHome(second);
  await expectBalance(second, "¥9,500.00");
});

test("explicit zero differs from unknown and an existing salary cycle still requires owner rollover", async ({ page }) => {
  await page.addInitScript(() => {
    const key = "xiaoman-ledger-local-v1";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      app: "xiaoman-ledger", version: 3, revision: 1, ledgerKind: "personal", profile: { salaryDay: 20 }, activeCycleId: "cycle-2026-08-20-20",
      cycles: [{ id: "cycle-2026-08-20-20", salaryDay: 20, startDate: "2026-08-20", endDate: "2026-09-19", nextSalaryDate: "2026-09-20", cycleType: "salary_based" }],
      budgets: [{ cycleId: "cycle-2026-08-20-20", availableIncome: 0, plannedSavings: 0, necessaryReserve: 0, model: "nature" }],
      transactions: [], investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [],
      settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
    }));
  });
  await openLedger(page);
  await expectBalance(page, "¥0.00");
  await addExpense(page, "10");
  await expectBalance(page, "¥-10.00");
  await page.clock.setFixedTime(new Date("2026-09-20T04:00:00Z"));
  await page.reload();
  await expectBalance(page, "周期已结束");
  const before = (await exportLedger(page)).state;
  expect(before.activeCycleId).toBe("cycle-2026-08-20-20");
  await openCycle(page);
  await page.locator('[name="availableIncome"]').fill("100");
  await expandInvestmentTarget(page);
  await page.locator('[name="plannedSavings"]').fill("0");
  await saveCycle(page);
  await expectBalance(page, "¥100.00");
  const after = (await exportLedger(page)).state;
  expect(after.cycles).toHaveLength(2);
  expect(after.transactions).toHaveLength(1);
  expect(after.transactions[0].cycleId).toBe("cycle-2026-08-20-20");
});

test("failed durable entry write keeps inputs and never claims success", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("xiaoman-ledger-local-v1", JSON.stringify({
      app: "xiaoman-ledger", version: 3, revision: 1, ledgerKind: "personal", profile: null, activeCycleId: "cycle-2026-09-01-calendar",
      cycles: [{ id: "cycle-2026-09-01-calendar", salaryDay: 1, startDate: "2026-09-01", endDate: "2026-09-30", nextSalaryDate: "2026-10-01", cycleType: "calendar_month" }],
      budgets: [{ cycleId: "cycle-2026-09-01-calendar", availableIncome: null, plannedSavings: null, necessaryReserve: 0, model: "nature" }],
      transactions: [], investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [],
      settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
    }));
    Storage.prototype.setItem = () => { throw new DOMException("空间不足", "QuotaExceededError"); };
  });
  await openLedger(page);
  await page.getByTestId("home-action-add").click();
  await page.locator('[name="amount"]').fill("100");
  await page.getByRole("button", { name: "餐饮", exact: true }).click();
  await page.getByRole("button", { name: "消费", exact: true }).click();
  await page.getByRole("button", { name: "记好了", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("空间不足");
  await expect(page.locator('[name="amount"]')).toHaveValue("100");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("xiaoman-ledger-local-v1")!).revision)).toBe(1);
});

test("online navigation refreshes an older offline shell without reintroducing setup", async ({ page }) => {
  await openLedger(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.getByTestId("home-action-add")).toBeVisible();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready, cache = await caches.open("xiaoman-shell-v3");
    await cache.put(new URL("./", registration.scope), new Response("<html>old-release-marker</html>", { headers: { "content-type": "text/html" } }));
  });
  await page.reload();
  await expect(page.getByTestId("home-action-add")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready, cache = await caches.open("xiaoman-shell-v3");
    return (await (await cache.match(new URL("./", registration.scope)))!.text()).includes("old-release-marker");
  })).toBe(false);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId("home-action-add")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("ambiguous legacy timestamps still require an explicit date", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("xiaoman-ledger-local-v1", JSON.stringify({
    app: "xiaoman-ledger", version: 2, revision: 1, ledgerKind: "personal", profile: { salaryDay: 20 }, activeCycleId: "cycle-2026-08-20-20",
    cycles: [{ id: "cycle-2026-08-20-20", salaryDay: 20, startDate: "2026-08-20", endDate: "2026-09-19", nextSalaryDate: "2026-09-20" }],
    budgets: [{ cycleId: "cycle-2026-08-20-20", availableIncome: 1000, plannedSavings: 0, necessaryReserve: 0 }],
    transactions: [{ id: "old", type: "expense", amount: 50, date: "2026-08-19T16:30:00Z", cycleId: "cycle-2026-08-20-20", nature: "消费", spendKind: "variable", category: "餐饮", note: "旧时间记录", icon: "餐", source: "text" }],
    settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
  })));
  await openLedger(page);
  await expectBalance(page, "待核对旧账");
  await page.getByTestId("home-action-bills").click();
  await page.getByRole("button", { name: "年", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator('[name="date"]')).toHaveValue("");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('[name="date"]').fill("2026-08-20");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expectBalance(page, "¥950.00");
});
