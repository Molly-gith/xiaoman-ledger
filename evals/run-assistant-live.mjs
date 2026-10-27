import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { validateAssistantDraft, validateAssistantRequest } from "../lib/ai/assistant-contract.ts";
import { readLimitedJson } from "../lib/ai/question-request.ts";

// Deliberately fixed: no .env, secret files, credentials, fake IP or user ledger.
export const ENDPOINT = "https://xiaoman-ai-beta.vercel.app/api/ai/assistant";
export const ORIGIN = "https://molly-gith.github.io";
export const MAX_REQUESTS = 11;
export const WAIT_BETWEEN_REQUESTS_MS = 11_000;
export const REQUEST_TIMEOUT_MS = 30_000;
const projectDir = fileURLToPath(new URL("../", import.meta.url));
const context = { today: "2026-10-24", timezone: "Asia/Hong_Kong" };
const expectedDraft = (amount, category, date = context.today, nature = "消费", type = "expense") => ({ type, amount, category, occurred_at: date, nature_suggestion: nature });

export function buildCases() {
  const report = {
    range: { startDate: "2026-10-01", endDate: "2026-10-24" },
    transactionCount: 4, incomeCount: 1, expenseCount: 3,
    income: 8000, expense: 60, balance: 7940,
    natureTotals: { 消费: 40, 浪费: 20, 投资: 0, 未分类: 0 }, pendingDateCount: 0,
  };
  return [
    { id: "01", name: "工资收入", text: "今天工资到账8000元", expected: [expectedDraft(8000, "收入", context.today, null, "income")] },
    { id: "02", name: "普通午饭默认消费", text: "今天午饭35元", expected: [expectedDraft(35, "餐饮")] },
    { id: "03", name: "明确浪费", text: "今天买了18元奶茶，没必要买，我很后悔，这笔算浪费", expected: [expectedDraft(18, "餐饮", context.today, "浪费")] },
    { id: "04", name: "明确否定浪费", text: "今天咖啡20元，不是浪费，算正常消费", expected: [expectedDraft(20, "餐饮")] },
    { id: "05", name: "用户明确的自我投资", text: "今天买了299元的学习课程，这是我的自我投资", expected: [expectedDraft(299, "学习", context.today, "投资")] },
    { id: "06", name: "昨天按当地日期解释", text: "昨天坐地铁花了3元", expected: [expectedDraft(3, "交通", "2026-10-23")] },
    { id: "07a", scenario: "07", name: "缺金额只补问", text: "昨天午饭", expectedKind: "clarification", questionPattern: "多少|金额|价格|价钱|花了|费用" },
    { id: "07b", scenario: "07", name: "补充金额保留午饭和昨天", text: "30元", previous: "07a", expected: [expectedDraft(30, "餐饮", "2026-10-23")] },
    { id: "08", name: "收入和支出混合多笔", text: "今天工资到账8000元，午饭35元，坐地铁3元", expected: [expectedDraft(8000, "收入", context.today, null, "income"), expectedDraft(35, "餐饮"), expectedDraft(3, "交通")] },
    { id: "09", name: "选择日期范围的收支复盘", text: "在所选日期内，我的收入、支出和账面收支结余各是多少？请给我一个有用的建议。", report, expectedKind: "answer",
      expectedBehavior: "明确当前日期范围；收入8000、支出60、账面收支结余7940；不把结余当预算/资产，不编历史对比；建议只核对现有记录。" },
    { id: "10", name: "自有账户转账不误记收入", text: "今天从我自己的银行卡转了500元到我自己的微信钱包", expectedKind: "clarification",
      expectedBehavior: "询问是否需要记录以及记录口径，不生成新增收入或双重收支。" },
  ];
}

function bodyFor(item, completed) {
  const body = { text: item.text, context: { ...context }, ...(item.report ? { report: structuredClone(item.report) } : {}) };
  if (item.previous) {
    const previous = completed.find(row => row.id === item.previous);
    if (previous?.output?.status !== "clarification") throw Error("previous_clarification_unavailable");
    body.clarification = { originalText: previous.input.text, question: previous.output.question, answer: item.text };
  }
  return body;
}

const plainObject = value => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, fields) => plainObject(value) && Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));

