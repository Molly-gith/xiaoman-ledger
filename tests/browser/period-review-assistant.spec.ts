import { test, expect, type Page } from "@playwright/test";
import { emptyLedger, exportLedger, openLedger, seedLedger } from "./ledger-helpers";
const tx = (id: string, date: string, amount: number, category = "餐饮", type = "expense") => ({ id, date, amount, category, type, note: id + "仅本机", icon: "记", source: "text", cycleId: null, nature: type === "income" ? null : "消费", spendKind: type === "income" ? null : "variable" });
function fixture() {
 const empty=emptyLedger();
 const book={profile:null,activeCycleId:null,cycles:[],budgets:[],transactions:[],investmentAccounts:[],investmentFlows:[],marketValueSnapshots:[],settings:empty.settings};
 return {...empty,version:4,transactions:[tx("午饭","2026-09-05",30),tx("购物","2026-09-06",50,"购物"),tx("工资","2026-09-01",1000,"工资","income"),tx("前期","2026-08-05",10)],otherLedgers:{family:{...book,transactions:[tx("家庭专属","2026-09-05",70)]},travel:book}};
}
async function send(page:Page,text:string) { await page.getByRole("textbox",{name:"记账或问小满",exact:true}).fill(text);await page.getByRole("button",{name:"发送给小满",exact:true}).click(); }
const unchanged=(s:Record<string,unknown>)=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=="exportedAt"));
test("natural review resets earlier category filters, saves factual history and keeps follow-ups local",async({page})=>{
 let calls=0;await page.route("**/api/ai/**",route=>{calls++;return route.abort();});
 await seedLedger(page,fixture());await openLedger(page);
 const before=(await exportLedger(page)).state;
 await send(page,"这个月餐饮花了多少");await expect(page.getByTestId("ai-answer")).toContainText("支出30元");
 await send(page,"再复盘一下");
 const review=page.getByTestId("ai-answer").getByTestId("period-review");
  await expect(review.locator(".review-conclusion")).toContainText("购物花得最多：¥50.00");
  await expect(review).toContainText("这段时间还没结束");
  await review.locator("summary").filter({hasText:"查看收支"}).click();
  await expect(review.locator(".review-totals")).toHaveText("收入¥1,000.00支出¥80.00收支差额¥920.00");
 await review.getByRole("button",{name:"查看本段全部账目",exact:true}).click();
 await expect(review.getByRole("region",{name:"复盘账目依据"})).toContainText("共 3 笔");
 await page.reload();
 await expect(page.getByRole("log",{name:"个人账本对话记录",exact:true}).locator(".conversation-message")).toHaveCount(0);
 await page.getByRole("button",{name:"查看历史对话",exact:true}).click();
 await expect(page.getByRole("log",{name:"个人账本对话记录",exact:true})).toContainText("收入1000.00元");
 await expect(page.getByRole("log",{name:"个人账本对话记录",exact:true})).toContainText("支出80.00元");
 await page.getByRole("button",{name:"返回当前对话",exact:true}).click();
 await send(page,"本月收入多少");await expect(page.getByTestId("ai-answer")).toContainText("收入1000元");
 expect(unchanged((await exportLedger(page)).state)).toEqual(unchanged(before));expect(calls).toBe(0);
});
test("reviewing a named book reads only that book and does not switch the writing destination",async({page})=>{
 let calls=0;await page.route("**/api/ai/**",route=>{calls++;return route.abort();});
 await seedLedger(page,fixture());await openLedger(page);
 await send(page,"帮我复盘这个月家庭账本");
 const review=page.getByTestId("ai-answer").getByTestId("period-review");
  await expect(review).toContainText("家庭账本");await expect(review.locator(".review-conclusion")).toContainText("¥70.00");
  await review.locator("summary").filter({hasText:"与上一段比较"}).click();
  await expect(review).toContainText("上一段没有收支记录");
 await expect(page.getByRole("button",{name:"切换账本，当前：个人账本",exact:true})).toBeVisible();
  await review.locator("summary").filter({hasText:"查看收支"}).click();
  await review.getByRole("button",{name:"查看本段全部账目",exact:true}).click();
 const evidence=review.getByRole("region",{name:"复盘账目依据"});
 await expect(evidence).toContainText("家庭专属仅本机");await expect(evidence).not.toContainText("工资仅本机");expect(calls).toBe(0);
});
