import type { CompanionPreferences } from "../data/assistant-memory.ts";
import { calendarMonthRange, createDateRange, type DateRange } from "./date-range.ts";
import { cents, parseDate } from "./finance.ts";
import { calculateSalaryBudget } from "./salary-budget.ts";
import type { LedgerState, Transaction } from "./types.ts";

export const COMPANION_FACT_IDS = [
  "period_record_count", "period_income_fen", "period_expense_fen", "period_consume_fen", "period_waste_fen", "period_invest_fen", "period_unclassified_fen", "period_pending_count",
  "day_expense_fen", "day_expense_count", "day_pending_count",
  "consume_budget_fen", "consume_spent_fen", "waste_budget_fen", "waste_spent_fen", "budget_pending_count", "budget_unclassified_count",
  "day_target_fen", "lunch_reference_fen", "day_lunch_equivalent_hundredths",
] as const;
export type CompanionFactId = typeof COMPANION_FACT_IDS[number];
export type CompanionFact = { id: CompanionFactId; value: number };
/** Only confirmed, currently selected ledger aggregates leave the device. No notes,
 * transaction identifiers, inactive ledgers, account balances or financial predictions. */
export type CompanionContext = {
  version: 1; ledgerKind: LedgerState["ledgerKind"]; today: string; range: DateRange;
  budgetRange: DateRange | null; tone: CompanionPreferences["tone"]; remindersEnabled: boolean;
  facts: CompanionFact[];
};
export type CompanionReminder = { id: string; text: string; referencedFacts: CompanionFactId[] };
const BASE = COMPANION_FACT_IDS.slice(0, 11);
const BUDGET = COMPANION_FACT_IDS.slice(11, 17);
const DAY = 86400000;
const safe = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw Error("陪伴摘要金额超出可精确计算范围"); return value; };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).length === fields.length && fields.every(k => k in v);
const validRange = (value: unknown): value is DateRange => {
  if (!record(value) || !exact(value, ["startDate", "endDate"]) || typeof value.startDate !== "string" || typeof value.endDate !== "string") return false;
  try { createDateRange(value.startDate, value.endDate); return true; } catch { return false; }
};
export function companionFactValue(context: CompanionContext, id: CompanionFactId): number | undefined { return context.facts.find(f => f.id === id)?.value; }

export function validateCompanionContext(value: unknown): value is CompanionContext {
  if (!record(value) || !exact(value, ["version", "ledgerKind", "today", "range", "budgetRange", "tone", "remindersEnabled", "facts"])
    || value.version !== 1 || !["personal", "family", "travel"].includes(value.ledgerKind as string)
    || !["gentle", "playful", "plain"].includes(value.tone as string) || typeof value.remindersEnabled !== "boolean"
    || typeof value.today !== "string" || !validRange(value.range) || (value.budgetRange !== null && !validRange(value.budgetRange))
    || !Array.isArray(value.facts) || value.facts.length > COMPANION_FACT_IDS.length) return false;
  try { parseDate(value.today); } catch { return false; }
  const map = new Map<CompanionFactId, number>();
  for (const f of value.facts) {
    if (!record(f) || !exact(f, ["id", "value"]) || !COMPANION_FACT_IDS.includes(f.id as CompanionFactId) || map.has(f.id as CompanionFactId)
      || typeof f.value !== "number" || !Number.isSafeInteger(f.value) || f.value < 0 || (String(f.id).endsWith("_count") && f.value > 5000)) return false;
    map.set(f.id as CompanionFactId, f.value);
  }
  if (!BASE.every(id => map.has(id)) || BUDGET.some(id => map.has(id) !== (value.budgetRange !== null))) return false;
  if (value.budgetRange && !(value.budgetRange.startDate <= value.today && value.today <= value.budgetRange.endDate)) return false;
  const total = ["period_consume_fen", "period_waste_fen", "period_invest_fen", "period_unclassified_fen"].reduce((sum, id) => sum + BigInt(map.get(id as CompanionFactId)!), BigInt(0));
  if (total !== BigInt(map.get("period_expense_fen")!)) return false;
  if (map.get("period_record_count") === 0 && (map.get("period_income_fen") !== 0 || total !== BigInt(0))) return false;
  if (map.get("day_expense_count") === 0 && map.get("day_expense_fen") !== 0) return false;
  if ((map.get("lunch_reference_fen") ?? 1) <= 0) return false;
  const ratio = map.get("day_lunch_equivalent_hundredths");
  if (ratio !== undefined) {
    const lunch = map.get("lunch_reference_fen");
    if (!lunch || map.get("day_pending_count") !== 0 || !map.get("day_expense_count")) return false;
    const expected = (BigInt(map.get("day_expense_fen")!) * BigInt(200) + BigInt(lunch)) / (BigInt(lunch) * BigInt(2));
    if (BigInt(ratio) !== expected) return false;
  }
  return true;
}

