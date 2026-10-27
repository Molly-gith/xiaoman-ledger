import { calendarMonthRange } from "./date-range.ts";
import { parseDate } from "./finance.ts";
import { normalizeSalaryBudgetSettings } from "./salary-budget.ts";
import type { SalaryBudgetSettings, Transaction } from "./types.ts";

const DAY = 86_400_000;
export const AUTOMATIC_SALARY_NOTE = "工资（自动记录，请核对实际到账）";
export const MAX_LEDGER_TRANSACTIONS = 5000;
export type RecurringSalaryResult = {
  settings: SalaryBudgetSettings | null; transactions: Transaction[]; added: Transaction[];
  skippedManualMonths: string[]; changed: boolean;
};

/** The device and hourly cloud worker share one payday clock. Budget views keep
 * their existing local calendar dates; this helper only schedules salary entries. */
export function recurringSalaryToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  const result = get("year") + "-" + get("month") + "-" + get("day");
  parseDate(result); return result;
}
function active(settings: SalaryBudgetSettings | null): boolean {
  return !!settings?.enabled && !!settings.autoIncome?.enabled;
}
export function scheduledSalaryDate(month: string, salaryDay: number): string {
  if (!Number.isInteger(salaryDay) || salaryDay < 1 || salaryDay > 31) throw new Error("自动工资的发薪日需为 1–31 日");
  const range = calendarMonthRange(month);
  return month + "-" + String(Math.min(salaryDay, Number(range.endDate.slice(8)))).padStart(2, "0");
}
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4)), value = Number(month.slice(5));
  return value === 12 ? String(year + 1).padStart(4, "0") + "-01" : month.slice(0, 5) + String(value + 1).padStart(2, "0");
}

/** A month's existing named salary is enough to avoid a second salary. Amount
 * equality or a transfer from a salary card is not evidence of salary income. */
export function isManualSalaryForMonth(tx: Transaction, month: string): boolean {
  if (tx.type !== "income" || tx.autoSalary) return false;
  const text = (tx.category + " " + tx.note).normalize("NFKC").toLowerCase()
    .replace(/(?:不是|并非|不算|非)(?:工资|薪资|薪水|薪酬)/g, "")
    .replace(/(?:工资|薪资)(?:卡|账户)/g, "");
  if (!/工资|薪资|薪水|薪酬|\b(?:salary|payroll|paycheck)\b/i.test(text)) return false;
  const range = calendarMonthRange(month);
  if (tx.date.length === 10) { parseDate(tx.date); return tx.date.slice(0, 7) === month; }
  const instant = Date.parse(tx.date);
  if (!Number.isFinite(instant)) throw new Error("已有工资账目日期无效");
  // Legacy timestamps can belong to a neighbouring calendar day; conservatively
  // skip a possible duplicate regardless of which device is doing the processing.
  return instant >= +parseDate(range.startDate) - 14 * 3_600_000
    && instant < +parseDate(range.endDate) + DAY + 12 * 3_600_000;
}

/** Call after reconciling the old settings through today, then reconcile the
 * returned settings again for today's newly enabled payday. User form fields
 * cannot rewind the durable month watermark or backdate first/re-activation. */
export function prepareRecurringSalarySettings(
  previous: SalaryBudgetSettings | null, next: SalaryBudgetSettings | null, today: string,
): SalaryBudgetSettings | null {
  parseDate(today);
  const before = normalizeSalaryBudgetSettings(previous), result = normalizeSalaryBudgetSettings(next);
  if (!result) return null;
  if (!result.autoIncome && !before?.autoIncome) return result;
  const requestedEnabled = result.autoIncome?.enabled ?? false;
  const alreadyActive = active(before), willBeActive = result.enabled && requestedEnabled;
  result.autoIncome = {
    enabled: requestedEnabled,
    startDate: willBeActive && !alreadyActive ? today : before?.autoIncome?.startDate ?? today,
    lastProcessedMonth: before?.autoIncome?.lastProcessedMonth ?? null,
  };
  return normalizeSalaryBudgetSettings(result);
}

/** Pure all-or-nothing transformation. Commit BOTH the returned settings and
 * transactions in the same ledger CAS. Never rerun using a partially saved
 * watermark; deleting/editing a generated entry must leave the watermark intact. */
export function reconcileRecurringSalary(
  settings: SalaryBudgetSettings | null, transactions: readonly Transaction[], today: string,
): RecurringSalaryResult {
  parseDate(today);
  const config = normalizeSalaryBudgetSettings(settings);
  const kept = structuredClone([...transactions]);
  const empty = { settings: config, transactions: kept, added: [], skippedManualMonths: [], changed: false };
  if (!active(config)) return empty;
  if (kept.length > MAX_LEDGER_TRANSACTIONS) throw new Error("每本最多保存 5000 笔，自动工资未处理，原账目已保留");
  const auto = config!.autoIncome!, salaryDay = config!.salaryDay!;
  let month = auto.startDate.slice(0, 7);
  if (auto.lastProcessedMonth && month <= auto.lastProcessedMonth) month = nextMonth(auto.lastProcessedMonth);
  const currentMonth = today.slice(0, 7), ids = new Set(kept.map(tx => tx.id));
  if (ids.size !== kept.length) throw new Error("账目编号重复，自动工资未处理");
  const added: Transaction[] = [], skippedManualMonths: string[] = [];
  let processed = auto.lastProcessedMonth;
  while (month <= currentMonth) {
    const due = scheduledSalaryDate(month, salaryDay);
    if (due > today) break;
    if (due >= auto.startDate) {
      const id = "salary-auto-" + month;
      const exists = ids.has(id) || kept.some(tx => tx.autoSalary?.month === month);
      const manual = !exists && kept.some(tx => isManualSalaryForMonth(tx, month));
      if (manual) skippedManualMonths.push(month);
      if (!exists && !manual) {
        if (kept.length + added.length >= MAX_LEDGER_TRANSACTIONS) throw new Error("自动工资补记会超过每本 5000 笔上限，原账目和处理进度已保留");
        const tx: Transaction = { id, type: "income", amount: config!.expectedSalary, date: due,
          category: "收入", note: AUTOMATIC_SALARY_NOTE, icon: "薪", source: "text",
          cycleId: null, nature: null, spendKind: null, autoSalary: { month, scheduledDate: due } };
        added.push(tx); ids.add(id);
      }
    }
    // A payday before activation is deliberately skipped as well, so it can
    // never become retroactively due after a later settings change.
    processed = month;
    month = nextMonth(month);
  }
  const changed = processed !== auto.lastProcessedMonth || added.length > 0;
  if (changed) config!.autoIncome = { ...auto, lastProcessedMonth: processed };
  const resultTransactions = added.length ? [...kept, ...added].sort((a, b) => b.date.localeCompare(a.date)) : kept;
  return { settings: config, transactions: resultTransactions, added, skippedManualMonths, changed };
}
