import { test, expect } from "@playwright/test";
import { expandInvestmentTarget, exportLedger, openCycle, openLedger, saveCycle } from "./ledger-helpers";
test("optional budget settings keep blank distinct from zero and do not alter recorded income", async ({ page }) => {
  await openLedger(page); await openCycle(page);
  const income=page.locator('[name="availableIncome"]'), target=page.locator('[name="plannedSavings"]');
  await expect(income).toHaveValue(""); await expect(income).not.toHaveAttribute("required","");
  await expect(target).toBeHidden(); await income.fill("3000"); await expandInvestmentTarget(page);
  await expect(target).toHaveValue(""); await page.getByRole("button",{name:/^采用 25% 参考/}).click();
  await expect(target).toHaveValue("750"); await target.fill("0"); await income.fill("4000");
  await expect(target).toHaveValue("0"); await saveCycle(page);
  const state=(await exportLedger(page)).state;
  expect(state.budgets[0]).toMatchObject({availableIncome:4000,plannedSavings:0}); expect(state.transactions).toEqual([]);
});
test("manual entry needs only an amount and keeps category, nature, date and note editable", async ({page})=>{
  await openLedger(page); await page.getByRole("button",{name:"手动记一笔",exact:true}).click();
  await expect(page.locator('[name="amount"]')).toHaveAttribute("required","");
  await expect(page.locator('[name="category"]')).toHaveValue("其他");
  await expect(page.getByRole("button",{name:"消费",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.locator('[name="note"]')).toBeHidden();
  await page.getByRole("button",{name:"记好了",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('[name="amount"]').fill("10"); await page.getByRole("button",{name:"记好了",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const state=(await exportLedger(page)).state;
  expect(state.transactions[0]).toMatchObject({amount:10,category:"其他",nature:"消费",date:"2026-09-15",cycleId:null});
});
