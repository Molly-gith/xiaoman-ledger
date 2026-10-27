import { calendarMonthRange, createDateRange, type DateRange } from "./date-range.ts";
import { cents, parseDate, salaryCycle, transactionDay } from "./finance.ts";
import type { ExpenseNature, SalaryBudgetAmounts, SalaryBudgetPercentages, SalaryBudgetSettings, Transaction } from "./types.ts";

const NATURES = ["消费", "浪费", "投资"] as const;
const BPS = BigInt(10_000);
const DAY = 86_400_000;
type NatureAmounts = Record<ExpenseNature, number>;
export type SalaryBudgetStatus = "ok" | "near" | "over" | "pending" | "target";
export type SalaryBudgetRow = {
  nature: ExpenseNature; budgetFen: number; spentFen: number; remainingFen: number;
  usedPercent: number | null; status: SalaryBudgetStatus;
};
export type SalaryBudgetSummary = {
  range: DateRange; baseFen: number; overrideApplied: boolean; unallocatedFen: number;
  rows: SalaryBudgetRow[];
  pendingDateCount: number; pendingDateAmountFen: number;
  unclassifiedCount: number; unclassifiedAmountFen: number; alertsSuppressed: boolean;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exactObject(value: unknown, keys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (!object(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optionalKeys.includes(key))) {
    throw new Error("薪资预算设置格式无效");
  }
  return value;
}
function money(value: unknown): number {
  if (typeof value !== "number") throw new Error("薪资金额需为非负数，最多两位小数");
  cents(value); return value;
}
function percentages(value: unknown): SalaryBudgetPercentages {
  const raw = exactObject(value, NATURES);
  const result = {} as SalaryBudgetPercentages;
  let total = 0;
  for (const nature of NATURES) {
    if (typeof raw[nature] !== "number" || raw[nature] < 0 || raw[nature] > 100) throw new Error("预算比例需在 0%–100% 之间");
    const bps = cents(raw[nature]); total += bps; result[nature] = bps / 100;
  }
  if (total > 10_000) throw new Error("消费、浪费和投资的预算比例合计不能超过 100%");
  return result;
}

/** Uses clipped month-end paydays, independent of recorded transactions or old cycle IDs. */
export function salaryPaydayRange(date: string, salaryDay: number): DateRange {
  parseDate(date);
  const cycle = salaryCycle(date, salaryDay);
  return createDateRange(cycle.startDate, cycle.endDate);
}
function rangeFor(settings: Pick<SalaryBudgetSettings, "periodMode" | "salaryDay">, date: string): DateRange {
  parseDate(date);
  if (settings.periodMode === "calendar_month") return calendarMonthRange(date.slice(0, 7));
  if (settings.salaryDay === null) throw new Error("请先设置发薪日，再启用工资周期");
  return salaryPaydayRange(date, settings.salaryDay);
}

/** Missing fields in earlier v4 backups mean the optional feature was never enabled. */
export function normalizeSalaryBudgetSettings(value: unknown): SalaryBudgetSettings | null {
  if (value === undefined || value === null) return null;
  const raw = exactObject(value, ["enabled", "periodMode", "salaryDay", "expectedSalary", "percentages", "periodOverride"], ["amounts", "autoIncome"]);
  if (typeof raw.enabled !== "boolean" || (raw.periodMode !== "calendar_month" && raw.periodMode !== "salary_based")) {
    throw new Error("薪资预算周期或启用状态无效");
  }
  if (raw.salaryDay !== null && (typeof raw.salaryDay !== "number" || !Number.isInteger(raw.salaryDay) || raw.salaryDay < 1 || raw.salaryDay > 31)) {
    throw new Error("发薪日需为 1–31 日");
  }
  if (raw.periodMode === "salary_based" && raw.salaryDay === null) throw new Error("请先设置发薪日，再启用工资周期");
  const result: SalaryBudgetSettings = {
    enabled: raw.enabled, periodMode: raw.periodMode, salaryDay: raw.salaryDay as number | null,
    expectedSalary: money(raw.expectedSalary), percentages: percentages(raw.percentages), periodOverride: null,
  };

  if (raw.amounts !== undefined) result.amounts = budgetAmounts(raw.amounts, cents(result.expectedSalary));
  if (raw.autoIncome !== undefined) {
    const auto = exactObject(raw.autoIncome, ["enabled", "startDate", "lastProcessedMonth"]);
    if (typeof auto.enabled !== "boolean" || typeof auto.startDate !== "string") throw new Error("自动工资设置无效");
    parseDate(auto.startDate);
    if (auto.lastProcessedMonth !== null) {
      if (typeof auto.lastProcessedMonth !== "string") throw new Error("自动工资处理月份无效");
      calendarMonthRange(auto.lastProcessedMonth);
    }
    if (auto.enabled && (result.salaryDay === null || result.expectedSalary <= 0)) throw new Error("开启自动记工资前，请设置发薪日和大于 0 的预计薪资");
    result.autoIncome = { enabled: auto.enabled, startDate: auto.startDate, lastProcessedMonth: auto.lastProcessedMonth as string | null };
  }

  if (raw.periodOverride !== null) {
    const override = exactObject(raw.periodOverride, ["startDate", "endDate", "salary"]);
    if (typeof override.startDate !== "string" || typeof override.endDate !== "string") throw new Error("本期薪资调整日期无效");
    const range = createDateRange(override.startDate, override.endDate), expected = rangeFor(result, range.startDate);
    if (range.startDate !== expected.startDate || range.endDate !== expected.endDate) throw new Error("本期薪资调整必须对应一个完整预算周期；更换周期时请清除临时调整");
    result.periodOverride = { ...range, salary: money(override.salary) };
  }
  return result;
}

/** Does not require the feature to be enabled, so bill navigation can reuse its dates. */
export function salaryBudgetRange(settings: SalaryBudgetSettings, date: string): DateRange {
  const normalized = normalizeSalaryBudgetSettings(settings);
  if (!normalized) throw new Error("请先设置薪资预算");
  return rangeFor(normalized, date);
}

/** Ratios are the single source of truth. Largest remainders distribute fractional
 * cents only within the allocated pool; the rest stays explicitly unallocated. */
export function allocateSalaryBudget(salary: number, values: SalaryBudgetPercentages): {
  baseFen: number; amountsFen: NatureAmounts; unallocatedFen: number;
} {
  const baseFen = cents(money(salary)), ratios = percentages(values), base = BigInt(baseFen);
  const parts = NATURES.map((nature, index) => {
    const weighted = base * BigInt(cents(ratios[nature]));
    return { nature, index, fen: weighted / BPS, remainder: weighted % BPS };
  });
  const totalBps = NATURES.reduce((total, nature) => total + cents(ratios[nature]), 0);
  const allocated = base * BigInt(totalBps) / BPS;
  let spare = allocated - parts.reduce((total, part) => total + part.fen, BigInt(0));
  const ranked = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const part of ranked) { if (spare === BigInt(0)) break; part.fen += BigInt(1); spare -= BigInt(1); }
  return { baseFen, amountsFen: Object.fromEntries(parts.map(part => [part.nature, Number(part.fen)])) as NatureAmounts,
    unallocatedFen: Number(base - allocated) };
}

