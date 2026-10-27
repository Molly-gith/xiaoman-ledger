import { createDateRange, type DateRange } from "./date-range.ts";
import { cents, parseDate, transactionDay } from "./finance.ts";
import type { ExpenseNature, Transaction } from "./types.ts";

export type ReviewNature = ExpenseNature | "未分类";
export type ReviewEvidenceSelector = { range: DateRange; type: "all" | "income" | "expense"; category?: string; nature?: ReviewNature };
export type EvidenceSelector = ReviewEvidenceSelector;
export type PeriodReviewTotals = {
  transactionCount: number; incomeCount: number; expenseCount: number;
  incomeFen: number; expenseFen: number; balanceFen: number;
};
export type PeriodReviewBreakdown = { label: string; amountFen: number; count: number; evidence: ReviewEvidenceSelector };
export type PeriodReviewSummary = {
  range: DateRange; dayCount: number; status: "recorded" | "no_records"; pendingDateCount: number;
  totals: PeriodReviewTotals; expenseCategories: PeriodReviewBreakdown[]; expenseNatures: PeriodReviewBreakdown[];
  evidence: { all: ReviewEvidenceSelector; income: ReviewEvidenceSelector; expense: ReviewEvidenceSelector };
};
export type PeriodReviewBreakdownChange = {
  label: string; currentFen: number; previousFen: number; deltaFen: number;
  currentCount: number; previousCount: number; deltaCount: number;
  evidence: { current: ReviewEvidenceSelector; previous: ReviewEvidenceSelector };
};
export type PeriodReview = {
  current: PeriodReviewSummary; previous: PeriodReviewSummary | null;
  /** True when the caller supplies today and the selected range has not ended. */
  currentIncomplete: boolean;
  comparison:
    | { status: "available"; delta: PeriodReviewTotals; expenseCategories: PeriodReviewBreakdownChange[]; expenseNatures: PeriodReviewBreakdownChange[] }
    | { status: "unavailable"; reason: "out_of_range" | "no_current_records" | "no_previous_records" | "unconfirmed_dates";
        delta: null; expenseCategories: []; expenseNatures: [] };
};

const DAY = 86_400_000;
const NATURES: readonly ReviewNature[] = ["消费", "浪费", "投资", "未分类"];
const safe = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw Error("复盘金额合计或差额超过可精确计算的范围");
  return value;
};
const dayCount = (range: DateRange) => (+parseDate(range.endDate) - +parseDate(range.startDate)) / DAY + 1;
const selector = (range: DateRange, type: ReviewEvidenceSelector["type"], filter: Pick<ReviewEvidenceSelector, "category" | "nature"> = {}): ReviewEvidenceSelector =>
  ({ range: { ...range }, type, ...filter });

function validRange(range: DateRange): DateRange {
  if (!range || typeof range !== "object" || Array.isArray(range) || Object.keys(range).length !== 2
    || typeof range.startDate !== "string" || typeof range.endDate !== "string") throw Error("复盘日期范围无效");
  return createDateRange(range.startDate, range.endDate);
}
function validateSelector(value: ReviewEvidenceSelector): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["range", "type", "category", "nature"].includes(key))
    || !["all", "income", "expense"].includes(value.type)
    || (value.category !== undefined && (typeof value.category !== "string" || !value.category.trim()))
    || (value.nature !== undefined && (value.type !== "expense" || !NATURES.includes(value.nature)))) throw Error("复盘证据条件无效");
  validRange(value.range);
}

/** Reads only the supplied active ledger. A selector never selects another owner or ledger. */
export function selectPeriodReviewEvidence(transactions: readonly Transaction[], evidence: ReviewEvidenceSelector): Transaction[] {
  validateSelector(evidence);
  return transactions.filter(tx => {
    const day = transactionDay(tx); parseDate(day);
    return day >= evidence.range.startDate && day <= evidence.range.endDate
      && (evidence.type === "all" || tx.type === evidence.type)
      && (evidence.category === undefined || tx.category === evidence.category)
      && (evidence.nature === undefined || (tx.type === "expense" && (tx.nature ?? "未分类") === evidence.nature));
  });
}

