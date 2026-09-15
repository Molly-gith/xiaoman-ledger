import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { runEvaluation, regressionGate } from "../evals/runner.mjs";
import { smokeCases } from "../evals/smoke-fixtures.mjs";

const source = await readFile(new URL("../lib/ai/adapter.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { createAIAdapter, validateTransactionDraft } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const draft = smokeCases[0].expected_structured_output;
const context = smokeCases[0].user_context;
const provider = (generate) => ({ generate, modelVersion: "test-only", workflowVersion: "test-v1" });

test("disabled adapter preserves original input and every operation remains available", async () => {
  const adapter = createAIAdapter();
  const text = "昨天 20 还是 200？\n需要核对";
  assert.deepEqual(await adapter.parseTransaction(text, context), { status: "manual", reason: "disabled", originalText: text });
  for (const operation of ["recommendNature", "generateDailyBrief", "generateCycleReview"]) {
    assert.equal((await adapter[operation]({}, context)).status, "manual");
  }
});

test("draft validation rejects invalid calendar dates, money, types and confidence", () => {
  assert.equal(validateTransactionDraft(draft), true);
  for (const fields of [{ occurred_at: "2026-02-30" }, { occurred_at: "2026-2-1" }, { amount: NaN }, { amount: 0 }, { amount: -2 }, { amount: 0.001 }, { amount: Infinity }, { type: "refund" }, { confidence: 1.1 }, { ambiguous: undefined }, { type: "income", nature_suggestion: "投资" }]) {
    assert.equal(validateTransactionDraft({ ...draft, ...fields }), false, JSON.stringify(fields));
  }
});

test("valid drafts always require user review; ambiguity and confidence are explicit", async () => {
  const result = await createAIAdapter(provider(async () => ({ ...draft, confidence: 0.3, ambiguous: true }))).parseTransaction("20或200", context);
  assert.equal(result.status, "suggestion");
  assert.equal(result.requiresConfirmation, true);
  assert.deepEqual(result.confirmationReasons, ["user_review", "low_confidence", "ambiguous_input"]);
  assert.equal(result.modelVersion, "test-only");
});

test("malformed output and provider failure return a usable manual fallback", async () => {
  const bad = await createAIAdapter(provider(async () => ({ ...draft, amount: "268" }))).parseTransaction("原文", context);
  assert.deepEqual(bad, { status: "manual", reason: "invalid_output", originalText: "原文" });
  const failed = await createAIAdapter(provider(async () => { throw new Error("private provider details"); })).parseTransaction("原文", context);
  assert.deepEqual(failed, { status: "manual", reason: "unavailable", originalText: "原文" });
});

test("hung providers time out and receive an abort signal", async () => {
  let signal;
  const adapter = createAIAdapter(provider((_operation, _input, _context, providerSignal) => { signal = providerSignal; return new Promise(() => {}); }), { timeoutMs: 5 });
  assert.equal((await adapter.parseTransaction("原文", context)).reason, "unavailable");
  assert.equal(signal.aborted, true);
});

test("brief and review schemas enforce shape and insight count", async () => {
  const facts = { metrics: { safeToSpend: 1000 }, signals: [] };
  assert.equal((await createAIAdapter(provider(async () => ({ summary: "状态", suggestion: null }))).generateDailyBrief(facts, context)).status, "suggestion");
  assert.equal((await createAIAdapter(provider(async () => ({ summary: "状态", suggestion: ["一", "二"] }))).generateDailyBrief(facts, context)).reason, "invalid_output");
  assert.equal((await createAIAdapter(provider(async () => ({ insights: ["1", "2", "3", "4"], explanation: "说明", next_cycle_suggestions: [] }))).generateCycleReview(facts, context)).reason, "invalid_output");
});

test("eval records disabled cases as skipped, never as a perfect baseline", async () => {
  const report = await runEvaluation(createAIAdapter(), smokeCases);
  assert.equal(report.evaluated, 0);
  assert.equal(report.skipped, 3);
  assert.equal(report.accuracy, null);
  assert.equal(regressionGate(report, report).allowed, false);
});

test("eval distinguishes severe amount/type errors and obvious nature errors", async () => {
  const adapter = createAIAdapter(provider(async (operation, input) => {
    const item = smokeCases.find((entry) => entry.capability === operation && JSON.stringify(entry.user_input) === JSON.stringify(input));
    return operation === "parseTransaction" ? { ...item.expected_structured_output, amount: item.expected_structured_output.amount * 10 }
      : { ...item.expected_structured_output, recommended_nature: "浪费" };
  }));
  const report = await runEvaluation(adapter, smokeCases);
  assert.equal(report.failed, 3);
  assert.equal(report.p0, 2);
  assert.ok(report.rows[2].failures.includes("obvious_nature_error"));
  const baseline = { ...report, p0Rate: 0 };
  assert.equal(regressionGate(baseline, report).reason, "p0_regression");
});
