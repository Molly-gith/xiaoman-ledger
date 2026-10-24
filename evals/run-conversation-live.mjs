import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { V2_ASSISTANT_CASES, LEGACY_COMPATIBILITY_CASES } from "./v2-assistant-cases.mjs";
import { validateAssistantDraft, validateAssistantRequest } from "../lib/ai/assistant-contract.ts";
import { validateConversationRequest, validatePreferenceProposal } from "../lib/ai/conversation-contract.ts";
import { validateQueryPlan } from "../lib/domain/ledger-query.ts";
import { readLimitedJson } from "../lib/ai/question-request.ts";

// No .env, account credentials, real ledger, fake IP, or configurable host.
export const ENDPOINT = "https://xiaoman-ai-beta.vercel.app/api/ai/assistant";
export const ORIGIN = "https://molly-gith.github.io";
export const MAX_REQUESTS = 12;
export const WAIT_BETWEEN_REQUESTS_MS = 11_000;
export const REQUEST_TIMEOUT_MS = 30_000;
const selectedIds = ["v2-01", "v2-02", "v2-03", "v2-04", "v2-05", "v2-13", "v2-14", "v2-15", "v2-17", "v2-19", "v2-21", "legacy-01"];
const projectDir = fileURLToPath(new URL("../", import.meta.url));
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const draftFields = ["type", "amount", "category", "occurred_at", "nature_suggestion"];

export function buildCases() {
  const available = [...V2_ASSISTANT_CASES, ...LEGACY_COMPATIBILITY_CASES];
  return selectedIds.map(id => {
    const item = structuredClone(available.find(candidate => candidate.id === id));
    if (!item) throw Error(`missing_fixture:${id}`);
    if (id === "v2-04") item.previousClarification = "v2-03";
    if (id === "legacy-01") item.expected.transactions = item.referenceOutput.transactions.map(draft => Object.fromEntries(draftFields.map(key => [key, draft[key]])));
    // Human-authored references are not attached to live reports as model results.
    delete item.referenceOutput;
    return item;
  });
}

export function bodyFor(item, completed = []) {
  const body = { ...structuredClone(item.input.payload), context: { ...item.input.context } };
  if (item.input.operation === "assistLedgerV2") body.protocolVersion = 2;
  else if (item.input.operation !== "assistLedger") throw Error("unsupported_public_operation");
  if (item.previousClarification) {
    const previous = completed.find(row => row.id === item.previousClarification);
    if (!previous || previous.output?.status !== "clarification") throw Error("previous_clarification_unavailable");
    body.clarification = { originalText: previous.input.text, question: previous.output.question, answer: body.text };
    body.memory.recentMessages = [{ role: "user", content: previous.input.text }, { role: "assistant", content: previous.output.question }];
  }
  const valid = body.protocolVersion === 2 ? validateConversationRequest(body) : validateAssistantRequest(body);
  if (!valid) throw Error(`invalid_synthetic_request:${item.id}`);
  return body;
}

function validPublicResult(value, today) {
  if (!record(value)) return false;
  if (value.status === "query") return exactKeys(value, ["status", "plan"]) && validateQueryPlan(value.plan);
  if (value.status === "preference") return exactKeys(value, ["status", "preference"]) && validatePreferenceProposal(value.preference);
  if (value.status === "clarification") return exactKeys(value, ["status", "question"]) && typeof value.question === "string" && !!value.question.trim() && value.question.length <= 300;
  if (value.status === "answer") return exactKeys(value, ["status", "answer", "nextActions"]) && typeof value.answer === "string" && !!value.answer.trim() && value.answer.length <= 1200
    && Array.isArray(value.nextActions) && value.nextActions.length <= 3 && value.nextActions.every(action => typeof action === "string" && !!action.trim() && action.length <= 300);
  return value.status === "transactions" && exactKeys(value, ["status", "drafts", "modelVersion", "workflowVersion"])
    && Array.isArray(value.drafts) && value.drafts.length >= 1 && value.drafts.length <= 5
    && value.drafts.every(draft => validateAssistantDraft(draft, today) && !draft.ambiguous)
    && [value.modelVersion, value.workflowVersion].every(version => typeof version === "string" && version.trim().length > 0 && version.length <= 200);
}
function canonicalPlan(plan, ledgerKind) {
  return { range: { startDate: plan.range.startDate, endDate: plan.range.endDate }, ledgerKind: plan.ledgerKind ?? ledgerKind, type: plan.type, metric: plan.metric,
    categories: plan.type === "income" ? [] : [...(plan.categories ?? [])].sort(), natures: [...(plan.natures ?? [])].sort(), comparison: plan.comparison ?? null,
    breakdownBy: plan.metric === "breakdown" ? plan.breakdownBy ?? "category" : null };
}

