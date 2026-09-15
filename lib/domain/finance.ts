import type { BudgetPlan, FinancialCycle, Transaction } from "./types.ts";

const DAY = 86400000;
export function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("请输入有效日期");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9998) throw new Error("请输入有效日期");
  return date;
}
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function iso(date: Date) { return date.toISOString().slice(0, 10); }
function payday(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}
export function salaryCycle(date: string, salaryDay: number): FinancialCycle {
  if (!Number.isInteger(salaryDay) || salaryDay < 1 || salaryDay > 31) throw new Error("发薪日需为 1–31 日");
  const today = parseDate(date), y = today.getUTCFullYear(), m = today.getUTCMonth();
  const thisPayday = payday(y, m, salaryDay);
  const start = today < thisPayday ? payday(y, m - 1, salaryDay) : thisPayday;
  const next = payday(start.getUTCFullYear(), start.getUTCMonth() + 1, salaryDay);
  return { id: `cycle-${iso(start)}-${salaryDay}`, salaryDay, startDate: iso(start), endDate: iso(new Date(+next - DAY)), nextSalaryDate: iso(next) };
}
export function remainingDays(cycle: FinancialCycle, today: string): number {
  return Math.max(0, Math.round((+parseDate(cycle.nextSalaryDate) - +parseDate(today)) / DAY));
}
export function cents(value: number): number {
  const rounded = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(rounded) || rounded > 99999999999999 || Math.abs(value * 100 - rounded) > Math.max(1e-6, Math.abs(value * 100) * Number.EPSILON)) throw new Error("金额需为非负数，最多两位小数，且小于一万亿元");
  return rounded;
}
export function sumMoney(values: number[]): number {
  const total = values.reduce((sum, value) => sum + cents(value), 0);
  if (!Number.isSafeInteger(total)) throw new Error("金额合计超过支持范围");
  return total / 100;
}
export function transactionDay(tx: Transaction): string {
  return tx.date.length === 10 ? iso(parseDate(tx.date)) : localDate(new Date(tx.date));
}
export function inCycle(tx: Transaction, cycle: FinancialCycle): boolean {
  if (tx.dateNeedsConfirmation) return tx.cycleId === cycle.id;
  const day = transactionDay(tx);
  return tx.cycleId === cycle.id && day >= cycle.startDate && day <= cycle.endDate;
}
export function calculateFinance(cycle: FinancialCycle, plan: BudgetPlan, transactions: Transaction[]) {
  if (plan.cycleId !== cycle.id) throw new Error("预算与周期不匹配");
  const budget = cents(plan.availableIncome) - cents(plan.plannedSavings) - cents(plan.necessaryReserve);
  const expenses = transactions.filter(tx => tx.type === "expense" && inCycle(tx, cycle));
  const variable = sumMoney(expenses.filter(tx => tx.spendKind === "variable").map(tx => tx.amount));
  const reserved = sumMoney(expenses.filter(tx => tx.spendKind === "reserved").map(tx => tx.amount));
  const totalExpense = sumMoney(expenses.map(tx => tx.amount));
  const natureMix = (["消费", "浪费", "投资"] as const).map(nature => {
    const amount = sumMoney(expenses.filter(tx => tx.nature === nature).map(tx => tx.amount));
    return { nature, amount, percent: totalExpense ? amount / totalExpense * 100 : 0 };
  });
  const unresolved = transactions.filter(tx => tx.type === "expense" && (
    (tx.dateNeedsConfirmation && tx.cycleId === cycle.id) ||
    (transactionDay(tx) >= cycle.startDate && transactionDay(tx) <= cycle.endDate && (!tx.cycleId || !tx.spendKind))
  ));
  return { safeToSpend: (budget - cents(variable)) / 100, variableBudget: budget / 100, variableSpend: variable,
    reservedSpend: reserved, reserveRemaining: (cents(plan.necessaryReserve) - cents(reserved)) / 100,
    totalExpense, natureMix, unresolvedCount: unresolved.length,
    budgetPercent: budget > 0 ? cents(variable) / budget * 100 : null };
}
