import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assistantV03SeedCases } from "./v0.3-assistant-cases.mjs";
import { buildQuestionSmokeCases } from "./question-smoke-fixtures.mjs";
import { loadQuestionSmokeTools, validateSmokeCases, liveConfiguration, runLiveQuestionSmoke, MIN_START_INTERVAL_MS } from "./run-question-smoke.mjs";

const tools = await loadQuestionSmokeTools();
const token = "synthetic_only_beta_token_0123456789abcdef";
const configuration = { endpoint: "https://synthetic.example/api/ai/question", origin: "https://molly-gith.github.io", token };
const makeCases = () => buildQuestionSmokeCases(tools.snapshotFacts);

function validResult(item, overrides = {}) {
  return {
    status: "suggestion", requiresConfirmation: true, confirmationReasons: ["user_review"],
    modelVersion: "synthetic-model-not-real", workflowVersion: "synthetic-workflow-not-real",
    value: { answer: "合成测试响应，只验证执行器，内容尚未语义评审。", next_actions: [], referenced_facts: item.required_facts, confidence: 0.9 },
    ...overrides,
  };
}

function harness(cases, respond) {
  let time = 1_700_000_000_000;
  const starts = [], reports = [];
  return {
    starts, reports,
    options: {
      cases, tools, configuration,
      now: () => time,
      wait: async ms => { time += ms; },
      checkpoint: async report => { reports.push(structuredClone(report)); },
      fetchFn: async (url, options) => {
        assert.equal(url, configuration.endpoint);
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, `Bearer ${token}`);
        assert.equal(options.headers.Origin, configuration.origin);
        assert.equal(options.method, "POST");
        const index = starts.length;
        starts.push(time);
        assert.deepEqual(JSON.parse(options.body), cases[index].input);
        return respond(index, options);
      },
    },
  };
}

test("all 20 independent synthetic inputs satisfy the current HTTP contract without changing old seeds", () => {
  const before = JSON.stringify(assistantV03SeedCases);
  const cases = makeCases();
  validateSmokeCases(cases, tools.validateQuestionRequest);
  assert.equal(cases.length, 20);
  assert.equal(JSON.stringify(assistantV03SeedCases), before);
  for (const item of cases) {
    assert.equal(item.input.snapshot.asOfDate, item.input.context.today);
    assert.equal("comparison" in item.input.snapshot, false);
    assert.equal("investmentAccounts" in item.input.snapshot, false);
    if (item.input.snapshot.unresolvedCount > 0) assert.equal(item.input.snapshot.period.safeToSpend, null);
  }
  cases[0].input.snapshot.period.safeToSpend = 1;
  assert.equal(cases[1].input.snapshot.period.safeToSpend, 7000);
});

test("default CLI only validates inputs; it does not require live configuration or call a model", () => {
  const child = spawnSync(process.execPath, ["evals/run-question-smoke.mjs"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8",
    env: { SystemRoot: process.env.SystemRoot ?? "", XIAOMAN_SMOKE_ENDPOINT: "invalid-and-must-not-be-read" },
  });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.mode, "offline_input_validation");
  assert.equal(report.total, 20);
  assert.equal(report.model_calls, 0);
  assert.equal(report.semantic_status, "not_run");
});

test("20 calls are sequential, at least 11 seconds apart, with semantic results always pending", async () => {
  const cases = makeCases();
  const run = harness(cases, index => Response.json(validResult(cases[index])));
  const report = await runLiveQuestionSmoke(run.options);
  assert.equal(run.starts.length, 20);
  for (let index = 1; index < run.starts.length; index += 1)
    assert.ok(run.starts[index] - run.starts[index - 1] >= MIN_START_INTERVAL_MS);
  assert.equal(report.automatic_retries, 0);
  assert.equal(report.semantic_status, "pending_review");
  assert.ok(report.rows.every(row => row.structure_status === "passed" && row.semantic_status === "pending_review"));
  assert.ok(run.reports.some(saved => saved.rows[0].execution_status === "in_progress"));
});

