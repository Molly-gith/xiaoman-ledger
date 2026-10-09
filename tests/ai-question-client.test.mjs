import assert from "node:assert/strict";
import test from "node:test";
import { askFinancialQuestion } from "../lib/ai/question-client.ts";
import { BETA_TOKEN, ENDPOINT, PRIVATE_ERROR, PROVIDER_KEY, answerValue, questionBody, suggestion } from "./ai-fixture.mjs";

function assertSafeFailure(result) {
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, "string");
  assert.ok(result.message.length > 0);
  const text = JSON.stringify(result);
  for (const privateValue of [PRIVATE_ERROR, BETA_TOKEN, PROVIDER_KEY, questionBody().question]) {
    assert.equal(text.includes(privateValue), false);
  }
}

test("client sends consent and aggregate snapshot with safe request settings", async () => {
  const calls = [];
  const body = questionBody();
  const result = await askFinancialQuestion(ENDPOINT, BETA_TOKEN, body, {
    fetchFn: async (url, options) => { calls.push({ url, options }); return Response.json(suggestion()); },
  });
  assert.deepEqual(result, { ok: true, result: suggestion() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  const options = calls[0].options;
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, `Bearer ${BETA_TOKEN}`);
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), body);
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.signal.aborted, false);
  assert.equal(options.body.includes("private-account"), false);
});

test("client rejects unapproved input before fetch", async () => {
  let calls = 0;
  const body = questionBody();
  body.consent = false;
  const result = await askFinancialQuestion(ENDPOINT, BETA_TOKEN, body, { fetchFn: async () => { calls++; throw new Error("must not fetch"); } });
  assertSafeFailure(result);
  assert.equal(calls, 0);
});

test("client blocks insecure or credential-bearing endpoint URLs", async t => {
  for (const endpoint of [
    "http://public.example/api/ai/question",
    "https://user:password@xiaoman-test.example/api/ai/question",
    "https://xiaoman-test.example/api/ai/question?key=secret",
    "https://xiaoman-test.example/api/ai/question#secret",
    "not a URL",
  ]) {
    await t.test(endpoint, async () => {
      let calls = 0;
      const result = await askFinancialQuestion(endpoint, BETA_TOKEN, questionBody(), { fetchFn: async () => { calls++; return Response.json(suggestion()); } });
      assertSafeFailure(result);
      assert.equal(calls, 0);
    });
  }
});

test("client translates 401, 429 and service errors without echoing provider data", async t => {
  for (const status of [401, 429, 400, 500, 502, 503]) {
    await t.test(String(status), async () => {
      const result = await askFinancialQuestion(ENDPOINT, BETA_TOKEN, questionBody(), { fetchFn: async () => new Response(PRIVATE_ERROR, { status }) });
      assertSafeFailure(result);
      assert.equal(result.reauthorize === true, status === 401);
      if (status === 429) assert.match(result.message, /一分钟/);
    });
  }
});

test("client validates response again, including referenced facts and response size", async t => {
  const invalid = [
    ["malformed JSON", () => new Response("{")],
    ["non-suggestion", () => Response.json({ status: "manual", reason: PRIVATE_ERROR })],
    ["invented fact", () => Response.json(suggestion({ ...answerValue(), referenced_facts: ["safe_to_spend:99999"] }))],
    ["extra output field", () => Response.json(suggestion({ ...answerValue(), debug: PRIVATE_ERROR }))],
    ["missing model version", () => { const value = suggestion(); delete value.modelVersion; return Response.json(value); }],
    ["oversized response", () => new Response(" ".repeat(16385))],
  ];
  for (const [name, response] of invalid) {
    await t.test(name, async () => {
      const result = await askFinancialQuestion(ENDPOINT, BETA_TOKEN, questionBody(), { fetchFn: async () => response() });
      assertSafeFailure(result);
    });
  }
});

test("client catches transport errors without leaking raw error or input", async () => {
  assertSafeFailure(await askFinancialQuestion(ENDPOINT, BETA_TOKEN, questionBody(), {
    fetchFn: async () => { throw new Error(PRIVATE_ERROR + PROVIDER_KEY + BETA_TOKEN); },
  }));
});

test("client cancellation propagates to in-flight request and preserves caller input", async () => {
  const controller = new AbortController();
  const body = questionBody();
  const original = structuredClone(body);
  let requestSignal;
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const pending = askFinancialQuestion(ENDPOINT, BETA_TOKEN, body, {
    signal: controller.signal,
    fetchFn: async (_url, options) => {
      requestSignal = options.signal;
      notifyStarted();
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException(PRIVATE_ERROR, "AbortError")), { once: true }));
    },
  });
  await started;
  controller.abort();
  const result = await pending;
  assertSafeFailure(result);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(body, original);
});

test("already cancelled requests carry an aborted signal and fail safely", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await askFinancialQuestion(ENDPOINT, BETA_TOKEN, questionBody(), {
    signal: controller.signal,
    fetchFn: async (_url, options) => {
      assert.equal(options.signal.aborted, true);
      throw new DOMException(PRIVATE_ERROR, "AbortError");
    },
  });
  assertSafeFailure(result);
});

test("client deadline aborts hung network call even if fetch ignores abort", async () => {
  let requestSignal;
  const result = await askFinancialQuestion(ENDPOINT, BETA_TOKEN, questionBody(), {
    timeoutMs: 10,
    fetchFn: async (_url, options) => { requestSignal = options.signal; return new Promise(() => {}); },
  });
  assertSafeFailure(result);
  assert.equal(requestSignal.aborted, true);
});
