import assert from "node:assert/strict";
import { open, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PREVIEW_URL = "https://molly-gith.github.io/xiaoman-ledger/previews/pr-24/";
export const ENDPOINT = "https://xiaoman-ai-beta.vercel.app/api/ai/assistant";
export const SYNTHETIC_INPUT = "今天工资到账8000，午饭35，冲动买没必要的摆件99";
const STEM = "live-browser-assistant-20261024";
const DEFAULT_EVIDENCE_DIR = join(homedir(), "Documents", "ChatGPT", "Agent开发", "work", "xiaoman-ai-beta-evidence", "everyday-20261024");

export function requestDecision(url, method, started) {
  const parsed = new URL(url);
  if (method === "OPTIONS") return "continue";
  if (parsed.pathname.startsWith("/api/ai/")) {
    return url === ENDPOINT && method === "POST" && started === 0 ? "allow_ai_once" : "block";
  }
  return method === "GET" || method === "HEAD" ? "continue" : "block";
}
export function expectedDrafts(drafts, today) {
  if (!Array.isArray(drafts) || drafts.length !== 3) return false;
  const matches = (type, amount, nature) => drafts.filter(item =>
    item && item.type === type && item.amount === amount && item.nature_suggestion === nature
    && item.occurred_at === today && item.ambiguous === false).length === 1;
  return matches("income", 8000, null) && matches("expense", 35, "消费") && matches("expense", 99, "浪费");
}
export function dryRunPlan() {
  return {
    mode: "dry_run", preview: PREVIEW_URL, endpoint: ENDPOINT, input: SYNTHETIC_INPUT,
    maximum_live_ai_requests: 1, automatic_retries: false, browser_started: false,
    storage: "new non-persistent Playwright browser context; no user profile or storageState",
    expected: { drafts: 3, income: 8000, expense: 134, balance: 7866, consumption: 35, waste: 99 },
    evidence_directory: DEFAULT_EVIDENCE_DIR,
    report_filename: STEM + ".json",
    command: "node evals/browser-live-assistant.mjs --live",
    note: "Run live only after deployment approval. Existing evidence report blocks reruns. No credentials or key files are read.",
  };
}

export async function runLive({ evidenceDir = DEFAULT_EVIDENCE_DIR } = {}) {
  if (!isAbsolute(evidenceDir) || !(await stat(evidenceDir)).isDirectory()) throw new Error("Evidence directory must already exist and be absolute");
  const reportPath = join(evidenceDir, STEM + ".json");
  // Exclusive claim is intentionally never deleted, even after a timeout. A timed-out
  // provider request may still cost money, so reruns require separate review.
  const claim = await open(reportPath, "wx");
  await claim.close();
  const report = {
    mode: "live_single_synthetic_browser_case", status: "running", preview: PREVIEW_URL,
    endpoint: ENDPOINT, input: SYNTHETIC_INPUT, started_at: new Date().toISOString(),
    ai_requests_started: 0, blocked_requests: 0, http_status: null, response_status: null,
    isolation: "fresh browser launch and newContext; no persistent profile; service workers blocked",
    checks: [], screenshots: [], undo: "not_checked", today: null,
    notice: "Single synthetic browser acceptance case; not a general model-quality verdict.",
  };
  const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  await persist();
  let browser, page;
  const checkpoint = async (name, action) => {
    try { await action(); report.checks.push({ name, status: "passed" }); await persist(); }
    catch (error) {
      report.checks.push({ name, status: "failed", error_type: error?.name ?? "Error" });
      throw error;
    }
  };
  const screenshot = async name => {
    const filename = STEM + "-" + name + ".png";
    await page.screenshot({ path: join(evidenceDir, filename), fullPage: true, timeout: 10000 });
    report.screenshots.push(filename);
  };
  try {
    const { chromium, expect } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, timezoneId: "Asia/Hong_Kong",
      locale: "zh-CN", serviceWorkers: "block", acceptDownloads: false,
    });
    // No request body, authorization header, cookie, token or raw error body is logged.
    await context.route("**/*", async route => {
      const request = route.request();
      const decision = requestDecision(request.url(), request.method(), report.ai_requests_started);
      if (decision === "block") {
        report.blocked_requests++;
        await route.abort("blockedbyclient"); return;
      }
      if (decision === "allow_ai_once") {
        let body;
        try { body = request.postDataJSON(); } catch { /* Invalid payload is blocked below. */ }
        const allowed = body && body.text === SYNTHETIC_INPUT
          && body.context?.today === report.today && body.context?.timezone === "Asia/Hong_Kong"
          && body.report?.transactionCount === 0 && body.report?.income === 0 && body.report?.expense === 0
          && Object.keys(body).every(key => ["text", "context", "report"].includes(key));
        if (!allowed) {
          report.blocked_requests++;
          await route.abort("blockedbyclient"); return;
        }
        report.ai_requests_started++;
        await persist(); // Record the budget consumption before allowing the actual request.
      }
      await route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    await checkpoint("new_preview_has_empty_ledger_and_no_required_setup", async () => {
      await page.goto(PREVIEW_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      assert.equal(page.url().replace(/#.*$/, ""), PREVIEW_URL);
      await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".tx-row")).toHaveCount(0);
      report.today = await page.evaluate(() => {
        const now = new Date();
        return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
      });
      assert.equal(report.ai_requests_started, 0);
      await screenshot("empty-home");
    });

    let responseBody;
    await checkpoint("one_request_returns_exactly_three_expected_drafts", async () => {
      await page.getByRole("textbox", { name: "记账或问小满", exact: true }).fill(SYNTHETIC_INPUT);
      // The sole send action. No retry, clarification follow-up or regenerated request.
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url() === ENDPOINT && response.request().method() === "POST", { timeout: 45000 }),
        page.getByRole("button", { name: "发送给小满", exact: true }).click(),
      ]);
      report.http_status = response.status();
      assert.equal(response.status(), 200);
      responseBody = await response.json();
      report.response_status = responseBody?.status ?? null;
      assert.equal(responseBody?.status, "transactions");
      assert.ok(expectedDrafts(responseBody.drafts, report.today));
      report.drafts = responseBody.drafts.map(item => ({
        type: item.type, amount: item.amount, category: item.category,
        date: item.occurred_at, nature: item.nature_suggestion,
      }));
      await expect(page.getByRole("region", { name: "待保存账目" })).toContainText("3 笔 · 尚未保存");
      await expect(page.locator(".draft-row")).toHaveCount(3);
      await expect(page.locator(".tx-row")).toHaveCount(0);
      assert.equal(report.ai_requests_started, 1);
      await screenshot("three-drafts");
    });
    await checkpoint("one_confirmation_saves_all_three_records", async () => {
      await page.getByRole("button", { name: "保存这 3 笔", exact: true }).click();
      await expect(page.getByRole("region", { name: "待保存账目" })).toHaveCount(0);
      await expect(page.locator(".tx-row")).toHaveCount(3);
      await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toHaveValue("");
      report.undo_available_before_refresh = await page.getByRole("button", { name: "撤销这次记账", exact: true }).isVisible();
      await screenshot("saved");
    });
    await checkpoint("refresh_preserves_three_records", async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await expect(page.getByRole("textbox", { name: "记账或问小满", exact: true })).toBeVisible();
      await expect(page.locator(".tx-row")).toHaveCount(3);
    });
    const expectTotals = async () => {
      await expect(page.locator(".bill-summary b")).toHaveText(["¥8,000.00", "¥134.00", "¥7,866.00"]);
      await expect(page.locator(".nature-summary strong")).toHaveText(["¥35.00", "¥99.00", "¥0.00", "¥0.00"]);
      await expect(page.locator(".bill-list .tx-row")).toHaveCount(3);
    };
    await checkpoint("current_month_income_expense_and_nature_totals_match", async () => {
      await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "账单", exact: true }).click();
      await expect(page.getByLabel("查看月份", { exact: true })).toHaveValue(report.today.slice(0, 7));
      await expectTotals(); await screenshot("month-report");
    });
    await checkpoint("inclusive_custom_day_range_matches_saved_records", async () => {
      await page.getByRole("button", { name: "自定义日期", exact: true }).click();
      await page.getByLabel("开始日期", { exact: true }).fill(report.today);
      await page.getByLabel("结束日期", { exact: true }).fill(report.today);
      await expectTotals(); await screenshot("custom-date-report");
    });
    await checkpoint("undo_checked_without_an_additional_ai_request", async () => {
      await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "记账", exact: true }).click();
      const undo = page.getByRole("button", { name: "撤销这次记账", exact: true });
      if (await undo.isVisible()) {
        await undo.click();
        await expect(page.locator(".tx-row")).toHaveCount(0);
        report.undo = "passed";
        await screenshot("undone");
      } else {
        report.undo = "not_available_after_refresh";
        report.undo_note = "The temporary batch undo action is not persisted across refresh; no second AI request was made to recreate it.";
      }
      assert.equal(report.ai_requests_started, 1);
      assert.equal(report.blocked_requests, 0);
    });
    report.status = "passed";
  } catch {
    report.status = "failed";
    if (page) await screenshot("failure").catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
    report.finished_at = new Date().toISOString();
    await persist();
  }
  return { status: report.status, ai_requests_started: report.ai_requests_started, report: reportPath, screenshots: report.screenshots };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && ["--dry-run", "--help"].includes(args[0]))) {
    console.log(JSON.stringify(dryRunPlan(), null, 2)); return;
  }
  if (args.length !== 1 || args[0] !== "--live") throw new Error("Use no flag for dry-run, or explicitly --live after deployment authorization");
  const evidenceDir = process.env.XIAOMAN_BROWSER_EVIDENCE_DIR ?? DEFAULT_EVIDENCE_DIR;
  const result = await runLive({ evidenceDir });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error?.code === "EEXIST" ? "Evidence report already exists; refusing to repeat a potentially billed request." : "Browser acceptance stopped before completion; inspect the local evidence report if created.");
    process.exitCode = 1;
  });
}
