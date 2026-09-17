import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai/adapter.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { createAIAdapter } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const context = { today: "2026-09-17", timezone: "Asia/Shanghai" };
const provider = (generate) => ({ generate, modelVersion: "test-model", workflowVersion: "financial-contract-v1" });
const snapshot = {
  asOfDate: "2026-09-17",
  readiness: "ready",
  unresolvedCount: 0,
  period: {
    safeToSpend: 3200,
    consumptionSpend: 6000,
    wasteSpend: 300,
    investmentSpend: 2500,
    investmentTarget: 3000,
    investmentGap: 500,
  },
  investmentAssets: {
    accountCount: 1,
    totalMarketValue: 50000,
    totalNetContribution: 45000,
    totalFloatingPnL: 5000,
    hasUnknownCost: false,
  },
  referencedFacts: [
    "as_of:2026-09-17",
    "readiness:ready",
    "safe_to_spend:3200",
    "investment_gap:500",
    "investment_market_value:50000",
    "investment_floating_pnl:5000",
  ],
};

const validState = {
  status_summary: "当前数据完整，可以先关注本周期可支出和投资缺口。",
  financial_stage: null,
  stage_evidence: [],
  top_insights: ["本周期安心可花为3200元。", "距离投资目标还差500元。"],
  next_actions: ["优先按当前预算完成本周期。"],
  referenced_facts: ["safe_to_spend:3200", "investment_gap:500"],
  confidence: 0.92,
};

test("financial state explanation accepts only cited deterministic facts", async () => {
  const result = await createAIAdapter(provider(async () => validState)).explainFinancialState(snapshot, context);
  assert.equal(result.status, "suggestion");
  assert.deepEqual(result.value.referenced_facts, ["safe_to_spend:3200", "investment_gap:500"]);
});

test("financial stage cannot be invented when no deterministic stage fact exists", async () => {
  const result = await createAIAdapter(provider(async () => ({
    ...validState,
    financial_stage: "稳定积累期",
    stage_evidence: ["投资进度较好"],
  }))).explainFinancialState(snapshot, context);
  assert.deepEqual(result, { status: "manual", reason: "invalid_output" });
});

test("financial stage is accepted only when it matches a deterministic stage fact", async () => {
  const stagedSnapshot = {
    ...snapshot,
    referencedFacts: [...snapshot.referencedFacts, "financial_stage:数据建立期"],
  };
  const result = await createAIAdapter(provider(async () => ({
    ...validState,
    financial_stage: "数据建立期",
    stage_evidence: ["系统规则已标记当前阶段为数据建立期。"],
    referenced_facts: ["financial_stage:数据建立期", "readiness:ready"],
  }))).explainFinancialState(stagedSnapshot, context);
  assert.equal(result.status, "suggestion");
  assert.equal(result.value.financial_stage, "数据建立期");
});

test("financial assistant rejects references that are not in the snapshot", async () => {
  const result = await createAIAdapter(provider(async () => ({
    ...validState,
    referenced_facts: ["safe_to_spend:3200", "salary_growth:20%"],
  }))).explainFinancialState(snapshot, context);
  assert.deepEqual(result, { status: "manual", reason: "invalid_output" });
});

test("financial cycle review must cite snapshot facts and caps insight count", async () => {
  const adapter = createAIAdapter(provider(async () => ({
    insights: ["本周期仍有可支出空间。"],
    explanation: "依据当前安心可花和投资缺口，先保持既定节奏。",
    next_cycle_suggestions: ["继续补齐投资目标。"],
    referenced_facts: ["safe_to_spend:3200", "investment_gap:500"],
  })));
  assert.equal((await adapter.generateFinancialCycleReview(snapshot, context)).status, "suggestion");

  const bad = createAIAdapter(provider(async () => ({
    insights: ["1", "2", "3", "4"],
    explanation: "说明",
    next_cycle_suggestions: [],
    referenced_facts: ["safe_to_spend:3200"],
  })));
  assert.equal((await bad.generateFinancialCycleReview(snapshot, context)).reason, "invalid_output");
});

test("financial cycle review rejects invented trend facts", async () => {
  const result = await createAIAdapter(provider(async () => ({
    insights: ["餐饮比上月上涨20%。"],
    explanation: "趋势变差。",
    next_cycle_suggestions: ["减少餐饮。"],
    referenced_facts: ["food_month_over_month:+20%"],
  }))).generateFinancialCycleReview(snapshot, context);
  assert.deepEqual(result, { status: "manual", reason: "invalid_output" });
});
