import { calendarMonthRange, createDateRange, summarizeDateRange, type DateRange, type DateRangeSummary } from "./date-range.ts";
import { cents, parseDate, transactionDay } from "./finance.ts";
import type { LedgerKind, LedgerState, Transaction } from "./types.ts";

export const QUERY_CATEGORIES = ["餐饮", "购物", "交通", "居住", "健康", "医疗", "学习", "娱乐", "收入", "其他"] as const;
export const QUERY_NATURES = ["消费", "浪费", "投资", "未分类"] as const;
export type QueryCategory = typeof QUERY_CATEGORIES[number];
export type QueryNature = typeof QUERY_NATURES[number];
export type QueryPlan = {
  range: DateRange;
  ledgerKind?: LedgerKind;
  type: "income" | "expense" | "all";
  categories?: QueryCategory[];
  natures?: QueryNature[];
  comparison?: "previous_month" | "previous_period";
  metric: "total" | "count" | "breakdown";
  breakdownBy?: "category" | "nature";
};
export type QueryContext = { today: string; defaultRange: DateRange; ledgerKind: LedgerKind; previousQuery?: QueryPlan };
export type QueryResolution = { kind: "query"; plan: QueryPlan } | { kind: "clarification"; question: string } | { kind: "none" };
export type QueryBreakdown = { label: string; summary: DateRangeSummary };
export type QueryResult = {
  plan: QueryPlan; ledgerKind: LedgerKind; summary: DateRangeSummary;
  breakdown?: QueryBreakdown[];
  comparison?: { range: DateRange; summary: DateRangeSummary; breakdown?: QueryBreakdown[];
    delta: { income: number; expense: number; balance: number; transactionCount: number } };
  facts: string[]; answer: string;
};

const DAY = 86_400_000;
export const MAX_QUERY_DAYS = 3660;
const kinds: readonly LedgerKind[] = ["personal", "family", "travel"];
const kindNames: Record<LedgerKind, string> = { personal: "个人账本", family: "家庭账本", travel: "旅行账本" };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (day: string, days: number) => iso(new Date(+parseDate(day) + days * DAY));
const daysIn = (range: DateRange) => (+parseDate(range.endDate) - +parseDate(range.startDate)) / DAY + 1;
function validRange(value: unknown): value is DateRange {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.startDate !== "string" || typeof value.endDate !== "string") return false;
  try { createDateRange(value.startDate, value.endDate); return daysIn(value as DateRange) <= MAX_QUERY_DAYS; } catch { return false; }
}
function comparisonRange(plan: QueryPlan): DateRange {
  if (plan.comparison === "previous_month") {
    const month = calendarMonthRange(plan.range.startDate.slice(0, 7));
    if (month.startDate !== plan.range.startDate || month.endDate !== plan.range.endDate) throw Error("按前一个月比较时，请先选择一个完整的自然月");
    return calendarMonthRange(shift(plan.range.startDate, -1).slice(0, 7));
  }
  return createDateRange(shift(plan.range.startDate, -daysIn(plan.range)), shift(plan.range.startDate, -1));
}
function choiceArray(value: unknown, choices: readonly string[]): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= choices.length && new Set(value).size === value.length && value.every(item => typeof item === "string" && choices.includes(item));
}
/** Shared by local grammar and future structured model queries; never executes code or SQL. */
export function validateQueryPlan(value: unknown): value is QueryPlan {
  const keys = ["range", "ledgerKind", "type", "categories", "natures", "comparison", "metric", "breakdownBy"];
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)) || !validRange(value.range)
    || typeof value.type !== "string" || !["income", "expense", "all"].includes(value.type) || typeof value.metric !== "string" || !["total", "count", "breakdown"].includes(value.metric)
    || (value.ledgerKind !== undefined && !kinds.includes(value.ledgerKind as LedgerKind))
    || (value.categories !== undefined && !choiceArray(value.categories, QUERY_CATEGORIES))
    || (Array.isArray(value.categories) && value.type === "income" && value.categories.some(category => category !== "收入"))
    || (Array.isArray(value.categories) && value.type === "expense" && value.categories.includes("收入"))
    || (value.natures !== undefined && (!choiceArray(value.natures, QUERY_NATURES) || value.type !== "expense"))
    || (value.breakdownBy !== undefined && (value.metric !== "breakdown" || typeof value.breakdownBy !== "string" || !["category", "nature"].includes(value.breakdownBy)))
    || (value.breakdownBy === "nature" && value.type !== "expense")
    || (value.comparison !== undefined && (typeof value.comparison !== "string" || !["previous_month", "previous_period"].includes(value.comparison)))) return false;
  try { if (value.comparison !== undefined && !validRange(comparisonRange(value as QueryPlan))) return false; } catch { return false; }
  return true;
}

