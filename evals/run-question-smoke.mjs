import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { buildQuestionSmokeCases, QUESTION_SMOKE_ORIGIN } from "./question-smoke-fixtures.mjs";

export const MIN_START_INTERVAL_MS = 11_000;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_CASES = 20;
const NOTICE = "Structure checks only; answer correctness and safety require semantic review. This is not a Beta readiness verdict.";

const HELP = `Ask Xiaoman: 20 synthetic HTTP smoke cases (no real ledger data).

Offline default; no credentials or network needed:
  node evals/run-question-smoke.mjs
  node --test evals/question-smoke.test.mjs

Only after explicit authorization for the target deployment and model calls:
  node evals/run-question-smoke.mjs --live --report work/question-smoke-report.json

Live environment variables (read from process environment only; no .env or key files):
  XIAOMAN_SMOKE_ENDPOINT  Approved HTTPS URL ending exactly in /api/ai/question
  AI_BETA_TOKEN          Private beta experience code, never printed
  XIAOMAN_SMOKE_ORIGIN   Optional allowed origin; defaults to GitHub Pages origin

The report parent directory must already exist; an existing report is never overwritten.
Live mode sends at most 20 sequential requests, at least 11 seconds between starts.
There are no retries or redirects. Any HTTP error, timeout, network or response-reading
error stops the run and saves completed/unfinished statuses. A timeout may still incur
a provider charge. Do not rerun automatically. Raw HTTP errors and headers are omitted.
Valid answers are saved with credential redaction for a separate semantic review.
Required citation checks cannot prove that the prose uses those facts correctly.
Review expected_behavior and forbidden_behavior for every pending_review row.
Exit 0 means offline inputs or online structural checks passed, never semantic approval.
`;

class SmokeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Same in-memory TypeScript compilation pattern as the existing eval harness.
// Both modules have type-only imports, removed by TypeScript before loading.
export async function loadQuestionSmokeTools() {
  const modules = await Promise.all(["../lib/ai/question-request.ts", "../lib/ai/adapter.ts"].map(async path => {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    });
    return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  }));
  return { ...modules[0], validateFinancialQuestionAnswer: modules[1].validateFinancialQuestionAnswer };
}

export function validateSmokeCases(cases, validateQuestionRequest) {
  if (cases.length !== MAX_CASES || new Set(cases.map(item => item.case_id)).size !== MAX_CASES)
    throw new SmokeError("invalid_case_count_or_ids");
  for (const item of cases) {
    if (!validateQuestionRequest(item.input)
      || !item.required_facts.every(fact => item.input.snapshot.referencedFacts.includes(fact)))
      throw new SmokeError("invalid_synthetic_input");
  }
}

export function liveConfiguration(environment) {
  let endpoint, origin;
  try {
    endpoint = new URL(environment.XIAOMAN_SMOKE_ENDPOINT ?? "");
    origin = new URL(environment.XIAOMAN_SMOKE_ORIGIN ?? QUESTION_SMOKE_ORIGIN);
  } catch { throw new SmokeError("invalid_live_endpoint_or_origin"); }
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/api/ai/question"
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || origin.protocol !== "https:" || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash)
    throw new SmokeError("invalid_live_endpoint_or_origin");
  const token = environment.AI_BETA_TOKEN ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new SmokeError("missing_or_invalid_beta_token");
  return { endpoint: endpoint.href, origin: origin.origin, token };
}

function redact(text, token) {
  return text.replaceAll(token, "[REDACTED]")
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:app|sk)-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

function safeOutput(result, token) {
  return {
    answer: redact(result.value.answer, token),
    next_actions: result.value.next_actions.map(item => redact(item, token)),
    referenced_facts: [...result.value.referenced_facts],
    confidence: result.value.confidence,
    model_version: redact(result.modelVersion, token).slice(0, 200),
    workflow_version: redact(result.workflowVersion, token).slice(0, 200),
    requires_confirmation: true,
  };
}

export function createOfflineReport(cases) {
  return {
    mode: "offline_input_validation",
    notice: NOTICE,
    total: cases.length,
    model_calls: 0,
    input_validation: "passed",
    semantic_status: "not_run",
    rows: cases.map(item => ({
      case_id: item.case_id,
      source_case_id: item.source_case_id,
      input_validation: "passed",
      execution_status: "not_run",
      semantic_status: "not_run",
    })),
  };
}

