export type AssistantReadiness = "ready" | "needs_review";

export type AssistantInvestmentAccountFact = {
  id: string;
  name: string;
  currentMarketValue: number;
  netContribution: number | null;
  floatingPnL: number | null;
};

export type AssistantPeriodComparisonSide = {
  consumptionSpend: number;
  wasteSpend: number;
  investmentSpend: number;
  safeToSpend: number | null;
};

export type AssistantPeriodComparison = {
  previousPeriod: AssistantPeriodComparisonSide;
  currentPeriod: AssistantPeriodComparisonSide;
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
  /** Optional deterministic period comparison. Omit when the product has no prior-period facts. */
  comparison?: AssistantPeriodComparison;
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
  /** Present only when both sides are supplied by deterministic product code. */
  comparison?: AssistantPeriodComparison;
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

function normalizeComparisonSide(side: AssistantPeriodComparisonSide, label: string): AssistantPeriodComparisonSide {
  return {
    consumptionSpend: nonNegative(side.consumptionSpend, `${label}.consumptionSpend`),
    wasteSpend: nonNegative(side.wasteSpend, `${label}.wasteSpend`),
    investmentSpend: nonNegative(side.investmentSpend, `${label}.investmentSpend`),
    safeToSpend: side.safeToSpend === null ? null : finite(side.safeToSpend, `${label}.safeToSpend`),
  };
}

/**
 * Builds the deterministic fact payload that the AI assistant is allowed to use.
 *
 * Product boundary:
 * - rules/code calculate money, progress, asset totals and optional period comparisons;
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
  const comparison = input.comparison ? {
    previousPeriod: normalizeComparisonSide(input.comparison.previousPeriod, "comparison.previousPeriod"),
    currentPeriod: normalizeComparisonSide(input.comparison.currentPeriod, "comparison.currentPeriod"),
  } : undefined;

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
    `investment_account_count:${input.investmentAccounts.length}`,
    `investment_market_value:${totalMarketValue}`,
    hasUnknownCost ? "investment_cost_basis:partial_or_unknown" : `investment_net_contribution:${totalNetContribution}`,
    hasUnknownCost ? "investment_floating_pnl:unknown" : `investment_floating_pnl:${totalFloatingPnL}`,
  ];

  if (comparison) {
    for (const [prefix, side] of [["comparison_previous", comparison.previousPeriod], ["comparison_current", comparison.currentPeriod]] as const) {
      referencedFacts.push(
        `${prefix}_consumption_spend:${side.consumptionSpend}`,
        `${prefix}_waste_spend:${side.wasteSpend}`,
        `${prefix}_investment_spend:${side.investmentSpend}`,
        side.safeToSpend === null ? `${prefix}_safe_to_spend:unknown` : `${prefix}_safe_to_spend:${side.safeToSpend}`,
      );
    }
  }

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
    ...(comparison ? { comparison } : {}),
    referencedFacts,
  };
}
