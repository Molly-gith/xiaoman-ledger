import { test, expect, type Page } from "@playwright/test";
import { addExpense, expectReport, exportLedger, openBills, openLedger, returnHome } from "./ledger-helpers";
test.skip(process.env.AI_BROWSER_TEST !== "1", "Run against the AI-enabled mock endpoint build");
const endpoint="https://xiaoman-ai-test.example/api/ai/assistant";
const input=(page:Page)=>page.getByRole("textbox",{name:"记账或问小满",exact:true});
const draft=(extra:Record<string,unknown>={})=>({type:"expense",amount:35,category:"餐饮",occurred_at:"2026-09-15",note:"午饭",nature_suggestion:"消费",confidence:0.9,ambiguous:false,...extra});
const result=(drafts:unknown[])=>({status:"transactions",drafts,modelVersion:"test-only",workflowVersion:"test-only"});
async function send(page:Page,text="今天午饭35元") {
  await input(page).fill(text);await page.getByRole("button",{name:"发送给小满"}).click();
}
test("AI creates editable drafts only, then one confirmation saves a duplicate-safe atomic batch and undo removes it",async({page})=>{
  const requests:unknown[]=[];
  await page.route(endpoint,async route=>{
    requests.push(route.request().postDataJSON());
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({json:result([draft(),draft({type:"income",amount:8000,category:"收入",note:"工资",nature_suggestion:null})])});
  });
  await openLedger(page);expect(requests).toHaveLength(0);
  await send(page,"今天午饭35元，工资到账8000元");
  const preview=page.getByRole("region",{name:"待保存账目"});
  await expect(preview).toContainText("2 笔 · 尚未保存");
  expect((await exportLedger(page)).state.transactions).toEqual([]);
  await preview.getByRole("button",{name:"保存这 2 笔",exact:true}).evaluate(button=>{
    (button as HTMLButtonElement).click();(button as HTMLButtonElement).click();
  });
  await expect(preview).toHaveCount(0);await expect(input(page)).toHaveValue("");
  let state=(await exportLedger(page)).state;
  expect(state.revision).toBe(1);expect(state.transactions).toHaveLength(2);expect(state.cycles).toEqual([]);
  expect(state.transactions.every((tx:{cycleId:unknown})=>tx.cycleId===null)).toBe(true);
  await expectReport(page,"¥8,000.00","¥35.00","¥7,965.00");await returnHome(page);
  await page.getByRole("button",{name:"撤销这次记账",exact:true}).click();
  state=(await exportLedger(page)).state;expect(state.transactions).toEqual([]);expect(state.revision).toBe(2);
  expect(requests).toHaveLength(1);
});
test("cancel draft writes nothing; field edits including income type save without another AI call",async({page})=>{
  let calls=0;
  await page.route(endpoint,route=>{calls++;return route.fulfill({json:result([draft()])});});
  await openLedger(page);await send(page);
  await page.getByRole("button",{name:"不保存",exact:true}).click();
  expect((await exportLedger(page)).state.transactions).toEqual([]);
  await send(page);
  const preview=page.getByRole("region",{name:"待保存账目"});
  await preview.getByRole("button",{name:"修改第1笔",exact:true}).click();
  await preview.getByRole("combobox",{name:"收支类型",exact:true}).selectOption("income");
  await preview.getByLabel("金额（必填）",{exact:true}).fill("88.8");
  await preview.getByLabel("日期",{exact:true}).fill("2026-08-31");
  await preview.getByLabel("备注（选填）",{exact:true}).fill("退回款项");
  await preview.getByRole("button",{name:"保存这笔",exact:true}).click();
  await expect(preview).toHaveCount(0);
  const state=(await exportLedger(page)).state;
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0]).toMatchObject({type:"income",amount:88.8,date:"2026-08-31",category:"收入",nature:null,cycleId:null,note:"退回款项"});
  expect(calls).toBe(2);
});
test("clarification carries original input and answer together and never writes before confirmation",async({page})=>{
  const requests:Array<{text:string;clarification?:unknown}>=[];
  await page.route(endpoint,route=>{
    requests.push(route.request().postDataJSON());
    return route.fulfill({json:requests.length===1?{status:"clarification",question:"这次午饭花了多少钱？"}:result([draft({amount:28})])});
  });
  await openLedger(page);await send(page,"今天吃了午饭");
  await expect(page.locator(".clarification")).toContainText("这次午饭花了多少钱？");
  await expect(input(page)).toHaveValue("");await send(page,"28元");
  await expect(page.getByRole("region",{name:"待保存账目"})).toContainText("¥28.00");
  expect(requests[1].clarification).toEqual({originalText:"今天吃了午饭",question:"这次午饭花了多少钱？",answer:"28元"});
  expect((await exportLedger(page)).state.transactions).toEqual([]);
});
test("common account questions stay local and the current answer clears when the report changes",async({page})=>{
  const requests:unknown[]=[];
  await page.route(endpoint,route=>{
    requests.push(route.request().postDataJSON());
    return route.fulfill({json:{status:"answer",answer:"这段时间记录了支出20元。",nextActions:[]}});
  });
  await openLedger(page);await addExpense(page,"20","绝不上传的私人备注");
  await openBills(page);await page.getByTestId("home-action-review").click();
  await page.getByRole("button",{name:"发送给小满"}).click();
  await expect(page.getByTestId("ai-answer")).toContainText("支出20元");
  expect(requests).toEqual([]);
  await expect(page.getByTestId("ai-answer")).not.toContainText("绝不上传的私人备注");
  await openBills(page);await page.getByLabel("查看月份").fill("2026-08");await returnHome(page);
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);expect(requests).toHaveLength(0);
});
test("rate limit preserves text and manual bookkeeping remains usable",async({page})=>{
  await page.route(endpoint,route=>route.fulfill({status:429,json:{error:"rate_limited"}}));
  await openLedger(page);await send(page,"今天午饭35元");
  await expect(page.getByRole("alert")).toContainText("文字已保留");
  await expect(input(page)).toHaveValue("今天午饭35元");
  await addExpense(page,"20","手动补记");await expectReport(page,"¥0.00","¥20.00","¥-20.00");
});
test("cancelled request ignores a late answer and does not retry or clear text",async({page})=>{
  let release:(()=>void)|undefined,calls=0;
  await page.route(endpoint,async route=>{
    calls++;await new Promise<void>(resolve=>{release=resolve;});
    await route.fulfill({json:{status:"answer",answer:"迟到的回答",nextActions:[]}}).catch(()=>{});
  });
  await openLedger(page);await send(page,"请说明小满有哪些功能");await expect.poll(()=>calls).toBe(1);
  await page.locator(".composer-tools").getByRole("button",{name:"取消",exact:true}).click();release?.();
  await expect(input(page)).toHaveValue("请说明小满有哪些功能");await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("已取消");expect(calls).toBe(1);
});
test("invalid AI response cannot produce a draft or saved record",async({page})=>{
  await page.route(endpoint,route=>route.fulfill({json:result([draft({amount:0,occurred_at:"2026-02-30"})])}));
  await openLedger(page);await send(page);
  await expect(page.getByRole("alert")).toContainText("可靠结果");
  await expect(page.getByRole("region",{name:"待保存账目"})).toHaveCount(0);
  expect((await exportLedger(page)).state.transactions).toEqual([]);
});
test("manual save after AI batch clears undo so newer edits cannot be accidentally removed",async({page})=>{
  await page.route(endpoint,route=>route.fulfill({json:result([draft()])}));
  await openLedger(page);await send(page);await page.getByRole("button",{name:"保存这笔",exact:true}).click();
  await expect(page.getByRole("button",{name:"撤销这次记账",exact:true})).toBeVisible();
  await addExpense(page,"10","后来记的一笔");
  await expect(page.getByRole("button",{name:"撤销这次记账",exact:true})).toHaveCount(0);
  expect((await exportLedger(page)).state.transactions).toHaveLength(2);
});