type RangeParse = { range?: DateRange; rest: string; error?: string };
/** Small ordered date grammar. Unconsumed temporal tokens are rejected instead of guessed. */
function parseRange(text: string, today: string): RangeParse {
  const year = parseDate(today).getUTCFullYear();
  let rest = text, range: DateRange | undefined;
  const date = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const month = (y: number, m: number) => calendarMonthRange(`${y}-${String(m).padStart(2, "0")}`);
  const take = (pattern: RegExp, resolve: (match: RegExpMatchArray) => DateRange) => {
    const match = rest.match(pattern);
    if (!match) return;
    if (range) throw Error("出现了多个日期条件，请说明要查询的起止日期");
    range = resolve(match); rest = rest.replace(match[0], "");
  };
  try {
    // Consume the complete phrase before the separate month/today tokens.
    take(/(?:本月|这个月|这月)(?:截至|截止|到|至)今天/, () => createDateRange(`${today.slice(0, 7)}-01`, today));
    take(/(\d{4}-\d{2}-\d{2})(?:到|至|~|—)(\d{4}-\d{2}-\d{2})/, m => createDateRange(m[1], m[2]));
    take(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?(?:到|至|~|—)(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})(?:日|号)/,
      m => createDateRange(date(Number(m[1] ?? year), Number(m[2]), Number(m[3])), date(Number(m[4] ?? m[1] ?? year), Number(m[5] ?? m[2]), Number(m[6]))));
    take(/(?:(\d{4})年)?(\d{1,2})月(?:到|至|~|—)(?:(\d{4})年)?(\d{1,2})月/,
      m => createDateRange(month(Number(m[1] ?? year), Number(m[2])).startDate, month(Number(m[3] ?? m[1] ?? year), Number(m[4])).endDate));
    take(/(\d{4})年(?:到|至|~|—)(\d{4})年/, m => createDateRange(`${m[1]}-01-01`, `${m[2]}-12-31`));
    take(/\d{4}-\d{2}-\d{2}/, m => createDateRange(m[0], m[0]));
    take(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)/, m => { const day = date(Number(m[1] ?? year), Number(m[2]), Number(m[3])); return createDateRange(day, day); });
    take(/(?:(\d{4})年)?(\d{1,2})月/, m => month(Number(m[1] ?? year), Number(m[2])));
    take(/\d{4}-\d{2}/, m => calendarMonthRange(m[0]));
    take(/(\d{4})年/, m => createDateRange(`${m[1]}-01-01`, `${m[1]}-12-31`));
    take(/最近(\d{1,4})天/, m => {
      const count = Number(m[1]); if (count < 1 || count > MAX_QUERY_DAYS) throw Error("最近天数需为正数，且不能超过查询范围上限");
      return createDateRange(shift(today, 1 - count), today);
    });
    take(/上个月|这个月|上月|本月|这月|今年|去年|上周|本周|这周|今天|昨天|前天/, m => {
      if (["上个月", "上月"].includes(m[0])) return calendarMonthRange(shift(`${today.slice(0, 7)}-01`, -1).slice(0, 7));
      if (["这个月", "本月", "这月"].includes(m[0])) return calendarMonthRange(today.slice(0, 7));
      if (["今年", "去年"].includes(m[0])) { const y = year - (m[0] === "去年" ? 1 : 0); return createDateRange(`${y}-01-01`, `${y}-12-31`); }
      if (["上周", "本周", "这周"].includes(m[0])) {
        const monday = shift(today, -((parseDate(today).getUTCDay() + 6) % 7));
        return m[0] === "上周" ? createDateRange(shift(monday, -7), shift(monday, -1)) : createDateRange(monday, shift(monday, 6));
      }
      const day = shift(today, m[0] === "昨天" ? -1 : m[0] === "前天" ? -2 : 0); return createDateRange(day, day);
    });
    if (/\d{1,4}(?:年|月|日|号|天)|\d{4}-|上个月|上月|今年|去年|上周|今天|昨天|前天|下月|下个月|明年|明天|最近|前几天|季度|半年|春节|双十一/.test(rest)) throw Error("日期范围还不明确，请给出起止日期；跨年时请写明两个年份");
    if (range && !validRange(range)) throw Error(`一次查询最多支持${MAX_QUERY_DAYS}天，请缩小日期范围`);
    return { range, rest };
  } catch (error) { return { rest: text, error: error instanceof Error ? error.message : "请给出有效的起止日期" }; }
}