/** Exact editable amounts are authoritative. Scaling uses the original integer
 * cents as weights, never rounded display percentages. A zero base has no
 * implied allocation, so increasing it leaves every cent unallocated. */
export function allocateSalaryBudgetAmounts(baseSalary: number, values: SalaryBudgetAmounts, targetSalary: number = baseSalary): {
  baseFen: number; amountsFen: NatureAmounts; unallocatedFen: number;
} {
  const originalFen = cents(money(baseSalary)), baseFen = cents(money(targetSalary));
  const amounts = budgetAmounts(values, originalFen);
  if (originalFen === 0) return { baseFen, amountsFen: { 消费: 0, 浪费: 0, 投资: 0 }, unallocatedFen: baseFen };
  const denominator = BigInt(originalFen), target = BigInt(baseFen);
  const parts = NATURES.map((nature, index) => {
    const weighted = target * BigInt(cents(amounts[nature]));
    return { nature, index, fen: weighted / denominator, remainder: weighted % denominator };
  });
  const total = NATURES.reduce((sum, nature) => sum + cents(amounts[nature]), 0);
  const allocated = target * BigInt(total) / denominator;
  let spare = allocated - parts.reduce((sum, part) => sum + part.fen, BigInt(0));
  const ranked = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const part of ranked) { if (spare === BigInt(0)) break; part.fen += BigInt(1); spare -= BigInt(1); }
  return { baseFen, amountsFen: Object.fromEntries(parts.map(part => [part.nature, Number(part.fen)])) as NatureAmounts,
    unallocatedFen: Number(target - allocated) };
}
function budgetAmounts(value: unknown, baseFen: number): SalaryBudgetAmounts {
  const raw = exactObject(value, NATURES), result = {} as SalaryBudgetAmounts;
  let sum = 0;
  for (const nature of NATURES) { result[nature] = money(raw[nature]); sum += cents(result[nature]); }
  if (!Number.isSafeInteger(sum) || sum > baseFen) throw new Error("消费、浪费和投资的预算金额合计不能超过预计薪资");
  return result;
}

