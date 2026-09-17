import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai/openai-compatible-provider.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { createOpenAICompatibleProvider } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const context = { today: "2026-09-17", timezone: "Asia/Shanghai" };

test("OpenAI-compatible provider sends structured contract and parses JSON content", async () => {
  let request;
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1/",
    apiKey: "server-secret",
    model: "model-v1",
    workflowVersion: "code-v1",
    fetchFn: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ amount: 12, type: "expense" }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await provider.generate("parseTransaction", { text: "早餐12" }, context, new AbortController().signal);
  assert.deepEqual(result, { amount: 12, type: "expense" });
  assert.equal(request.url, "https://api.example.com/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer server-secret");
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "model-v1");
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /只能输出一个合法 JSON 对象/);
  assert.deepEqual(JSON.parse(body.messages[1].content), {
    operation: "parseTransaction",
    payload: { text: "早餐12" },
    context,
  });
});

test("financial-state prompt forbids stage guessing and requires cited facts", async () => {
  let prompt = "";
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "server-secret",
    model: "model-v1",
    workflowVersion: "financial-v1",
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      prompt = body.messages[0].content;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ status_summary: "状态", financial_stage: null, stage_evidence: [], top_insights: [], next_actions: [], referenced_facts: ["readiness:ready"], confidence: 0.9 }) } }],
      }), { status: 200 });
    },
  });
  await provider.generate("explainFinancialState", { referencedFacts: ["readiness:ready"] }, context, new AbortController().signal);
  assert.match(prompt, /financial_stage 必须为 null/);
  assert.match(prompt, /referenced_facts 必须逐字选择自 payload\.referencedFacts/);
  assert.match(prompt, /不得提供具体证券\/基金买卖指令/);
});

test("OpenAI-compatible provider records model/workflow metadata", () => {
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "deepseek-chat",
    modelVersion: "deepseek-chat-2026-09",
    workflowVersion: "xiaoman-code-v0.1",
  });
  assert.equal(provider.modelVersion, "deepseek-chat-2026-09");
  assert.equal(provider.workflowVersion, "xiaoman-code-v0.1");
});

test("OpenAI-compatible provider rejects unsafe config and secret-safe failures", async () => {
  assert.throws(() => createOpenAICompatibleProvider({ baseUrl: "http://example.com", apiKey: "secret", model: "m", workflowVersion: "wf" }), /https/);
  assert.throws(() => createOpenAICompatibleProvider({ baseUrl: "https://example.com", apiKey: "", model: "m", workflowVersion: "wf" }), /apiKey/);

  const failing = createOpenAICompatibleProvider({
    baseUrl: "https://example.com/v1",
    apiKey: "secret-value-that-must-not-leak",
    model: "m",
    workflowVersion: "wf",
    fetchFn: async () => new Response("denied", { status: 401 }),
  });
  await assert.rejects(
    () => failing.generate("parseTransaction", {}, context, new AbortController().signal),
    (error) => error instanceof Error && /status 401/.test(error.message) && !error.message.includes("secret-value"),
  );

  const malformed = createOpenAICompatibleProvider({
    baseUrl: "https://example.com/v1",
    apiKey: "secret",
    model: "m",
    workflowVersion: "wf",
    fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }),
  });
  await assert.rejects(() => malformed.generate("parseTransaction", {}, context, new AbortController().signal), /valid JSON/);
});