const categoryAliases: Record<QueryCategory, readonly string[]> = {
  餐饮: ["餐饮", "吃饭", "饭钱", "伙食"], 购物: ["购物"], 交通: ["交通", "出行"], 居住: ["居住", "住房"],
  健康: ["健康"], 医疗: ["医疗", "看病"], 学习: ["学习", "教育"], 娱乐: ["娱乐"], 收入: [], 其他: ["其他分类"],
};
const clarify = (question: string): QueryResolution => ({ kind: "clarification", question });

export function resolveLedgerQuery(text: string, context: QueryContext): QueryResolution {
  if (typeof text !== "string" || !text.trim()) return { kind: "none" };
  const original = text.normalize("NFKC").replace(/\s+/g, "");
  const followCue = /^(?:那|那么|再|只看|改看|改成|换成|换到|跟|和|与)|呢[?？]?$/.test(original);
  const queryCue = /多少|几笔|笔数|查账|查询|查看|查一下|看看|统计|汇总|复盘|收支情况|支出情况|分类明细|比呢|相比|比较|只看|改看/.test(original);
  if (!queryCue && !followCue) return { kind: "none" };
  if (/帮我记|记一笔|记下|新增|保存|删除|撤销|修改(?:这|那|一)?笔/.test(original)) return { kind: "none" };
  if (original.length > 500) return clarify("查询条件较长，请分别说明日期、账本和要统计的分类。");
  try { parseDate(context.today); } catch { return clarify("本机日期无效，请先核对日期。"); }
  if (!validRange(context.defaultRange) || !kinds.includes(context.ledgerKind)) return clarify("当前日期范围或账本无效，请重新选择。");
  if (context.previousQuery && !validateQueryPlan(context.previousQuery)) return clarify("上次查询条件已失效，请重新说明日期和统计内容。");
  if (followCue && !context.previousQuery && !queryCue) return clarify("还没有可沿用的查询，请先说明日期和想查的内容。");
  if (/所有账本|全部账本|各个账本|三[个本]账本|合并账本/.test(original)) return clarify("目前一次查询一个账本，请选择个人、家庭或旅行账本。");
  if (/收益|利润|回报|市值|净值|超支|预算|还能花|余额|资产/.test(original)) return clarify("这里能查询已记录的收入和支出，不能用它判断预算、账户余额或投资收益。你想查哪一项收支？");
  let rest = original;
  const ledgerMatches = kinds.filter(kind => rest.includes(kindNames[kind]));
  if (ledgerMatches.length > 1) return clarify("请一次选择一个账本，不能把多个账本合并后当作同一本统计。");
  for (const kind of ledgerMatches) rest = rest.replaceAll(kindNames[kind], "");
  let comparison: QueryPlan["comparison"];
  const monthCompare = /(?:跟|和|与)?(?:前一个月|上一个月|上个月|上月)(?:相比|比较|比(?:一下|一比)?)|比(?:前一个月|上个月|上月)/;
  const periodCompare = /(?:跟|和|与)?(?:上一周期|上个周期|上一时段|前一时段|上一期)(?:相比|比较|比(?:一下|一比)?)/;
  if (monthCompare.test(rest)) { comparison = "previous_month"; rest = rest.replace(monthCompare, ""); }
  if (periodCompare.test(rest)) { if (comparison) return clarify("请只选择一种对比方式：前一个完整月，或上一段等长日期。"); comparison = "previous_period"; rest = rest.replace(periodCompare, ""); }
  const parsed = parseRange(rest, context.today); if (parsed.error) return clarify(parsed.error); rest = parsed.rest;
  const categories: QueryCategory[] = [];
  for (const category of QUERY_CATEGORIES) for (const alias of categoryAliases[category]) {
    if (rest.includes(alias)) { if (!categories.includes(category)) categories.push(category); rest = rest.replaceAll(alias, ""); }
  }
  const natures = QUERY_NATURES.filter(nature => rest.includes(nature));
  for (const nature of natures) rest = rest.replaceAll(nature, "");
  const income = /收入|进账/.test(rest), expense = /支出|花|开销|花费/.test(rest) || categories.length > 0 || natures.length > 0;
  const all = /收支|全部记录|所有记录/.test(rest) || (income && expense);
  if (income && natures.length) return clarify("消费、浪费、投资是支出性质。你想查收入，还是按性质查支出？");
  const metric: QueryPlan["metric"] | undefined = /几笔|多少笔|笔数/.test(rest) ? "count"
    : /明细|各类|分类|分别|按性质/.test(rest) ? "breakdown" : /多少|总额|金额|合计|总共/.test(rest) ? "total" : undefined;
  const follow = !!context.previousQuery && (followCue || !!comparison);
  if (comparison && !context.previousQuery && !parsed.range) return clarify("请先说明当前要比较的日期范围，再与前一个月或上一等长时段比较。");
  const plan: QueryPlan = follow ? structuredClone(context.previousQuery!) : { range: { ...context.defaultRange }, ledgerKind: context.ledgerKind, type: "all", metric: "total" };
  if (parsed.range) plan.range = parsed.range;
  if (ledgerMatches.length) plan.ledgerKind = ledgerMatches[0];
  if (categories.length) plan.categories = categories;
  if (natures.length) { plan.natures = [...natures]; plan.type = "expense"; }
  if (all) { plan.type = "all"; delete plan.natures; }
  else if (income) { plan.type = "income"; delete plan.natures; if (!categories.length) delete plan.categories; }
  else if (expense) plan.type = "expense";
  if (metric) { plan.metric = metric; if (metric !== "breakdown") delete plan.breakdownBy; }
  if (plan.metric === "breakdown") {
    plan.breakdownBy = /性质/.test(original) || (natures.length > 1 && /分别/.test(original)) ? "nature" : "category";
    if (plan.breakdownBy === "nature") plan.type = "expense";
  }
  if (comparison) plan.comparison = comparison;
  const filler = /请帮我|帮我|请|我们|我的|我|一下|看看|查一下|查询|查看|查账|统计|汇总|复盘|分析|收入|进账|支出|收支|开销|花费|花了|花|总共|一共|合计|总额|金额|多少笔|多少|几笔|笔数|全部记录|所有记录|当前日期范围|所选日期范围|日期范围|当前|所选|这期|本期|这一期|分类明细|分类|性质|明细|各类|各|分别|记录|账目|情况|只看|改看|改成|换成|换到|那么|那|再|跟|和|与|比较|对比|比|呢|吗|是|有|在|按|的|了|及|以及|元|钱|笔|[?？,，。！!、:：]/g;
  const unknown = rest.replace(filler, "");
  if (unknown) return clarify("这项查询还不能准确识别。请用明确日期、一个账本，以及餐饮等分类或消费/浪费/投资性质来查询；暂不按备注、商家或更细的用途猜测。");
  const comparingMonths = plan.comparison === "previous_month";
  if (!validateQueryPlan(plan)) return clarify(comparingMonths ? "按前一个月比较需要一个完整自然月；请说明月份，或改为上一段等长日期。" : "查询条件有冲突或日期超出支持范围，请核对后重试。");
  return { kind: "query", plan };
}

