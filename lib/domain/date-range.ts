import { cents, parseDate, transactionDay } from "./finance.ts";
import type { Transaction } from "./types.ts";

/** An inclusive range of calendar dates; selecting it never changes a budget cycle. */
export type DateRange = { startDate: string; endDate: string };

/** Safe to send for an explanation: no transaction notes, account names or records. */
export type DateRangeSummary = {
  range: DateRange;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  income: number;
  expense: number;
  /** Recorded income minus recorded expenses, not an account balance or available budget. */
  balance: number;
  natureTotals: { 消费: number; 浪费: number; 投资: number; 未分类: number };
  /** Legacy timestamps use the device calendar date until the user confirms their date. */
  pendingDateCount: number;
};

export function createDateRange(startDate: string, endDate: string): DateRange {
  parseDate(startDate); parseDate(endDate);
  if (startDate > endDate) throw new Error("结束日期不能早于开始日期");
  return { startDate, endDate };
}

/** Accepts the YYYY-MM value produced by a month picker, including historical months. */
export function calendarMonthRange(month: string): DateRange {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("请选择有效月份");
  const startDate = `${month}-01`, start = parseDate(startDate);
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return createDateRange(startDate, last.toISOString().slice(0, 10));
}

export function transactionsInDateRange(transactions: readonly Transaction[], range: DateRange): Transaction[] {
  const { startDate, endDate } = createDateRange(range.startDate, range.endDate);
  return transactions.filter(tx => {
    const day = transactionDay(tx);
    parseDate(day);
    return day >= startDate && day <= endDate;
  });
}

function addFen(total: number, amount: number): number {
  const next = total + cents(amount);
  if (!Number.isSafeInteger(next)) throw new Error("金额合计超过支持范围");
  return next;
}

/** All transactions count by their date, whether or not they belong to a budget cycle.
 * Investment account flows, market values and budget funding are separate concepts and
 * are deliberately not counted as recorded income/expenses here.
 */
export function summarizeDateRange(transactions: readonly Transaction[], range: DateRange): DateRangeSummary {
  const selected = transactionsInDateRange(transactions, range);
  let income = 0, expense = 0, incomeCount = 0, expenseCount = 0, pendingDateCount = 0;
  const natureFen = { 消费: 0, 浪费: 0, 投资: 0, 未分类: 0 };
  for (const tx of selected) {
    if (tx.dateNeedsConfirmation || tx.date.length > 10) pendingDateCount++;
    if (tx.type === "income") {
      income = addFen(income, tx.amount); incomeCount++;
    } else {
      expense = addFen(expense, tx.amount); expenseCount++;
      const nature = tx.nature ?? "未分类";
      natureFen[nature] = addFen(natureFen[nature], tx.amount);
    }
  }
  return {
    range: createDateRange(range.startDate, range.endDate),
    transactionCount: selected.length, incomeCount, expenseCount,
    income: income / 100, expense: expense / 100, balance: (income - expense) / 100,
    natureTotals: { 消费: natureFen.消费 / 100, 浪费: natureFen.浪费 / 100,
      投资: natureFen.投资 / 100, 未分类: natureFen.未分类 / 100 },
    pendingDateCount,
  };
}