function summarize(transactions: readonly Transaction[], range: DateRange): PeriodReviewSummary {
  const selected = selectPeriodReviewEvidence(transactions, selector(range, "all"));
  const totals: PeriodReviewTotals = { transactionCount: selected.length, incomeCount: 0, expenseCount: 0, incomeFen: 0, expenseFen: 0, balanceFen: 0 };
  const categories = new Map<string, { amountFen: number; count: number }>();
  const natures = new Map<ReviewNature, { amountFen: number; count: number }>(NATURES.map(nature => [nature, { amountFen: 0, count: 0 }]));
  const ids = new Set<string>();
  let pendingDateCount = 0;
  for (const tx of selected) {
    if (typeof tx.id !== "string" || !tx.id || ids.has(tx.id) || !["income", "expense"].includes(tx.type)
      || typeof tx.category !== "string" || !tx.category.trim() || typeof tx.amount !== "number" || tx.amount <= 0
      || (tx.nature !== null && !NATURES.slice(0, 3).includes(tx.nature))) throw Error("复盘账目格式无效，请先核对记录");
    ids.add(tx.id);
    const amountFen = cents(tx.amount);
    if (tx.dateNeedsConfirmation || tx.date.length > 10) pendingDateCount++;
    if (tx.type === "income") {
      totals.incomeFen = safe(totals.incomeFen + amountFen); totals.incomeCount++;
    } else {
      totals.expenseFen = safe(totals.expenseFen + amountFen); totals.expenseCount++;
      const category = categories.get(tx.category) ?? { amountFen: 0, count: 0 };
      category.amountFen = safe(category.amountFen + amountFen); category.count++;
      categories.set(tx.category, category);
      const nature = natures.get(tx.nature ?? "未分类")!;
      nature.amountFen = safe(nature.amountFen + amountFen); nature.count++;
    }
  }
  totals.balanceFen = safe(totals.incomeFen - totals.expenseFen);
  return {
    range: { ...range }, dayCount: dayCount(range), status: selected.length ? "recorded" : "no_records", pendingDateCount, totals,
    expenseCategories: [...categories].sort(([a, left], [b, right]) => right.amountFen - left.amountFen || a.localeCompare(b, "zh-Hans"))
      .map(([label, amount]) => ({ label, ...amount, evidence: selector(range, "expense", { category: label }) })),
    expenseNatures: NATURES.map(label => ({ label, ...natures.get(label)!, evidence: selector(range, "expense", { nature: label }) })),
    evidence: { all: selector(range, "all"), income: selector(range, "income"), expense: selector(range, "expense") },
  };
}

function changes(current: PeriodReviewSummary, previous: PeriodReviewSummary, field: "expenseCategories" | "expenseNatures"): PeriodReviewBreakdownChange[] {
  const currentRows = new Map(current[field].map(row => [row.label, row]));
  const previousRows = new Map(previous[field].map(row => [row.label, row]));
  const labels = new Set([...currentRows.keys(), ...previousRows.keys()]);
  return [...labels].map(label => {
    const a = currentRows.get(label), b = previousRows.get(label);
    const filter = field === "expenseCategories" ? { category: label } : { nature: label as ReviewNature };
    return { label, currentFen: a?.amountFen ?? 0, previousFen: b?.amountFen ?? 0, deltaFen: safe((a?.amountFen ?? 0) - (b?.amountFen ?? 0)),
      currentCount: a?.count ?? 0, previousCount: b?.count ?? 0, deltaCount: (a?.count ?? 0) - (b?.count ?? 0),
      evidence: { current: selector(current.range, "expense", filter), previous: selector(previous.range, "expense", filter) } };
  });
}

/** All figures describe recorded transactions, never budgets, account balances or investment returns.
 * Previous means the immediately preceding interval with the same inclusive number of days.
 * An empty interval is not evidence of zero real-world activity, so its trend remains unavailable.
 */