function selectedTransactions(transactions: readonly Transaction[], plan: QueryPlan): Transaction[] {
  return transactions.filter(tx => {
    const date = transactionDay(tx); parseDate(date);
    return date >= plan.range.startDate && date <= plan.range.endDate
      && (plan.type === "all" || tx.type === plan.type)
      && (!plan.categories || plan.categories.includes(tx.category as QueryCategory))
      && (!plan.natures || (tx.type === "expense" && plan.natures.includes(tx.nature ?? "未分类")));
  });
}
function summarize(transactions: readonly Transaction[], plan: QueryPlan) {
  const selected = selectedTransactions(transactions, plan), summary = summarizeDateRange(selected, plan.range);
  // Keep the original integer fen for comparisons; do not multiply an aggregate
  // yuan float back by 100, which may lose a cent near the safe-integer boundary.
  const incomeFen = selected.filter(tx => tx.type === "income").reduce((sum, tx) => sum + cents(tx.amount), 0);
  const expenseFen = selected.filter(tx => tx.type === "expense").reduce((sum, tx) => sum + cents(tx.amount), 0);
  let breakdown: QueryBreakdown[] | undefined;
  if (plan.metric === "breakdown") {
    const groups = new Map<string, Transaction[]>();
    for (const tx of selected) {
      const label = plan.breakdownBy === "nature" ? tx.nature ?? "未分类" : tx.category;
      const group = groups.get(label);
      if (group) group.push(tx); else groups.set(label, [tx]);
    }
    breakdown = [...groups].sort(([a], [b]) => a.localeCompare(b, "zh-Hans")).map(([label, records]) => ({ label, summary: summarizeDateRange(records, plan.range) }));
  }
  return { summary, ...(breakdown ? { breakdown } : {}), moneyFen: { income: incomeFen, expense: expenseFen, balance: incomeFen - expenseFen } };
}
const difference = (current: number, previous: number) => {
  const fen = current - previous;
  if (!Number.isSafeInteger(fen)) throw Error("对比金额超出支持范围");
  return fen / 100;
};
function summaryText(summary: DateRangeSummary, plan: QueryPlan): string {
  if (plan.metric === "count") return plan.type === "all" ? `共${summary.transactionCount}笔，收入${summary.incomeCount}笔、支出${summary.expenseCount}笔` : `${plan.type === "income" ? "收入" : "支出"}${summary.transactionCount}笔`;
  return plan.type === "all" ? `收入${summary.income}元、支出${summary.expense}元，账面收支结余${summary.balance}元` : `${plan.type === "income" ? "收入" : "支出"}${plan.type === "income" ? summary.income : summary.expense}元（${summary.transactionCount}笔）`;
}
function summaryFacts(prefix: string, summary: DateRangeSummary): string[] {
  return [`${prefix}.range_start:${summary.range.startDate}`, `${prefix}.range_end:${summary.range.endDate}`,
    ...(["transactionCount", "incomeCount", "expenseCount", "income", "expense", "balance", "pendingDateCount"] as const).map(key => `${prefix}.${key}:${summary[key]}`)];
}