for (const status of [502, 503, 429, 401]) {
  test(`HTTP ${status} saves safe results and stops without retry`, async () => {
    const cases = makeCases();
    const run = harness(cases, index => index === 0 ? Response.json(validResult(cases[index]))
      : new Response(`sensitive upstream: ${token}`, { status }));
    const report = await runLiveQuestionSmoke(run.options);
    assert.equal(run.starts.length, 2);
    assert.equal(report.stopped_reason, `http_${status}`);
    assert.equal(report.rows[2].execution_status, "not_run");
    assert.equal(JSON.stringify(run.reports).includes(token), false);
    assert.deepEqual(run.reports.at(-1), report);
  });
}

test("network exceptions and invalid JSON are never logged and stop immediately", async () => {
  const cases = makeCases();
  for (const respond of [() => { throw new Error(token); }, () => new Response(token)]) {
    const run = harness(cases, respond);
    const report = await runLiveQuestionSmoke(run.options);
    assert.equal(run.starts.length, 1);
    assert.equal(report.stopped_reason, "network_or_response_read_error");
    assert.equal(JSON.stringify(run.reports).includes(token), false);
  }
});

test("timeout aborts the sole request, saves the incomplete run, and never retries", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const run = harness(makeCases(), (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error(`synthetic timeout ${token}`)), { once: true });
    markStarted();
  }));
  const completed = runLiveQuestionSmoke(run.options);
  await started;
  context.mock.timers.tick(35_000);
  const report = await completed;
  assert.equal(run.starts.length, 1);
  assert.equal(report.stopped_reason, "timeout");
  assert.equal(report.rows[1].execution_status, "not_run");
  assert.equal(JSON.stringify(run.reports).includes(token), false);
  assert.deepEqual(run.reports.at(-1), report);
});

test("answer/report strings redact echoed beta and provider key patterns", async () => {
  const cases = makeCases();
  const providerKey = "app-synthetic_provider_credential_012345";
  const run = harness(cases, index => Response.json(validResult(cases[index], {
    modelVersion: token,
    value: {
      answer: `Echo ${token} ${providerKey} Bearer synthetic_secret_123`,
      next_actions: [`Do not use ${token}`], referenced_facts: cases[index].required_facts, confidence: 0.9,
    },
  })));
  const report = await runLiveQuestionSmoke(run.options);
  const saved = JSON.stringify(run.reports);
  assert.equal(saved.includes(token), false);
  assert.equal(saved.includes(providerKey), false);
  assert.equal(saved.includes("synthetic_secret_123"), false);
  assert.match(report.rows[0].output.answer, /REDACTED/);
  assert.equal(report.rows[0].semantic_status, "pending_review");
});

test("missing expected citations fail a separate check even when response structure is valid", async () => {
  const cases = makeCases();
  const run = harness(cases, index => Response.json(validResult(cases[index], {
    value: { answer: "未引用必要事实。", next_actions: [], referenced_facts: [], confidence: 0.9 },
  })));
  const report = await runLiveQuestionSmoke(run.options);
  assert.equal(report.rows[0].structure_status, "passed");
  assert.equal(report.rows[0].required_facts_status, "failed");
  assert.equal(report.rows[0].semantic_status, "pending_review");
});

test("live configuration rejects credential-bearing URLs and wrong API paths before any call", () => {
  for (const endpoint of ["http://example.test/api/ai/question", "https://user:pass@example.test/api/ai/question",
    "https://example.test/api/ai/question?token=secret", "https://example.test/api/ai/question#secret", "https://example.test/other"]) {
    assert.throws(() => liveConfiguration({ XIAOMAN_SMOKE_ENDPOINT: endpoint, AI_BETA_TOKEN: token }));
  }
  assert.throws(() => liveConfiguration({ XIAOMAN_SMOKE_ENDPOINT: configuration.endpoint, AI_BETA_TOKEN: "short" }));
});

test("unexpected extra cases and report failures fail closed before network", async () => {
  const cases = makeCases();
  const run = harness(cases, index => Response.json(validResult(cases[index])));
  await assert.rejects(runLiveQuestionSmoke({ ...run.options, cases: [...cases, cases[0]] }));
  await assert.rejects(runLiveQuestionSmoke({ ...run.options, checkpoint: async () => { throw new Error("synthetic write failure"); } }));
  assert.equal(run.starts.length, 0);
});
