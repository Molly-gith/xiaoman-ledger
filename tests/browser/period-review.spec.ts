import { test, expect, type Page } from "@playwright/test";
import type { Transaction } from "../../lib/domain/types";
import { emptyLedger, exportLedger, openBills, openLedger, seedLedger } from "./ledger-helpers";

const transaction = (id: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, date, amount, type: "expense", category: "餐饮", nature: "消费", note: id,
  icon: "食", source: "text", cycleId: null, spendKind: "variable", ...extra,
});
const personal = [
  transaction("本段收入", "2026-09-10", 1000, { type: "income", category: "收入", nature: null, spendKind: null }),
  ...[10, 20, 30, 40, 50, 60].map((amount, i) => transaction("个人餐饮" + (i + 1), "2026-09-" + (10 + i), amount)),
  transaction("个人健身", "2026-09-15", 100, { category: "健康", nature: "投资" }),
  transaction("前段收入", "2026-09-04", 800, { type: "income", category: "收入", nature: null, spendKind: null }),
  transaction("前段餐饮", "2026-09-07", 100),
  transaction("前段交通", "2026-09-09", 50, { category: "交通" }),
];
function fixture(transactions = personal) {
  const data = {
    profile: null, activeCycleId: null, cycles: [], budgets: [], transactions: [],
    investmentAccounts: [], investmentFlows: [], marketValueSnapshots: [],
    settings: { monthlyBudget: 0, savingsCurrent: 0, savingsGoal: 0 },
  };
  return { ...emptyLedger(), version: 4, transactions,
    otherLedgers: { family: { ...data, transactions: [transaction("家庭独立账目", "2026-09-15", 9999)] }, travel: data },
  };
}
async function setRange(page: Page, start = "2026-09-10", end = "2026-09-15") {
  await page.getByRole("button", { name: "自定义日期", exact: true }).click();
  await page.getByLabel("开始日期", { exact: true }).fill(start);
  await page.getByLabel("结束日期", { exact: true }).fill(end);
}
const panel = (page: Page) => page.getByTestId("period-review").filter({ visible: true });
async function expand(page: Page) {
  await panel(page).getByRole("button", { name: "复盘这段时间", exact: true }).click();
}
async function openSection(page: Page, title: string) {
  const section = panel(page).locator("details.review-section").filter({ has: page.locator("summary").filter({ hasText: title }) });
  if (!await section.evaluate(element => (element as HTMLDetailsElement).open)) await section.locator("summary").click();
}
async function allEvidence(page: Page) {
  await openSection(page, "查看收支");
  await panel(page).getByRole("button", { name: "查看本段全部账目", exact: true }).click();
}
async function start(page: Page, state: unknown = fixture()) {
  await seedLedger(page, state); await openLedger(page); await openBills(page);
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/ai\//, route => route.abort("blockedbyclient"));
});

