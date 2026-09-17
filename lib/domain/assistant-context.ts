import { calculateFinance } from './finance.ts';
import { floatingPnL, netContribution } from './investment.ts';
import type { InvestmentAccount, InvestmentFlow } from './types.ts';
import { buildAssistantFinancialSnapshot, type AssistantFinancialSnapshot, type AssistantPeriodComparison } from './assistant-snapshot.ts';

type FinanceMetrics = ReturnType<typeof calculateFinance>;

export type AssistantContextInput = {
  asOfDate: string;
  metrics: FinanceMetrics;
  investmentAccounts: InvestmentAccount[];
  investmentFlows: InvestmentFlow[];
  /** Optional deterministic prior/current period comparison for review experiences. */
  comparison?: AssistantPeriodComparison;
};

/**
 * Converts the ledger's deterministic domain output into the only fact payload
 * the AI assistant should see for financial-state explanations.
 *
 * This adapter intentionally does not infer a financial stage. Stage thresholds
 * are a product policy decision and must be supplied by a separate, testable rule.
 */
export function buildAssistantContext(input: AssistantContextInput): AssistantFinancialSnapshot {
  const consumptionSpend = input.metrics.natureMix.find(item => item.nature === '消费')?.amount ?? 0;
  const wasteSpend = input.metrics.natureMix.find(item => item.nature === '浪费')?.amount ?? 0;

  return buildAssistantFinancialSnapshot({
    asOfDate: input.asOfDate,
    safeToSpend: input.metrics.unresolvedCount > 0 ? null : input.metrics.safeToSpend,
    unresolvedCount: input.metrics.unresolvedCount,
    consumptionSpend,
    wasteSpend,
    investmentSpend: input.metrics.investmentSpend,
    investmentTarget: input.metrics.investmentTarget,
    investmentAccounts: input.investmentAccounts.map(account => ({
      id: account.id,
      name: account.name,
      currentMarketValue: account.currentMarketValue,
      netContribution: netContribution(account, input.investmentFlows),
      floatingPnL: floatingPnL(account, input.investmentFlows),
    })),
    ...(input.comparison ? { comparison: input.comparison } : {}),
  });
}
