import { cents } from './finance.ts';

// Product Owner approved 2026-09-15. This is an editable product preset,
// not the author's 70/5/25 expense-nature ratio.
export function suggestBudget(income: number) {
  const total = cents(income);
  const savings = Math.round(total * 15 / 100);
  const reserve = Math.round(total * 35 / 100);
  return { availableIncome: income, plannedSavings: savings / 100,
    necessaryReserve: reserve / 100, everydayBudget: (total - savings - reserve) / 100 };
}
