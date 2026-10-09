import { test, expect, type Page } from "@playwright/test";
import { openLedger, setFunds, expectBalance } from "./ledger-helpers";

test.skip(process.env.AI_BROWSER_TEST !== "1", "Run against the AI-enabled mock endpoint build");
const endpoint = "https://xiaoman-ai-test.example/api/ai/question";
const token = "a".repeat(48);
async function setup(page: Page) {
  await openLedger(page);
  await setFunds(page);
}
async function consent(page: Page) {
  await page.getByRole("textbox", { name: "问小满", exact: true }).fill("本周期还能花多少？");
  await page.getByRole("button", { name: "发送给小满" }).click();
  await page.getByLabel("私人体验码（必填）", { exact: true }).fill(token);
  await page.locator('[name="aiConsent"]').check();
  await page.getByRole("button", { name: "同意并发送" }).click();
}
function answer(body: { snapshot: { referencedFacts: string[] } }) {
  return {
    status: "suggestion", value: { answer: "本周期可支出为 7500 元。", next_actions: ["先查看日常消费安排。"], referenced_facts: body.snapshot.referencedFacts.filter(fact => fact.startsWith("safe_to_spend:")), confidence: 0.9 },
    requiresConfirmation: true, confirmationReasons: ["user_review"], modelVersion: "test-only", workflowVersion: "test-only",
  };
}

test("AI sends nothing before explicit consent, uploads aggregates only and forgets access on refresh", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route(endpoint, async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer(body)) });
  });
  await setup(page);
  expect(requests).toHaveLength(0);
  await page.getByRole("textbox", { name: "问小满", exact: true }).fill("本周期还能花多少？");
  await page.getByRole("button", { name: "发送给小满" }).click();
  await expect(page.getByRole("heading", { name: "让小满理解这次提问" })).toBeVisible();
  await expect(page.locator('[name="aiConsent"]')).not.toBeChecked();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "暂不使用" }).click();
  expect(requests).toHaveLength(0);
  await consent(page);
  await expect(page.getByTestId("ai-answer")).toContainText("本周期可支出为 7500 元。");
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0] as object).sort()).toEqual(["consent", "context", "question", "snapshot"]);
  expect(JSON.stringify(requests[0])).not.toMatch(/transactions|accountName|note|apiKey/);
  await expectBalance(page, "¥7,500.00");
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(token);
  await page.screenshot({ path: "test-results/ai-question-mobile.png", fullPage: true });
  await page.reload();
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  await page.getByRole("textbox", { name: "问小满", exact: true }).fill("再问一次");
  await page.getByRole("button", { name: "发送给小满" }).click();
  await expect(page.locator('[name="aiConsent"]')).not.toBeChecked();
  expect(requests).toHaveLength(1);
});

test("rate limiting preserves question and leaves manual bookkeeping usable", async ({ page }) => {
  await page.route(endpoint, route => route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"rate_limited"}' }));
  await setup(page);
  await consent(page);
  await expect(page.getByRole("alert")).toContainText("一分钟后再试");
  await expect(page.getByRole("textbox", { name: "问小满", exact: true })).toHaveValue("本周期还能花多少？");
  await page.getByTestId("home-action-add").click();
  await page.locator('[name="amount"]').fill("20");
  await page.getByRole("button", { name: "餐饮", exact: true }).click();
  await page.getByRole("button", { name: "消费", exact: true }).click();
  await page.getByRole("button", { name: "记好了", exact: true }).click();
  await expectBalance(page, "¥7,480.00");
});

test("closing AI cancels an in-flight answer and requires renewed consent", async ({ page }) => {
  let release: (() => void) | undefined;
  let started = false;
  await page.route(endpoint, async route => {
    started = true;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer(route.request().postDataJSON())) }).catch(() => {});
  });
  await setup(page);
  await consent(page);
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "关闭 AI", exact: true }).click();
  release?.();
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  await page.getByRole("button", { name: "发送给小满" }).click();
  await expect(page.locator('[name="aiConsent"]')).not.toBeChecked();
});

test("fresh unknown funds can be asked about after consent without sending a fabricated zero balance", async ({ page }) => {
  const requests: { snapshot: { period: { safeToSpend: number | null }; referencedFacts: string[] } }[] = [];
  await page.route(endpoint, async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const response = answer(body);
    response.value.answer = "本周期可用资金还未设置，暂时无法判断还能花多少。";
    response.value.next_actions = ["可以先继续记账，再到我的补充周期资金。"];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await openLedger(page);
  expect(requests).toHaveLength(0);
  await consent(page);
  await expect(page.getByTestId("ai-answer")).toContainText("本周期可用资金还未设置");
  expect(requests).toHaveLength(1);
  expect(requests[0].snapshot.period.safeToSpend).toBeNull();
  await expectBalance(page, "未设置");
});

test("a calendar rollover clears an answer based on the previous period without another model request", async ({ page }) => {
  let requests = 0;
  await page.route(endpoint, async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer(route.request().postDataJSON())) });
  });
  await setup(page);
  await consent(page);
  await expect(page.getByTestId("ai-answer")).toContainText("7500");
  await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
  await page.clock.fastForward(31000);
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  await expectBalance(page, "未设置");
  expect(requests).toBe(1);
});