export function checkResult(item, value) {
  const checks = [];
  const check = (name, pass) => checks.push({ name, pass: !!pass });
  check("返回对象有明确状态", plainObject(value) && typeof value.status === "string");
  if (item.expected) {
    check("仅返回待保存草稿，不能声称已经写账", exactKeys(value, ["status", "drafts", "modelVersion", "workflowVersion"]) && value.status === "transactions");
    check("草稿数量完整且没有重复新增", Array.isArray(value?.drafts) && value.drafts.length === item.expected.length);
    check("草稿金额、日期、性质及字段合法", Array.isArray(value?.drafts) && value.drafts.every(draft => validateAssistantDraft(draft, context.today) && !draft.ambiguous));
    check("模型和工作流版本标签存在", [value?.modelVersion, value?.workflowVersion].every(label => typeof label === "string" && label.length > 0 && label.length <= 200));
    const remaining = Array.isArray(value?.drafts) ? [...value.drafts] : [];
    for (const expected of item.expected) {
      const index = remaining.findIndex(draft => Object.entries(expected).every(([key, expectedValue]) => draft[key] === expectedValue));
      check(`匹配${expected.type === "income" ? "收入" : "支出"}：${expected.amount}元 / ${expected.category} / ${expected.occurred_at} / ${expected.nature_suggestion ?? "无支出性质"}`, index >= 0);
      if (index >= 0) remaining.splice(index, 1);
    }
  } else if (item.expectedKind === "clarification") {
    check("仅补问，不输出交易草稿", exactKeys(value, ["status", "question"]) && value.status === "clarification");
    check("补问简短且非空", typeof value?.question === "string" && value.question.trim().length > 0 && value.question.length <= 300);
    if (item.questionPattern) {
      check("明确询问缺失金额", typeof value?.question === "string" && new RegExp(item.questionPattern).test(value.question));
      check("未假造金额", typeof value?.question === "string" && !/[0-9０-９]|[零一二两三四五六七八九十百千万亿]+元/.test(value.question));
    }
  } else {
    check("仅返回回答及建议", exactKeys(value, ["status", "answer", "nextActions"]) && value.status === "answer");
    const answer = typeof value?.answer === "string" ? value.answer : "";
    check("回答非空且长度受限", answer.length > 0 && answer.length <= 1200);
    check("明确真实日期范围", answer.includes(item.report.range.startDate) && answer.includes(item.report.range.endDate));
    check("收入金额和口径正确", /收入\s*8000\s*元/.test(answer));
    check("支出金额和口径正确", /支出\s*60\s*元/.test(answer));
    check("收支结余金额和口径正确", /账面收支结余\s*7940\s*元/.test(answer));
    check("不把结余当账户余额或可用预算", answer.includes("收支结余不代表账户余额或可用预算"));
    check("不编造超支或历史表现", !/已超支|超支了|比上[月期]|增长了|减少了|同比|环比/.test(answer));
    const withoutDates = answer.replace(/\d{4}-\d{2}-\d{2}/g, "");
    check("答案中的数字均来自指定摘要", [...withoutDates.matchAll(/-?\d+(?:\.\d+)?/g)].every(match => [0, 1, 3, 4, 20, 40, 60, 8000, 7940].includes(Number(match[0]))));
    check("建议不携带未经核对的金额或未支持功能", Array.isArray(value?.nextActions) && value.nextActions.length <= 3 && value.nextActions.every(action => ["查看当前日期范围的账目", "核对收入和支出记录", "核对待确认日期的记录"].includes(action)));
  }
  return checks;
}

export function plan() {
  const cases = buildCases();
  if (cases.length !== MAX_REQUESTS) throw Error("unexpected_request_count");
  for (const item of cases) {
    const body = bodyFor(item, [{ id: "07a", input: { text: "昨天午饭" }, output: { status: "clarification", question: "午饭花了多少钱？" } }]);
    if (!validateAssistantRequest(body)) throw Error(`invalid_synthetic_input:${item.id}`);
  }
  return { mode: "dry-run", endpoint: ENDPOINT, origin: ORIGIN, scenarioCount: 10, maxRequests: MAX_REQUESTS,
    callsMade: 0, intervalAfterEachResponseMs: WAIT_BETWEEN_REQUESTS_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS,
    note: "只展示计划，不发送网络请求。自动检查不是语义验收；实际结果需逐条复核。",
    cases: cases.map(item => ({ id: item.id, name: item.name, text: item.text, expected: item.expected ?? item.expectedKind,
      ...(item.expectedBehavior ? { expectedBehavior: item.expectedBehavior } : {}), ...(item.previous ? { previous: item.previous } : {}) })) };
}