function addFen(total: number, value: number): number {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new Error("薪资预算账目合计超过支持范围");
  return next;
}
/** Unconfirmed timestamps at a boundary may fall on either local calendar day.
 * Keep every plausible match pending rather than declaring a certain budget alert. */
function possiblyInRange(tx: Transaction, range: DateRange): boolean {
  if (tx.date.length === 10) {
    parseDate(tx.date); return tx.date >= range.startDate && tx.date <= range.endDate;
  }
  const instant = Date.parse(tx.date);
  if (!Number.isFinite(instant)) throw new Error("待核对账目日期无效");
  return instant >= +parseDate(range.startDate) - 14 * 3_600_000
    && instant < +parseDate(range.endDate) + DAY + 12 * 3_600_000;
}

/** Salary is a plan, never a booked income. Only confirmed expense transactions
 * count; account contributions, withdrawals and market values are not inputs. */
export function calculateSalaryBudget(settings: SalaryBudgetSettings | null, transactions: readonly Transaction[], today: string): SalaryBudgetSummary | null {
  const config = normalizeSalaryBudgetSettings(settings);
  if (!config?.enabled) return null;
  const range = rangeFor(config, today);
  const overrideApplied = config.periodOverride?.startDate === range.startDate && config.periodOverride.endDate === range.endDate;
  const effectiveSalary = overrideApplied ? config.periodOverride!.salary : config.expectedSalary;
  const allocated = config.amounts ? allocateSalaryBudgetAmounts(config.expectedSalary, config.amounts, effectiveSalary)
    : allocateSalaryBudget(effectiveSalary, config.percentages);
  const spent: NatureAmounts = { 消费: 0, 浪费: 0, 投资: 0 };
  let pendingDateCount = 0, pendingDateAmountFen = 0, unclassifiedCount = 0, unclassifiedAmountFen = 0;
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (seen.has(tx.id)) throw new Error("薪资预算账目编号重复");
    seen.add(tx.id);
    if (tx.type !== "expense") continue;
    if (tx.dateNeedsConfirmation || tx.date.length > 10) {
      if (possiblyInRange(tx, range)) {
        pendingDateCount++; pendingDateAmountFen = addFen(pendingDateAmountFen, cents(tx.amount));
      }
      continue;
    }
    const day = transactionDay(tx);
    if (day < range.startDate || day > range.endDate) continue;
    const fen = cents(tx.amount);
    if (tx.nature === null) { unclassifiedCount++; unclassifiedAmountFen = addFen(unclassifiedAmountFen, fen); }
    else if (NATURES.includes(tx.nature)) spent[tx.nature] = addFen(spent[tx.nature], fen);
    else throw new Error("薪资预算账目性质无效");
  }
  const alertsSuppressed = pendingDateCount > 0 || unclassifiedCount > 0;
  const rows = NATURES.map(nature => {
    const budgetFen = allocated.amountsFen[nature], spentFen = spent[nature];
    const status: SalaryBudgetStatus = nature === "投资" ? "target" : alertsSuppressed ? "pending"
      : spentFen > budgetFen ? "over"
      : budgetFen > 0 && BigInt(spentFen) * BigInt(5) >= BigInt(budgetFen) * BigInt(4) ? "near" : "ok";
    return { nature, budgetFen, spentFen, remainingFen: budgetFen - spentFen,
      usedPercent: budgetFen === 0 ? null : spentFen / budgetFen * 100, status };
  });
  return { range, baseFen: allocated.baseFen, overrideApplied, unallocatedFen: allocated.unallocatedFen, rows,
    pendingDateCount, pendingDateAmountFen, unclassifiedCount, unclassifiedAmountFen, alertsSuppressed };
}