export function buildPeriodReview(transactions: readonly Transaction[], range: DateRange, today?: string): PeriodReview {
  if (today !== undefined) parseDate(today);
  const checked = validRange(range), current = summarize(transactions, checked);
  const currentIncomplete = today !== undefined && checked.endDate > today;
  const priorStart = +parseDate(checked.startDate) - current.dayCount * DAY;
  const previous = priorStart < +parseDate("1900-01-01") ? null : summarize(transactions, createDateRange(
    new Date(priorStart).toISOString().slice(0, 10), new Date(+parseDate(checked.startDate) - DAY).toISOString().slice(0, 10)));
  const reason = !previous ? "out_of_range"
    : current.pendingDateCount || previous.pendingDateCount ? "unconfirmed_dates"
    : current.status === "no_records" ? "no_current_records"
    : previous.status === "no_records" ? "no_previous_records" : null;
  if (reason || !previous) return { current, previous, currentIncomplete, comparison: { status: "unavailable", reason: reason ?? "out_of_range", delta: null, expenseCategories: [], expenseNatures: [] } };
  const delta: PeriodReviewTotals = {
    transactionCount: current.totals.transactionCount - previous.totals.transactionCount,
    incomeCount: current.totals.incomeCount - previous.totals.incomeCount,
    expenseCount: current.totals.expenseCount - previous.totals.expenseCount,
    incomeFen: safe(current.totals.incomeFen - previous.totals.incomeFen),
    expenseFen: safe(current.totals.expenseFen - previous.totals.expenseFen),
    balanceFen: safe(current.totals.balanceFen - previous.totals.balanceFen),
  };
  return { current, previous, currentIncomplete, comparison: { status: "available", delta,
    expenseCategories: changes(current, previous, "expenseCategories"), expenseNatures: changes(current, previous, "expenseNatures") } };
}

// Format the original integer fen; converting a large aggregate back through a
// yuan float can silently lose a cent even though the integer sum itself is safe.
function money(fen: number): string {
  const value = BigInt(Math.abs(safe(fen)));
  return (fen < 0 ? "-" : "") + (value / BigInt(100)).toString() + "." + (value % BigInt(100)).toString().padStart(2, "0") + "元";
}
const periodText = (period: PeriodReviewSummary) => period.range.startDate + " 至 " + period.range.endDate + "（" + period.dayCount + "天）";
const movement = (label: string, fen: number) => label + (fen === 0 ? "不变" : (fen > 0 ? "增加" : "减少") + money(Math.abs(fen)));

/** A bounded, deterministic narrative suitable for the conversation history. */
export function describePeriodReview(review: PeriodReview, ledgerName: string): string {
  const name = typeof ledgerName === "string" ? ledgerName.trim().slice(0, 40) : "";
  const { current, previous, comparison } = review, t = current.totals;
  const lines = [(name || "当前账本") + "，复盘范围：" + periodText(current) + "。"];
  if (current.status === "no_records") lines.push("本次范围没有已记录的收支，不能据此认为实际收支为零。");
  else {
    lines.push("按已记录的" + t.transactionCount + "笔收支统计：收入" + money(t.incomeFen) + "（" + t.incomeCount + "笔），支出" + money(t.expenseFen) + "（" + t.expenseCount + "笔），账面收支结余" + money(t.balanceFen) + "。");
    lines.push(current.expenseNatures.filter(row => row.label !== "未分类" || row.count > 0).map(row => (row.label === "投资" ? "投资性质支出" : row.label + "支出") + money(row.amountFen)).join("；") + "。");
    const top = current.expenseCategories[0];
    if (top) lines.push("支出较多的分类是" + top.label.slice(0, 40) + "：" + money(top.amountFen) + "（" + top.count + "笔）。");
  }
  if (previous) lines.push("前一等长时段：" + periodText(previous) + "。");
  if (comparison.status === "available") {
    lines.push("与前一时段已记录的收支相比：" + [movement("收入", comparison.delta.incomeFen), movement("支出", comparison.delta.expenseFen), movement("账面收支结余", comparison.delta.balanceFen)].join("，") + "。");
  } else if (comparison.reason === "out_of_range") lines.push("前一等长时段超出支持的日期范围，暂不比较变化。");
  else if (comparison.reason === "unconfirmed_dates") lines.push("本次或前一时段有待核对日期的旧记录，目前按设备日期暂计，核对前不比较变化。");
  else if (comparison.reason === "no_previous_records") lines.push("前一时段没有已记录的收支，暂不比较变化，不能据此认为当时实际收支为零。");
  else lines.push("本次范围没有已记录的收支，暂不比较变化。");
  if (current.pendingDateCount > 0 && comparison.status === "unavailable" && comparison.reason !== "unconfirmed_dates") lines.push("本次有待核对日期的旧记录，目前按设备日期暂计。");
  if (review.currentIncomplete) lines.push("所选时段尚未结束，当前只包含已记录的账目，不能把差额当作完整周期的变化。");
  lines.push("账面收支结余不是账户余额或可用预算。");
  if ([current, previous].some(period => period?.expenseNatures.some(row => row.label === "投资" && row.count > 0))) lines.push("投资性质只表示已记录的投资支出，不代表投资收益或账户市值。");
  return lines.join("");
}