test("custom review compares equal day ranges and drills into only selected local records without writes", async ({ page }) => {
  let modelCalls = 0;
  page.on("request", request => { if (/\/api\/ai\//.test(request.url())) modelCalls++; });
  await start(page);
  const before = (await exportLedger(page)).state;
  await setRange(page); await expand(page);
  const review = panel(page), evidence = review.getByRole("region", { name: "复盘账目依据" });
  await expect(review).toHaveAttribute("aria-label", "个人账本期间复盘");
  await expect(review.locator(".review-conclusion")).toHaveText("已记下的支出里，餐饮花得最多：¥210.00。");
  await expect(review.locator(".review-section[open]")).toHaveCount(0);
  await expect(review.getByRole("table")).toHaveCount(0);
  const compareSummary = review.locator("summary").filter({ hasText: "与上一段比较" });
  await compareSummary.focus(); await page.keyboard.press("Enter");
  await expect(review).toContainText("上一段 2026-09-04 至 2026-09-09（同为 6 天）");
  const table = review.getByRole("table", { name: "本段与前段收支比较" });
  await expect(table.getByRole("row").nth(1)).toHaveText("收入¥1,000.00¥800.00+¥200.00");
  await expect(table.getByRole("row").nth(2)).toHaveText("支出¥310.00¥150.00+¥160.00");
  await expect(table.getByRole("row").nth(3)).toHaveText("收支差额¥690.00¥650.00+¥40.00");
  await expect(review).not.toContainText("家庭独立账目");
  await review.getByRole("button", { name: /^查看这类支出：/ }).click();
  await expect(evidence).toBeFocused();
  await expect(evidence).toBeInViewport();
  await expect(evidence).toContainText("共 6 笔 · 只读查看");
  await expect(evidence.locator("li")).toHaveCount(5);
  await expect(evidence).toContainText("个人餐饮6"); await expect(evidence).not.toContainText("个人健身");
  await evidence.getByRole("button", { name: "下一页依据" }).click();
  await expect(evidence.locator("li")).toHaveCount(1);
  await expect(evidence).toContainText("个人餐饮1");
  await review.getByRole("button", { name: /^查看前段支出账目：¥150.00/ }).click();
  await expect(evidence.locator("li")).toHaveCount(2);
  await expect(evidence).toContainText("前段交通"); await expect(evidence).toContainText("前段餐饮");
  await expect(evidence).not.toContainText("个人餐饮");
  await openSection(page, "花在哪里");
  await expect(review.locator(".review-section[open]")).toHaveCount(1);
  await review.getByRole("button", { name: "按性质", exact: true }).click();
  await review.getByRole("button", { name: /^查看本段投资支出账目：¥100.00，1 笔/ }).click();
  await expect(evidence.locator("li")).toHaveCount(1);
  await expect(evidence).toContainText("个人健身");
  await evidence.getByRole("button", {name:"收起账目依据",exact:true}).click();
  await expect(review.getByRole("button",{name:/^查看本段投资支出账目/})).toBeFocused();
  await review.locator("summary").filter({ hasText: "关于这份复盘" }).click();
  await expect(review.locator(".review-method p")).toContainText("投资性质支出不代表投资收益");
  const after = (await exportLedger(page)).state;
  expect(after.transactions).toEqual(before.transactions);
  expect(after.otherLedgers).toEqual(before.otherLedgers);
  expect(after.revision).toBe(before.revision);
  expect(after.cycles).toEqual([]);
  expect(modelCalls).toBe(0);
});

test("empty data and missing history do not claim actual zero or fabricate comparisons", async ({ page }) => {
  await start(page, fixture([transaction("只有本段支出", "2026-09-15", 45)]));
  await setRange(page); await expand(page);
  await openSection(page, "与上一段比较");
  await expect(panel(page)).toContainText("上一段没有收支记录");
  await expect(panel(page)).toContainText("没有记录不代表实际收支为零");
  await expect(panel(page).getByRole("table")).toHaveCount(0);
  await setRange(page, "2026-07-01", "2026-07-03");
  await expect(panel(page).getByRole("button", { name: "复盘这段时间", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expand(page);
  await expect(panel(page)).toContainText("这段时间还没有记账，等记下几笔，再一起看看");
  await expect(panel(page)).not.toContainText("¥0.00");
  await expect(panel(page).locator(".review-section")).toHaveCount(0);
  await expect(panel(page).getByRole("table")).toHaveCount(0);
});

test("pending legacy dates and an unavailable preceding range disable trend comparisons", async ({ page }) => {
  await start(page, fixture([
    transaction("待核对旧账", "2026-09-15T03:00:00Z", 25, { dateNeedsConfirmation: true }),
    transaction("前段已记账", "2026-09-05", 20),
    transaction("日期下界账目", "1900-01-01", 5),
  ]));
  await setRange(page); await expand(page);
  await expect(panel(page).locator(".review-status")).toContainText("有日期待核对");
  await openSection(page, "与上一段比较");
  await expect(panel(page)).toContainText("日期待核对的旧账");
  await expect(panel(page).getByRole("table")).toHaveCount(0);
  await allEvidence(page);
  await expect(panel(page).getByRole("region", { name: "复盘账目依据" })).toContainText("日期待核对");
  await setRange(page, "1900-01-01", "1900-01-01"); await expand(page);
  await openSection(page, "与上一段比较");
  await expect(panel(page)).toContainText("前一等长时段超出支持的日期范围");
  await expect(panel(page).getByRole("table")).toHaveCount(0);
});

test("unfinished month is labeled and changing dates or ledger clears stale expanded evidence", async ({ page }) => {
  await start(page); await expand(page);
  await expect(panel(page)).toContainText("这段时间还没结束");
  await openSection(page, "与上一段比较");
  await expect(panel(page)).toContainText("上一段 2026-08-02 至 2026-08-31（同为 30 天）");
  await allEvidence(page);
  await setRange(page); await expect(panel(page).getByRole("region", { name: "复盘账目依据" })).toHaveCount(0);
  await expand(page); await panel(page).getByRole("button", { name: /^查看这类支出：/ }).click();
  await page.getByRole("button", { name: /^切换账本，当前：/ }).click();
  await page.getByRole("dialog", { name: "切换账本", exact: true }).getByRole("button", { name: "家庭账本", exact: true }).click();
  await openBills(page); await setRange(page);
  await expect(panel(page).getByRole("button", { name: "复盘这段时间", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page).getByRole("region", { name: "复盘账目依据" })).toHaveCount(0);
  await expand(page);
  await expect(panel(page)).toHaveAttribute("aria-label", "家庭账本期间复盘");
  await expect(panel(page).locator(".review-conclusion")).toContainText("¥9,999.00");
  await expect(panel(page)).not.toContainText("个人餐饮");
});

test("evidence paging starts each full page at the top and returns to its trigger", async ({ page }) => {
  await start(page, fixture(Array.from({length:12},(_,i)=>transaction("依据"+i,"2026-09-12",i+1))));
  await setRange(page);await expand(page);
  await openSection(page, "查看收支");
  const review=panel(page), trigger=review.getByRole("button",{name:"查看本段全部账目",exact:true});
  await trigger.click();
  const evidence=review.getByRole("region",{name:"复盘账目依据"}), list=evidence.locator(".review-evidence-list");
  await expect(evidence).toBeFocused();
  await list.evaluate(element=>{element.scrollTop=100;});
  expect(await list.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
  await evidence.getByRole("button",{name:"下一页依据",exact:true}).click();
  await expect(evidence.locator("li")).toHaveCount(5);
  await expect.poll(()=>list.evaluate(element=>element.scrollTop)).toBe(0);
  await evidence.getByRole("button",{name:"收起账目依据",exact:true}).click();
  await expect(trigger).toBeFocused();
});

test("review stays readable at 320, 390 and 1280 pixels with bounded evidence", async ({ page }) => {
  await start(page); await setRange(page); await expand(page);
  await panel(page).getByRole("button", { name: /^查看这类支出：/ }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.view);
    expect(await panel(page).locator(".review-evidence-list").evaluate(element => element.clientHeight)).toBeLessThanOrEqual(330);
    await page.screenshot({ path: "test-results/period-review-" + width + ".png", fullPage: true });
  }
});
