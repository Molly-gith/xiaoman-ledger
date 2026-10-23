import { cents } from './finance.ts';

// CR-001: 70/5/25 is a goal-and-feedback structure, not three wallets to spend down.
// 消费≈70% is a reference, 浪费≤5% is a ceiling, 投资≥25% is a protected target.
export function suggestBudget(income: number) {
  const total = cents(income);
  const consumption = Math.round(total * 70 / 100);
  const waste = Math.round(total * 5 / 100);
  const investment = total - consumption - waste;
  return {
    availableIncome: income,
    plannedSavings: investment / 100,
    necessaryReserve: 0,
    model: 'nature' as const,
    everydayBudget: (consumption + waste) / 100,
    consumptionReference: consumption / 100,
    wasteLimit: waste / 100,
    investmentTarget: investment / 100,
  };
}