export function checkResult(item, input, value) {
  const structural = [{ name: "公开接口返回合法且互斥的状态和字段", pass: validPublicResult(value, input.context.today) }];
  const automatedSemantic = [];
  const check = (name, pass) => automatedSemantic.push({ name, pass: !!pass });
  check(`意图符合案例：${item.expected.intent}`, value?.status === item.expected.intent);
  if (item.expected.transactions) {
    const remaining = Array.isArray(value?.drafts) ? [...value.drafts] : [];
    check("草稿数完整，不复制历史记录或重复新增", remaining.length === item.expected.transactions.length);
    for (const expected of item.expected.transactions) {
      const index = remaining.findIndex(draft => draftFields.every(key => draft[key] === expected[key]));
      check(`待保存${expected.type === "income" ? "收入" : "支出"}：${expected.amount}元／${expected.category}／${expected.occurred_at}／${expected.nature_suggestion ?? "无支出性质"}`, index >= 0);
      if (index >= 0) remaining.splice(index, 1);
    }
  }
  if (item.expected.query) {
    check("查询范围、账本、收支、分类、性质、指标及对比方式正确",
      validateQueryPlan(value?.plan) && JSON.stringify(canonicalPlan(value.plan, input.ledgerKind)) === JSON.stringify(canonicalPlan(item.expected.query, input.ledgerKind)));
    check("只返回查询计划，不伪造金额或已执行结果", exactKeys(value, ["status", "plan"]));
  }
  if (item.expected.preference) {
    check("偏好关键词、分类及性质准确", record(value?.preference) && Object.entries(item.expected.preference).every(([key, expected]) => value.preference[key] === expected));
    check("仅提出偏好，未声称已经保存", exactKeys(value, ["status", "preference"]));
  }
  if (item.expected.intent === "clarification") {
    check("只补问，没有交易或查询结果", exactKeys(value, ["status", "question"]));
    if (item.id === "v2-03") check("补问缺失的金额", typeof value?.question === "string" && /多少|金额|价格|价钱|花了|费用/.test(value.question));
    if (item.id === "v2-21") check("澄清转账与收入的口径", typeof value?.question === "string" && /转账|转入|账户|银行卡|收入|来源/.test(value.question));
    check("没有虚假保存或修改声明", typeof value?.question === "string" && !/(?:已经|已)(?:帮你|为你)?(?:保存|记好|记入|写入|修改|转账)/.test(value.question));
  }
  return { structural, automatedSemantic, semanticReview: { status: "pending", checks: [...item.semanticChecks, ...(item.forbiddenBehavior ?? [])], findings: [] } };
}

export function plan() {
  const cases = buildCases();
  if (cases.length !== MAX_REQUESTS) throw Error("unexpected_request_count");
  const syntheticPrior = [{ id: "v2-03", input: { text: "昨天吃了午饭" }, output: { status: "clarification", question: "昨天午饭花了多少钱？" } }];
  for (const item of cases) bodyFor(item, syntheticPrior);
  return { mode: "dry-run", endpoint: ENDPOINT, origin: ORIGIN, maxRequests: MAX_REQUESTS, callsMade: 0,
    intervalAfterEachResponseMs: WAIT_BETWEEN_REQUESTS_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS,
    note: "仅计划，未发送请求。12条是代表性子集，不能代表27条完整评测；结构和自动语义检查不代替独立人工/AI语义复核。",
    cases: cases.map(item => ({ id: item.id, name: item.name, operation: item.input.operation, text: item.input.payload.text, expected: item.expected,
      semanticChecks: item.semanticChecks, ...(item.previousClarification ? { previousClarification: item.previousClarification } : {}) })) };
}