function possibleDate(tx: Transaction, range: DateRange): boolean {
  if (tx.date.length === 10) { parseDate(tx.date); return tx.date >= range.startDate && tx.date <= range.endDate; }
  const time = Date.parse(tx.date);
  if (!Number.isFinite(time)) throw Error("请先核对账目日期");
  return time >= +parseDate(range.startDate) - 14 * 3600000 && time < +parseDate(range.endDate) + DAY + 12 * 3600000;
}
export function buildCompanionContext(state: Pick<LedgerState, "ledgerKind" | "transactions" | "salaryBudget">, today: string,
  prefs?: CompanionPreferences, range: DateRange = calendarMonthRange(today.slice(0, 7))): CompanionContext {
  parseDate(today); const selected = createDateRange(range.startDate, range.endDate);
  const values = new Map<CompanionFactId, number>(BASE.map(id => [id, 0]));
  const add = (id: CompanionFactId, amount: number) => values.set(id, safe((values.get(id) ?? 0) + amount));
  const ids = new Set<string>();
  for (const tx of state.transactions) {
    if (ids.has(tx.id)) throw Error("账目编号重复，无法整理陪伴摘要"); ids.add(tx.id);
    const pending = tx.dateNeedsConfirmation || tx.date.length !== 10;
    if (pending) {
      if (possibleDate(tx, selected)) add("period_pending_count", 1);
      if (tx.type === "expense" && possibleDate(tx, { startDate: today, endDate: today })) add("day_pending_count", 1);
      continue;
    }
    parseDate(tx.date); const amount = cents(tx.amount);
    if (tx.date >= selected.startDate && tx.date <= selected.endDate) {
      add("period_record_count", 1);
      if (tx.type === "income") add("period_income_fen", amount);
      else {
        add("period_expense_fen", amount);
        const key = tx.nature === "消费" ? "period_consume_fen" : tx.nature === "浪费" ? "period_waste_fen" : tx.nature === "投资" ? "period_invest_fen" : "period_unclassified_fen";
        add(key, amount);
      }
    }
    if (tx.type === "expense" && tx.date === today) { add("day_expense_fen", amount); add("day_expense_count", 1); }
  }
  const budget = calculateSalaryBudget(state.salaryBudget, state.transactions, today);
  if (budget) {
    for (const [nature, prefix] of [["消费", "consume"], ["浪费", "waste"]] as const) {
      const row = budget.rows.find(r => r.nature === nature)!;
      values.set(`${prefix}_budget_fen`, row.budgetFen); values.set(`${prefix}_spent_fen`, row.spentFen);
    }
    values.set("budget_pending_count", budget.pendingDateCount);
    values.set("budget_unclassified_count", budget.unclassifiedCount);
  }
  if (prefs?.dailyExpenseTarget != null && prefs.dailyExpenseTarget >= 0) values.set("day_target_fen", cents(prefs.dailyExpenseTarget));
  if (prefs?.lunchReference != null && prefs.lunchReference > 0) values.set("lunch_reference_fen", cents(prefs.lunchReference));
  if (values.has("lunch_reference_fen") && values.get("day_pending_count") === 0 && values.get("day_expense_count")! > 0) {
    const lunch = BigInt(values.get("lunch_reference_fen")!);
    const ratio = (BigInt(values.get("day_expense_fen")!) * BigInt(200) + lunch) / (lunch * BigInt(2));
    if (ratio <= BigInt(Number.MAX_SAFE_INTEGER)) values.set("day_lunch_equivalent_hundredths", Number(ratio));
  }
  const result: CompanionContext = { version: 1, ledgerKind: state.ledgerKind, today, range: selected, budgetRange: budget?.range ?? null,
    tone: prefs?.tone ?? "playful", remindersEnabled: (prefs?.remindersEnabled ?? true) && !(prefs?.mutedUntil && prefs.mutedUntil >= today),
    facts: COMPANION_FACT_IDS.filter(id => values.has(id)).map(id => ({ id, value: values.get(id)! })) };
  if (!validateCompanionContext(result)) throw Error("陪伴摘要数据无效，请核对账本设置");
  return result;
}