/** Reads only the supplied owner's local state. It never switches, saves or merges ledgers. */
export function executeLedgerQuery(plan: QueryPlan, state: LedgerState): QueryResult {
  if (!validateQueryPlan(plan)) throw Error("查询计划无效，未执行查询");
  const ledgerKind = plan.ledgerKind ?? state.ledgerKind;
  if (!kinds.includes(ledgerKind)) throw Error("当前账本无效");
  const ledger = ledgerKind === state.ledgerKind ? state : state.otherLedgers[ledgerKind];
  if (!ledger) throw Error("所选账本不存在，未使用其他账本代替");
  const resolved = { ...structuredClone(plan), ledgerKind }, { moneyFen, ...result } = summarize(ledger.transactions, resolved);
  const facts = [`ledger:${ledgerKind}`, `type:${plan.type}`, `metric:${plan.metric}`,
    ...(plan.categories ? [`categories:${plan.categories.join(",")}`] : []), ...(plan.natures ? [`natures:${plan.natures.join(",")}`] : []), ...summaryFacts("current", result.summary)];
  const filters = [plan.categories ? `分类：${plan.categories.join("、")}` : "", plan.natures ? `支出性质：${plan.natures.join("、")}` : ""].filter(Boolean).join("；");
  let answer = `${kindNames[ledgerKind]}，${plan.range.startDate} 至 ${plan.range.endDate}${filters ? `（${filters}）` : ""}：${summaryText(result.summary, plan)}。`;
  if (result.summary.transactionCount === 0) answer += "这个范围内没有匹配的现有记录。";
  if (result.breakdown?.length) {
    answer += `按${plan.breakdownBy === "nature" ? "支出性质" : "分类"}：${result.breakdown.map(row => `${row.label}：${summaryText(row.summary, plan)}`).join("；")}。`;
    for (const row of result.breakdown) facts.push(...summaryFacts(`breakdown[${JSON.stringify(row.label)}]`, row.summary));
  }
  let comparison: QueryResult["comparison"];
  if (plan.comparison) {
    const range = comparisonRange(plan), { moneyFen: previousFen, ...prior } = summarize(ledger.transactions, { ...resolved, range });
    comparison = { range, ...prior, delta: { income: difference(moneyFen.income, previousFen.income), expense: difference(moneyFen.expense, previousFen.expense),
      balance: difference(moneyFen.balance, previousFen.balance), transactionCount: result.summary.transactionCount - prior.summary.transactionCount } };
    const label = plan.comparison === "previous_month" ? "前一个完整月" : "上一等长时段";
    answer += `${label}（${range.startDate} 至 ${range.endDate}）${summaryText(prior.summary, plan)}。`;
    const changes = plan.metric === "count" ? [`记录数${comparison.delta.transactionCount}笔`]
      : plan.type === "income" ? [`收入${comparison.delta.income}元`] : plan.type === "expense" ? [`支出${comparison.delta.expense}元`]
        : [`收入${comparison.delta.income}元`, `支出${comparison.delta.expense}元`, `收支结余${comparison.delta.balance}元`];
    answer += `本次减对照时段的差额：${changes.join("、")}。`;
    if (prior.summary.transactionCount === 0) answer += "对照时段没有匹配的现有记录，不能据此断言当时没有实际收支。";
    facts.push(`comparison:${plan.comparison}`, ...summaryFacts("previous", prior.summary), ...Object.entries(comparison.delta).map(([key, amount]) => `delta.${key}:${amount}`));
  }
  if (plan.type === "all") answer += "账面收支结余不代表账户余额或可用预算。";
  if (plan.natures?.includes("投资") || (plan.breakdownBy === "nature" && result.summary.natureTotals.投资 > 0)) answer += "投资性质只表示已记录的投资支出，不表示投资收益或账户市值。";
  if (result.summary.pendingDateCount > 0 || (comparison?.summary.pendingDateCount ?? 0) > 0) answer += "其中有旧时间记录待核对日期；当前按本机日期统计，核对后结果可能变化。";
  return { plan: resolved, ledgerKind, ...result, ...(comparison ? { comparison } : {}), facts, answer };
}