export async function runLiveQuestionSmoke({ cases, tools, configuration, checkpoint, fetchFn = fetch,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  validateSmokeCases(cases, tools.validateQuestionRequest);
  if (typeof checkpoint !== "function") throw new SmokeError("report_checkpoint_required");
  // Revalidate configurations even when this function is used outside the CLI.
  const config = liveConfiguration({
    XIAOMAN_SMOKE_ENDPOINT: configuration.endpoint,
    XIAOMAN_SMOKE_ORIGIN: configuration.origin,
    AI_BETA_TOKEN: configuration.token,
  });
  const report = {
    mode: "live_http_smoke",
    notice: NOTICE,
    total: cases.length,
    attempted_requests: 0,
    model_calls: "not_verifiable_from_http; at most one workflow call per attempted request",
    input_validation: "passed",
    minimum_start_interval_ms: MIN_START_INTERVAL_MS,
    automatic_retries: 0,
    semantic_status: "not_run",
    stopped_reason: null,
    rows: cases.map(item => ({
      case_id: item.case_id,
      source_case_id: item.source_case_id,
      adaptation: item.adaptation,
      input: item.input,
      required_facts: item.required_facts,
      expected_behavior: item.expected_behavior,
      forbidden_behavior: item.forbidden_behavior,
      execution_status: "not_run",
      structure_status: "not_run",
      required_facts_status: "not_run",
      semantic_status: "not_run",
    })),
  };
  await checkpoint(report);
  let previousStart = null;
  for (let index = 0; index < MAX_CASES; index += 1) {
    if (previousStart !== null) {
      while (now() - previousStart < MIN_START_INTERVAL_MS)
        await wait(MIN_START_INTERVAL_MS - (now() - previousStart));
    }
    const item = cases[index], row = report.rows[index];
    row.execution_status = "in_progress";
    report.attempted_requests += 1;
    await checkpoint(report); // Preserve an uncertain attempt even if the process is interrupted.
    previousStart = now();
    row.started_at = new Date(previousStart).toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(config.endpoint, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Origin: config.origin, Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(item.input),
      });
      row.http_status = response.status;
      if (response.status !== 200) {
        // Never persist raw upstream error bodies, headers or exception messages.
        row.execution_status = "failed";
        row.structure_status = "failed";
        report.stopped_reason = `http_${response.status}`;
      } else {
        const result = await tools.readLimitedJson(response, 32_768);
        const validEnvelope = result !== null && typeof result === "object" && result.status === "suggestion"
          && result.requiresConfirmation === true && Array.isArray(result.confirmationReasons)
          && result.confirmationReasons.includes("user_review")
          && typeof result.modelVersion === "string" && !!result.modelVersion.trim()
          && typeof result.workflowVersion === "string" && !!result.workflowVersion.trim();
        const valid = validEnvelope && tools.validateFinancialQuestionAnswer(result.value, item.input.snapshot);
        row.execution_status = "completed";
        row.structure_status = valid ? "passed" : "failed";
        row.semantic_status = "pending_review";
        report.semantic_status = "pending_review";
        if (valid) {
          row.output = safeOutput(result, config.token);
          row.missing_required_facts = item.required_facts.filter(fact => !result.value.referenced_facts.includes(fact));
          row.required_facts_status = row.missing_required_facts.length ? "failed" : "passed";
        } else {
          row.required_facts_status = "not_evaluated";
          row.output_omitted_reason = "invalid_envelope_or_output; raw response deliberately omitted";
        }
      }
    } catch {
      row.execution_status = "failed";
      row.structure_status = "failed";
      report.stopped_reason = controller.signal.aborted ? "timeout" : "network_or_response_read_error";
    } finally {
      clearTimeout(timer);
      row.elapsed_ms = Math.max(0, now() - previousStart);
    }
    await checkpoint(report);
    if (report.stopped_reason) break;
  }
  return report;
}

function summary(report) {
  return {
    mode: report.mode,
    total: report.total,
    attempted_requests: report.attempted_requests ?? 0,
    model_calls: report.model_calls,
    input_validation: report.input_validation,
    structure_passed: report.rows.filter(row => row.structure_status === "passed").length,
    structure_failed: report.rows.filter(row => row.structure_status === "failed").length,
    required_facts_failed: report.rows.filter(row => row.required_facts_status === "failed").length,
    semantic_status: report.semantic_status,
    stopped_reason: report.stopped_reason ?? null,
    notice: report.notice,
  };
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.length === 1 && args[0] === "--help") { console.log(HELP); return; }
  const live = args.includes("--live");
  const reportIndex = args.indexOf("--report");
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
  const recognized = args.filter((_, index) => index !== reportIndex && index !== reportIndex + 1);
  if (args.length && (!live || recognized.length !== 1 || recognized[0] !== "--live"
    || !reportPath || reportPath.startsWith("--"))) throw new SmokeError("use_help_for_arguments");
  const tools = await loadQuestionSmokeTools();
  const cases = buildQuestionSmokeCases(tools.snapshotFacts);
  validateSmokeCases(cases, tools.validateQuestionRequest);
  if (!live) { console.log(JSON.stringify(createOfflineReport(cases), null, 2)); return; }
  if (reportIndex < 0) throw new SmokeError("live_report_path_required");
  const configuration = liveConfiguration(environment);
  let file;
  try {
    file = await open(resolve(reportPath), "wx", 0o600);
    const report = await runLiveQuestionSmoke({ cases, tools, configuration, checkpoint: async current => {
      const data = Buffer.from(JSON.stringify(current, null, 2) + "\n");
      let offset = 0;
      while (offset < data.length) {
        const { bytesWritten } = await file.write(data, offset, data.length - offset, offset);
        if (!bytesWritten) throw new SmokeError("report_write_failed");
        offset += bytesWritten;
      }
      await file.truncate(data.length);
      await file.sync();
    } });
    console.log(JSON.stringify(summary(report), null, 2));
    if (report.stopped_reason || report.rows.some(row => row.structure_status !== "passed" || row.required_facts_status !== "passed"))
      process.exitCode = 1;
  } finally { await file?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    // No raw messages/stacks: filesystem and network exceptions can contain secrets.
    console.error(JSON.stringify({ error: error instanceof SmokeError ? error.code : "smoke_setup_or_report_failed", model_quality_verdict: "not_assessed" }));
    process.exitCode = 1;
  }
}