async function live(reportName) {
  const offline = plan();
  const output = join(projectDir, "work", "xiaoman-ai-beta-evidence", reportName);
  await mkdir(dirname(output), { recursive: true });
  // Reserve before any paid call. Never overwrite a previous run's evidence.
  const file = await open(output, "wx");
  const evidence = { ...offline, mode: "live", startedAt: new Date().toISOString(), completedAt: null,
    note: "仅虚拟输入。此报告保留自动检查和输出；金额口径、题意、能力边界仍需独立语义复核。没有访问本机账本，没有写账。", results: [] };
  delete evidence.cases;
  const save = async () => { const text = `${JSON.stringify(evidence, null, 2)}\n`; await file.truncate(0); await file.write(text, 0, "utf8"); await file.sync(); };
  try {
    await save();
    for (const item of buildCases()) {
      if (evidence.callsMade > 0) await delay(WAIT_BETWEEN_REQUESTS_MS);
      const input = bodyFor(item, evidence.results);
      if (!validateAssistantRequest(input)) throw Error("invalid_request_before_network");
      const row = { id: item.id, name: item.name, input, expected: item.expected ?? item.expectedKind,
        ...(item.expectedBehavior ? { expectedBehavior: item.expectedBehavior } : {}), startedAt: new Date().toISOString(),
        durationMs: null, httpStatus: null, output: null, checks: [], status: "pending", semanticReview: "pending" };
      evidence.results.push(row);
      evidence.callsMade++;
      await save();
      const started = performance.now();
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify(input), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "error", credentials: "omit", cache: "no-store" });
        row.httpStatus = response.status;
        if (!response.ok) throw Error(`http_${response.status}`);
        const value = await readLimitedJson(response, 16_384);
        row.checks = checkResult(item, value);
        // Save only expected response fields, never HTTP headers or upstream errors.
        if (value?.status === "transactions" && exactKeys(value, ["status", "drafts", "modelVersion", "workflowVersion"])) row.output = value;
        else if (value?.status === "answer" && exactKeys(value, ["status", "answer", "nextActions"])) row.output = value;
        else if (value?.status === "clarification" && exactKeys(value, ["status", "question"])) row.output = value;
        row.status = row.checks.every(check => check.pass) ? "checks_passed_pending_semantic_review" : "checks_failed";
      } catch (error) {
        row.status = "stopped";
        row.error = /^http_\d{3}$/.test(error?.message ?? "") ? error.message : "timeout_network_or_invalid_response";
      }
      row.durationMs = Math.round(performance.now() - started);
      await save();
      console.log(`${row.id} ${row.name}: ${row.status} (${row.durationMs}ms)`);
      if (row.status !== "checks_passed_pending_semantic_review") { evidence.stoppedReason = "首次失败即停止；不得自动重试，超时仍可能产生模型费用。"; break; }
    }
    evidence.completedAt = new Date().toISOString();
    evidence.unattempted = buildCases().filter(item => !evidence.results.some(row => row.id === item.id)).map(item => item.id);
    await save();
    console.log(`证据已保存：${output}`);
    console.log(`已调用 ${evidence.callsMade}/${MAX_REQUESTS} 次；独立语义复核尚未完成。`);
    if (evidence.results.some(row => row.status !== "checks_passed_pending_semantic_review")) process.exitCode = 1;
  } finally { await file.close(); }
}

async function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--dry-run")) { console.log(JSON.stringify(plan(), null, 2)); return; }
  if (args[0] !== "--live" || args.length > 3 || (args.length > 1 && args[1] !== "--report") || (args.length === 2)) throw Error("参数：默认离线；线上仅 --live [--report 文件名.json]，需要已获明确运行授权。");
  const reportName = args[2] ?? `assistant-live-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.json$/.test(reportName)) throw Error("报告仅接受工作目录内的 JSON 文件名，不能指定其他路径。");
  await live(reportName);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`测试未完成：${error.message}`); process.exitCode = 1; });
}
