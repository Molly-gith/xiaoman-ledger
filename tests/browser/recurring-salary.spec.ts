import { test, expect, type Page } from "@playwright/test";
import { emptyLedger, exportLedger, openLedger, seedLedger, openBills } from "./ledger-helpers";
async function configure(page: Page, payday = "15") {
 const b=page.getByTestId("salary-budget"); await b.locator(":scope > summary").click();
 await b.getByLabel("每月到手工资（元，必填）", {exact:true}).fill("7000");
 await b.locator(".salary-budget-cycle > summary").click();
 await b.getByRole("combobox", {name:"发薪日（选填）",exact:true}).selectOption(payday);
 await b.getByRole("checkbox", {name:"发薪日自动记工资（选用）",exact:true}).check();
 await b.getByRole("checkbox", {name:"按发薪周期计算预算（选用）",exact:true}).check();
 await b.getByRole("button", {name:"保存并启用",exact:true}).click();
 await expect(b.locator(".salary-budget-rows")).toBeVisible();
 await expect(b.getByRole("button", {name:"保存并启用",exact:true})).toHaveCount(0);
 return b;
}
test("one-time payroll opt-in records today once, survives reload, and rolls budget to the next payday",async({page})=>{
 await openLedger(page); const b=await configure(page);
 await expect(page.locator(".transactions .tx-row")).toHaveCount(1);
 await expect(page.locator(".transactions")).toContainText("自动记录");
 await page.reload(); await expect(page.locator(".transactions .tx-row")).toHaveCount(1);
 await page.clock.setFixedTime(new Date("2026-10-15T04:00:00Z")); await page.reload();
 await expect(page.locator(".transactions .tx-row")).toHaveCount(2);
 await b.locator(":scope > summary").click();
 await expect(b.locator(".salary-budget-scope")).toContainText("2026-10-15 至 2026-11-14");
 await expect(b.locator(".salary-budget-row").first()).toContainText("额度 ¥4,900.00");
 const saved=(await exportLedger(page)).state;
 expect(saved.transactions.map((t:{date:string})=>t.date).sort()).toEqual(["2026-09-15","2026-10-15"]);
 expect(saved.transactions.every((t:{amount:number,type:string})=>t.amount===7000&&t.type==="income")).toBeTruthy();
 expect(saved.salaryBudget.autoIncome.lastProcessedMonth).toBe("2026-10");
});
test("payday midnight while page stays open records once without needing a manual refresh",async({page})=>{
 await page.clock.install({time:new Date("2026-09-14T15:59:00Z")}); await page.goto("./");
 await expect(page.getByRole("textbox",{name:"记账或问小满",exact:true})).toBeVisible();
 const b=await configure(page); await expect(page.locator(".transactions .tx-row")).toHaveCount(0);
 await page.clock.setFixedTime(new Date("2026-09-14T16:00:01Z")); await page.clock.fastForward(30_100);
 await expect(page.locator(".transactions .tx-row")).toHaveCount(1);
 await expect(b.locator(".salary-budget-scope")).toContainText("2026-09-15 至 2026-10-14");
 await page.clock.fastForward(60_100); await expect(page.locator(".transactions .tx-row")).toHaveCount(1);
});
test("an already recorded salary prevents automatic duplicate and stopping payroll prevents next month's entry",async({page})=>{
 await seedLedger(page,{...emptyLedger(),transactions:[{id:"manual-salary",type:"income",amount:6800,date:"2026-09-10",category:"收入",note:"九月工资已记",icon:"收",source:"text",cycleId:null,nature:null,spendKind:null}]});
 await openLedger(page);const b=await configure(page);await expect(page.locator(".transactions .tx-row")).toHaveCount(1);
 await b.getByRole("button",{name:"调整薪资与金额",exact:true}).click();
 await b.locator(".salary-budget-cycle > summary").click();
 await b.getByRole("checkbox",{name:"发薪日自动记工资（选用）",exact:true}).uncheck();
 await b.getByRole("button",{name:"保存预算设置",exact:true}).click();
 await expect(b.getByRole("button",{name:"保存预算设置",exact:true})).toHaveCount(0);
 await page.clock.setFixedTime(new Date("2026-10-15T04:00:00Z"));await page.reload();
 const saved=(await exportLedger(page)).state;expect(saved.transactions).toHaveLength(1);expect(saved.transactions[0].id).toBe("manual-salary");
 expect(saved.salaryBudget.autoIncome.enabled).toBe(false);
 await openBills(page);await page.getByRole("button",{name:"发薪周期",exact:true}).click();
 await expect(page.getByRole("region",{name:"统计日期筛选"})).toContainText("2026-10-15 — 2026-11-14");
});
