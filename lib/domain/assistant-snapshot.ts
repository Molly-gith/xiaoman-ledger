export type AssistantReadiness = "ready" | "needs_review";

export type AssistantInvestmentAccountFact = {
  id: string;
  name: string;
  currentMarketValue: number;
  netContribution: number | null;
  floatingPnL: number | null;
};

export type AssistantFinancialSnapshotInput = {
  asOfDate: string;
  safeToSpend: number | null;
  unresolvedCount: number;
  consumptionSpend: number;
  wasteSpend: number;
  investmentSpend: number;
  investmentTarget: number;
  investmentAccounts: AssistantInvestmentAccountFact[];
};

export type AssistantFinancialSnapshot = {
  asOfDate: string;
  readiness: AssistantReadiness;
  unresolvedCount: number;
  period: {
    safeToSpend: number | null;
    consumptionSpend: number;
    wasteSpend: number;
    investmentSpend: number;
    investmentTarget: number;
    investmentGap: number;
  };
  investmentAssets: {
    accountCount: number;
    totalMarketValue: number;
    totalNetContribution: number | null;
    totalFloatingPnL: number | null;
    hasUnknownCost: boolean;
  };
  referencedFacts: string[];
};

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function nonNegative(value: number, label: string): number {
  const checked = finite(value, label);
  if (checked < 0) throw new Error(`${label} must be non-negative`);
  return checked;
}

/**
 * Builds the deterministic fact payload that the AI assistant is allowed to use.
 *
 * Product boundary:
 * - rules/code calculate money, progress and asset totals;
 * - the LLM may explain these facts, but must not recalculate them;
 * - if any investment account has unknown cost basis, aggregate cost/P&L stay null.
 */
export function buildAssistantFinancialSnapshot(input: AssistantFinancialSnapshotInput): AssistantFinancialSnapshot {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) throw new Error("asOfDate must be YYYY-MM-DD");
  if (!Number.isInteger(input.unresolvedCount) || input.unresolvedCount < 0) throw new Error("unresolvedCount must be a non-negative integer");

  const safeToSpend = input.safeToSpend === null ? null : finite(input.safeToSpend, "safeToSpend");
  const consumptionSpend = nonNegative(input.consumptionSpend, "consumptionSpend");
  const wasteSpend = nonNegative(input.wasteSpend, "wasteSpend");
  const investmentSpend = nonNegative(input.investmentSpend, "investmentSpend");
  const investmentTarget = nonNegative(input.investmentTarget, "investmentTarget");

  let totalMarketValue = 0;
  let totalNetContribution = 0;
  let totalFloatingPnL = 0;
  let hasUnknownCost = false;

  for (const account of input.investmentAccounts) {
    totalMarketValue += nonNegative(account.currentMarketValue, `investmentAccounts.${account.id}.currentMarketValue`);
    if (account.netContribution === null || account.floatingPnL === null) {
      hasUnknownCost = true;
      continue;
    }
    totalNetContribution += finite(account.netContribution, `investmentAccounts.${account.id}.netContribution`);
    totalFloatingPnL += finite(account.floatingPnL, `investmentAccounts.${account.id}.floatingPnL`);
  }

  const investmentGap = Math.max(0, investmentTarget - investmentSpend);
  const readiness: AssistantReadiness = input.unresolvedCount > 0 || safeToSpend === null ? "needs_review" : "ready";

  const referencedFacts = [
    `as_of:${input.asOfDate}`,
    `readiness:${readiness}`,
    `unresolved_count:${input.unresolvedCount}`,
    safeToSpend === null ? "safe_to_spend:unknown" : `safe_to_spend:${safeToSpend}`,
    `consumption_spend:${consumptionSpend}`,
    `waste_spend:${wasteSpend}`,
    `investment_spend:${investmentSpend}`,
    `investment_target:${investmentTarget}`,
    `investment_gap:${investmentGap}`,
    `investment_market_value:${totalMarketValue}`,
    hasUnknownCost ? "investment_cost_basis:partial_or_unknown" : `investment_net_contribution:${totalNetContribution}`,
    hasUnknownCost ? "investment_floating_pnl:unknown" : `investment_floating_pnl:${totalFloatingPnL}`,
  ];

  return {
    asOfDate: input.asOfDate,
    readiness,
    unresolvedCount: input.unresolvedCount,
    period: {
      safeToSpend,
      consumptionSpend,
      wasteSpend,
      investmentSpend,
      investmentTarget,
      investmentGap,
    },
    investmentAssets: {
      accountCount: input.investmentAccounts.length,
      totalMarketValue,
      totalNetContribution: hasUnknownCost ? null : totalNetContribution,
      totalFloatingPnL: hasUnknownCost ? null : totalFloatingPnL,
      hasUnknownCost,
    },
    referencedFacts,
  };
}