export function formatCompanionMoney(fen: number): string {
  const value = BigInt(safe(fen));
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}元`;
}
const names = { personal: "个人账本", family: "家庭账本", travel: "旅行账本" };
export function describeCompanionFact(context: CompanionContext, id: CompanionFactId): string | null {
  const value = companionFactValue(context, id); if (value === undefined) return null;
  const name = names[context.ledgerKind], period = `${context.range.startDate}至${context.range.endDate}`;
  const money = () => formatCompanionMoney(value);
  const pending = companionFactValue(context, "period_pending_count")!;
  const scope = `${name}，${period}，${pending ? "日期已核对的" : ""}已记录`;
  if (id === "period_record_count") return value ? `${scope}收支${value}笔` : `${name}在${period}没有日期已核对的收支记录，不能据此认为实际收支为零`;
  if (id === "period_pending_count") return `${name}所选时段有${value}笔日期待核对的记录，未计入本次已核对日期的金额`;
  const labels: Partial<Record<CompanionFactId, string>> = { period_income_fen: "收入", period_expense_fen: "支出", period_consume_fen: "消费性质支出",
    period_waste_fen: "用户标为浪费的支出", period_invest_fen: "投资性质支出（不是投资收益）", period_unclassified_fen: "尚未确认性质的支出" };
  if (labels[id]) return `${scope}${labels[id]}${money()}（不代表账户余额）`;
  if (id === "day_expense_fen") return `${name}在${context.today}日期已核对的已记支出${money()}，仅涵盖已经记下的账目`;
  if (id === "day_expense_count") return `${name}在${context.today}日期已核对的已记支出${value}笔`;
  if (id === "day_pending_count") return `${name}今天有${value}笔支出日期待核对，不能据此判断今天的完整支出`;
  if (id === "day_target_fen") return `你为${name}设置的日支出参考目标是${money()}`;
  if (id === "day_lunch_equivalent_hundredths") {
    const whole = BigInt(value) / BigInt(100), fraction = String(BigInt(value) % BigInt(100)).padStart(2, "0").replace(/0+$/, "");
    return `${name}今天已记支出合计${formatCompanionMoney(companionFactValue(context, "day_expense_fen")!)}，按你设定的每顿${formatCompanionMoney(companionFactValue(context, "lunch_reference_fen")!)}参考，约相当于${whole}${fraction ? "." + fraction : ""}顿午餐的金额；只是金额比较，不建议省掉正餐`;
  }
  if (id === "lunch_reference_fen") return `你设置的午餐参考金额是每顿${money()}，这不是实际午餐记录`;
  const budgetScope = `${name}，预算期${context.budgetRange?.startDate}至${context.budgetRange?.endDate}`;
  if (id === "budget_pending_count") return `${budgetScope}有${value}笔支出日期待核对，预算提醒暂不作确定判断`;
  if (id === "budget_unclassified_count") return `${budgetScope}有${value}笔支出性质待核对，预算提醒暂不作确定判断`;
  const label = id.startsWith("consume") ? "消费" : "浪费";
  return `${budgetScope}，${label}${id.includes("_budget_") ? "预算" : "日期和性质已确认的已记支出"}${money()}`;
}

export function getCompanionReminders(context: CompanionContext): CompanionReminder[] {
  if (!validateCompanionContext(context)) throw Error("陪伴摘要无效");
  if (!context.remindersEnabled) return [];
  const v = (id: CompanionFactId) => companionFactValue(context, id) ?? 0;
  const reminders: CompanionReminder[] = [];
  const put = (scope: string, kind: string, text: string, referencedFacts: CompanionFactId[]) =>
    reminders.push({ id: `${context.ledgerKind}:${scope}:${kind}`, text, referencedFacts });
  const budgetScope = context.budgetRange ? `${context.budgetRange.startDate}_${context.budgetRange.endDate}` : "";
  if (v("period_pending_count") > 0) put(`${context.range.startDate}_${context.range.endDate}`, "pending_dates",
    "有些账目日期还没核对。先把日期确认好，再判断花费是否越线。", ["period_pending_count"]);
  if (context.budgetRange && !v("budget_pending_count") && !v("budget_unclassified_count")) {
    for (const [nature, prefix] of [["消费", "consume"], ["浪费", "waste"]] as const) {
      const limitId = `${prefix}_budget_fen` as const, spentId = `${prefix}_spent_fen` as const;
      const limit = v(limitId), spent = v(spentId);
      const state = spent > limit ? "over" : limit > 0 && BigInt(spent) * BigInt(5) >= BigInt(limit) * BigInt(4) ? "near" : null;
      if (state) put(budgetScope, `${prefix}_${state}`, `${names[context.ledgerKind]}本预算期已记${nature}${formatCompanionMoney(spent)}，预算${formatCompanionMoney(limit)}，${state === "over" ? "已超过设定额度" : "已达到八成"}。${context.tone === "playful" ? "钱包先举个手，下一笔值不值，你说了算。" : context.tone === "gentle" ? "下一笔可以稍微停一停，按你的需要决定。" : "可查看本期账目或调整预算。"}`, [spentId, limitId]);
    }
  }
  if (companionFactValue(context, "day_target_fen") !== undefined && !v("day_pending_count") && v("day_expense_fen") > v("day_target_fen")) put(context.today, "day_target_over",
    `${names[context.ledgerKind]}今天已记支出${formatCompanionMoney(v("day_expense_fen"))}，超过你设置的日支出参考目标${formatCompanionMoney(v("day_target_fen"))}。这只比较已记录账目，不表示这些支出都是浪费。`, ["day_expense_fen", "day_target_fen"]);
  return reminders;
}