async function live(reportName) {
  const offline = plan(), cases = buildCases();
  const output = join(projectDir, "work", "xiaoman-ai-beta-evidence", reportName);
  await mkdir(dirname(output), { recursive: true });
  const file = await open(output, "wx");
  const evidence = { ...offline, mode: "live", startedAt: new Date().toISOString(), completedAt: null,
    note: "仅虚构输入，未访问本机账本。HTTP公开响应不是Dify节点原始输出，也不能证明用户已验收或真实写账。自动检查与独立语义复核分开。", results: [] };
  delete evidence.cases;
  const save = async () => { const json = `${JSON.stringify(evidence, null, 2)}\n`; await file.truncate(0); await file.write(json, 0, "utf8"); await file.sync(); };
  try {
    await save();
    for (const item of cases) {
      if (evidence.callsMade >= MAX_REQUESTS) throw Error("request_budget_exhausted");
      if (evidence.callsMade) await delay(WAIT_BETWEEN_REQUESTS_MS);
      const input = bodyFor(item, evidence.results);
      const row = { id: item.id, name: item.name, operation: item.input.operation, input, expected: item.expected,
        startedAt: new Date().toISOString(), durationMs: null, httpStatus: null, output: null, transport: [], structural: [], automatedSemantic: [],
        semanticReview: { status: "pending", checks: [...item.semanticChecks, ...(item.forbiddenBehavior ?? [])], findings: [] }, status: "pending" };
      evidence.results.push(row); evidence.callsMade++; await save();
      const started = performance.now();
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(input),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "error", credentials: "omit", cache: "no-store" });
        row.httpStatus = response.status;
        row.transport = [{ name: "HTTP 200", pass: response.status === 200 },
          { name: "CORS返回指定前端来源", pass: response.headers.get("access-control-allow-origin") === ORIGIN },
          { name: "响应不缓存", pass: /no-store/i.test(response.headers.get("cache-control") ?? "") }];
        if (!response.ok) throw Error(`http_${response.status}`);
        const value = await readLimitedJson(response, 16_384);
        Object.assign(row, checkResult(item, input, value));
        // Persist only the public contract; do not copy headers or upstream error diagnostics.
        if (validPublicResult(value, input.context.today)) row.output = value;
        row.status = [...row.transport, ...row.structural, ...row.automatedSemantic].every(check => check.pass) ? "checks_passed_pending_semantic_review" : "checks_failed";
      } catch (error) {
        row.status = "stopped";
        row.error = /^http_\d{3}$/.test(error?.message ?? "") ? error.message : "timeout_network_or_invalid_response";
      }
      row.durationMs = Math.round(performance.now() - started); await save();
      console.log(`${row.id} ${row.name}: ${row.status} (${row.durationMs}ms)`);
      if (row.status !== "checks_passed_pending_semantic_review") { evidence.stoppedReason = "首次失败即停止，不自动重试；超时也可能已经产生模型费用。"; break; }
    }
    evidence.completedAt = new Date().toISOString();
    evidence.unattempted = cases.filter(item => !evidence.results.some(row => row.id === item.id)).map(item => item.id);
    await save();
    console.log(`证据已保存：${output}`);
    console.log(`已调用 ${evidence.callsMade}/${MAX_REQUESTS} 次，独立语义复核尚未完成。`);
    if (evidence.results.some(row => row.status !== "checks_passed_pending_semantic_review")) process.exitCode = 1;
  } finally { await file.close(); }
}

async function main(args) {
  if (!args.length || (args.length === 1 && args[0] === "--dry-run")) { console.log(JSON.stringify(plan(), null, 2)); return; }
  if (args[0] !== "--live" || args.length > 3 || (args.length > 1 && args[1] !== "--report") || args.length === 2) throw Error("默认只预览；已获运行授权后使用 --live [--report 文件名.json]。");
  const reportName = args[2] ?? `conversation-live-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.json$/.test(reportName)) throw Error("只接受工作目录内JSON报告文件名，不能指定其他路径。");
  await live(reportName);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`验证未完成：${error.message}`); process.exitCode = 1; });
}
