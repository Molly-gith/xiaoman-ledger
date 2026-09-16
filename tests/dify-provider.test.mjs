import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai/dify-provider.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { createDifyProvider } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const context = { today: "2026-09-16", timezone: "Asia/Shanghai" };

test("Dify provider sends the stable workflow contract and parses result_json", async () => {
  let request;
  const provider = createDifyProvider({
    baseUrl: "https://api.dify.ai/",
    apiKey: "server-secret",
    workflowVersion: "wf-v1",
    modelVersion: "model-v1",
    userId: "eval-user",
    fetchFn: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ data: { outputs: { result_json: JSON.stringify({ amount: 12 }) } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await provider.generate("parseTransaction", { text: "早餐12" }, context, new AbortController().signal);
  assert.deepEqual(result, { amount: 12 });
  assert.equal(request.url, "https://api.dify.ai/v1/workflows/run");
  assert.equal(request.init.headers.Authorization, "Bearer server-secret");
  const body = JSON.parse(request.init.body);
  assert.equal(body.response_mode, "blocking");
  assert.equal(body.user, "eval-user");
  assert.equal(body.inputs.operation, "parseTransaction");
  assert.deepEqual(JSON.parse(body.inputs.payload), { text: "早餐12" });
  assert.deepEqual(JSON.parse(body.inputs.context), context);
});

test("Dify provider accepts object output during prototype migration", async () => {
  const provider = createDifyProvider({
    baseUrl: "https://example.com",
    apiKey: "secret",
    workflowVersion: "wf-v1",
    modelVersion: "model-v1",
    fetchFn: async () => new Response(JSON.stringify({ data: { outputs: { result: { recommended_nature: "消费" } } } }), { status: 200 }),
  });
  assert.deepEqual(await provider.generate("recommendNature", {}, context, new AbortController().signal), { recommended_nature: "消费" });
});

test("Dify provider rejects unsafe configuration and malformed responses", async () => {
  assert.throws(() => createDifyProvider({ baseUrl: "http://example.com", apiKey: "secret", workflowVersion: "wf", modelVersion: "m" }), /https/);
  assert.throws(() => createDifyProvider({ baseUrl: "https://example.com", apiKey: "", workflowVersion: "wf", modelVersion: "m" }), /apiKey/);

  const failing = createDifyProvider({
    baseUrl: "https://example.com",
    apiKey: "secret-value-that-must-not-leak",
    workflowVersion: "wf",
    modelVersion: "m",
    fetchFn: async () => new Response("denied", { status: 401 }),
  });
  await assert.rejects(
    () => failing.generate("parseTransaction", {}, context, new AbortController().signal),
    (error) => error instanceof Error && /status 401/.test(error.message) && !error.message.includes("secret-value"),
  );

  const malformed = createDifyProvider({
    baseUrl: "https://example.com",
    apiKey: "secret",
    workflowVersion: "wf",
    modelVersion: "m",
    fetchFn: async () => new Response(JSON.stringify({ data: { outputs: { result_json: "not-json" } } }), { status: 200 }),
  });
  await assert.rejects(() => malformed.generate("parseTransaction", {}, context, new AbortController().signal), /valid JSON/);
});
