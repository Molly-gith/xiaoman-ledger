import assert from "node:assert/strict";
import test from "node:test";
import { baselineCases } from "../evals/baseline-cases.mjs";
import { runEvaluation } from "../evals/runner.mjs";

const ids = baselineCases.map((item) => item.case_id);
const parseCases = baselineCases.filter((item) => item.capability === "parseTransaction");
const natureCases = baselineCases.filter((item) => item.capability === "recommendNature");

test("baseline V0.1 contains 80 unique reviewed seed cases", () => {
  assert.equal(baselineCases.length, 80);
  assert.equal(new Set(ids).size, 80);
  assert.equal(ids.filter((id) => id.startsWith("NL-")).length, 30);
  assert.equal(ids.filter((id) => id.startsWith("CAT-")).length, 20);
  assert.equal(ids.filter((id) => id.startsWith("NAT-")).length, 30);
});

test("transaction baseline cases have deterministic expected fields", () => {
  assert.equal(parseCases.length, 50);
  for (const item of parseCases) {
    assert.ok(item.user_input.length > 0, item.case_id);
    assert.equal(item.user_context.today, "2026-09-16", item.case_id);
    assert.equal(item.user_context.timezone, "Asia/Shanghai", item.case_id);
    assert.ok(["income", "expense"].includes(item.expected_structured_output.type), item.case_id);
    assert.ok(item.expected_structured_output.amount > 0, item.case_id);
    assert.match(item.expected_structured_output.occurred_at, /^\d{4}-\d{2}-\d{2}$/, item.case_id);
    assert.ok(item.expected_structured_output.category.length > 0, item.case_id);
  }
});

test("nature baseline permits ambiguity instead of forcing one gold label", () => {
  assert.equal(natureCases.length, 30);
  assert.ok(natureCases.some((item) => item.acceptable_labels.length > 1));
  for (const item of natureCases) {
    assert.ok(item.acceptable_labels.length >= 1, item.case_id);
    for (const label of item.acceptable_labels) assert.ok(["消费", "浪费", "投资"].includes(label), item.case_id);
    for (const label of item.unacceptable_labels) assert.ok(["消费", "浪费", "投资"].includes(label), item.case_id);
    assert.equal(item.acceptable_labels.some((label) => item.unacceptable_labels.includes(label)), false, item.case_id);
  }
});

test("live-provider fallback counts as a failed eval case rather than being skipped", async () => {
  const adapter = {
    parseTransaction: async () => ({ status: "manual", reason: "unavailable" }),
  };
  const report = await runEvaluation(adapter, [parseCases[0]]);
  assert.equal(report.total, 1);
  assert.equal(report.evaluated, 1);
  assert.equal(report.skipped, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.accuracy, 0);
  assert.equal(report.rows[0].status, "failed");
  assert.deepEqual(report.rows[0].failures, ["manual_fallback"]);
});
