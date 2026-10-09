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
  ],
};

const provider = (generate) => ({ generate, modelVersion: "test-model", workflowVersion: "question-contract-v1" });

test("financial question passes user question and accepts cited deterministic facts", async () => {
  let received;
  const adapter = createAIAdapter(provider(async (operation, input) => {
    received = { operation, input };
    return {
      answer: "本周期安心可花为 3200 元，投资目标还差 500 元。",
      next_actions: ["先按当前可支出节奏执行。"],
      referenced_facts: ["safe_to_spend:3200", "investment_gap:500"],
      confidence: 0.93,
    };
  }));

  const result = await adapter.answerFinancialQuestion({ question: "我现在还能花多少钱？", snapshot }, context);
  assert.equal(result.status, "suggestion");
  assert.equal(received.operation, "answerFinancialQuestion");
  assert.equal(received.input.question, "我现在还能花多少钱？");
  assert.equal(received.input.snapshot, snapshot);
});

test("financial safety answer may cite zero facts", async () => {
  const adapter = createAIAdapter(provider(async () => ({
    answer: "我不能保证某只基金最赚钱，也不能替你下具体买卖指令。可以基于你的现有资产和投入目标做结构分析。",
    next_actions: ["先明确风险承受能力和资金用途。"],
    referenced_facts: [],
    confidence: 0.96,
  })));
  const result = await adapter.answerFinancialQuestion({ question: "推荐一个最赚钱的基金", snapshot }, context);
  assert.equal(result.status, "suggestion");
  assert.deepEqual(result.value.referenced_facts, []);
});

test("financial question rejects invented fact references", async () => {
  const adapter = createAIAdapter(provider(async () => ({
    answer: "你的工资增长了 20%。",
    next_actions: [],
    referenced_facts: ["salary_growth:20%"],
    confidence: 0.9,
  })));
  const result = await adapter.answerFinancialQuestion({ question: "最近工资变化怎么样？", snapshot }, context);
  assert.deepEqual(result, { status: "manual", reason: "invalid_output", originalText: "最近工资变化怎么样？" });
});

test("financial question fails closed before provider call when question is blank", async () => {
  let calls = 0;
  const adapter = createAIAdapter(provider(async () => {
    calls += 1;
    return {};
  }));
  const result = await adapter.answerFinancialQuestion({ question: "   ", snapshot }, context);
  assert.equal(result.status, "manual");
  assert.equal(result.reason, "invalid_output");
  assert.equal(calls, 0);
});
