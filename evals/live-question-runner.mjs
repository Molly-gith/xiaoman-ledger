const FACT_PREFIX = Object.freeze({
  safeToSpend: 'safe_to_spend:',
  consumptionSpend: 'consumption_spend:',
  wasteSpend: 'waste_spend:',
  investmentSpend: 'investment_spend:',
  investmentTarget: 'investment_target:',
  investmentGap: 'investment_gap:',
  readiness: 'readiness:',
  unresolvedCount: 'unresolved_count:',
  totalMarketValue: 'investment_market_value:',
  totalNetContribution: 'investment_net_contribution:',
  totalFloatingPnL: 'investment_floating_pnl:',
  accountCount: 'investment_account_count:',
  hasUnknownCost: 'investment_cost_basis:',
  'comparison.previousPeriod': 'comparison_previous_',
  'comparison.currentPeriod': 'comparison_current_',
});

function fact(value, unknownLabel = 'unknown') {
  return value === null || value === undefined ? unknownLabel : String(value);
}

/** Convert the human-readable V0.3 eval fixture into the production AssistantFinancialSnapshot contract. */
export function normalizeAssistantEvalSnapshot(raw) {
  const period = raw.period ?? {};
  const assets = raw.investmentAssets ?? {};
  const referencedFacts = [
    `as_of:${raw.asOfDate}`,
    `readiness:${raw.readiness}`,
    `unresolved_count:${raw.unresolvedCount}`,
    `safe_to_spend:${fact(period.safeToSpend)}`,
    `consumption_spend:${period.consumptionSpend}`,
    `waste_spend:${period.wasteSpend}`,
    `investment_spend:${period.investmentSpend}`,
    `investment_target:${period.investmentTarget}`,
    `investment_gap:${period.investmentGap}`,
    `investment_account_count:${assets.accountCount}`,
    `investment_market_value:${assets.totalMarketValue}`,
    assets.hasUnknownCost ? 'investment_cost_basis:partial_or_unknown' : `investment_net_contribution:${assets.totalNetContribution}`,
    assets.hasUnknownCost ? 'investment_floating_pnl:unknown' : `investment_floating_pnl:${assets.totalFloatingPnL}`,
  ];

  if (raw.comparison) {
    for (const [prefix, side] of [
      ['comparison_previous', raw.comparison.previousPeriod],
      ['comparison_current', raw.comparison.currentPeriod],
    ]) {
      referencedFacts.push(
        `${prefix}_consumption_spend:${side.consumptionSpend}`,
        `${prefix}_waste_spend:${side.wasteSpend}`,
        `${prefix}_investment_spend:${side.investmentSpend}`,
        `${prefix}_safe_to_spend:${fact(side.safeToSpend)}`,
      );
    }
  }

  return {
    asOfDate: raw.asOfDate,
    readiness: raw.readiness,
    unresolvedCount: raw.unresolvedCount,
    period: { ...period },
    investmentAssets: { ...assets },
    ...(raw.comparison ? { comparison: raw.comparison } : {}),
    referencedFacts,
  };
}

export function requiredFactCoverage(required, referencedFacts) {
  const missing = [];
  for (const key of required ?? []) {
    const prefix = FACT_PREFIX[key];
    if (!prefix) {
      missing.push(`${key}:unmapped`);
      continue;
    }
    if (!referencedFacts.some((item) => item.startsWith(prefix))) missing.push(key);
  }
  return { passed: missing.length === 0, missing };
}

/**
 * Contract/fact-citation baseline only. Semantic forbidden-behavior rubrics stay explicit in rows
 * and must be reviewed before this report can be called a product-quality accuracy baseline.
 */
export async function runLiveQuestionEvaluation(adapter, cases, { limit = cases.length } = {}) {
  const selected = cases.slice(0, Math.max(0, Math.min(limit, cases.length)));
  const rows = [];
  for (const item of selected) {
    const snapshot = normalizeAssistantEvalSnapshot(item.snapshot);
    const context = item.context ?? { today: snapshot.asOfDate, timezone: 'Asia/Shanghai' };
    const result = await adapter.answerFinancialQuestion({ question: item.userQuestion, snapshot }, context);
    if (result.status !== 'suggestion') {
      rows.push({
        case_id: item.id,
        category: item.category,
        status: 'failed',
        failure: `adapter_${result.reason}`,
        required_fact_coverage: false,
        semantic_review_required: true,
      });
      continue;
    }

    const coverage = requiredFactCoverage(item.referencedFactsRequired, result.value.referenced_facts);
    rows.push({
      case_id: item.id,
      category: item.category,
      status: coverage.passed ? 'contract_pass' : 'failed',
      failure: coverage.passed ? null : 'missing_required_fact_reference',
      missing_required_facts: coverage.missing,
      required_fact_coverage: coverage.passed,
      semantic_review_required: (item.forbiddenBehavior?.length ?? 0) > 0,
      forbidden_behaviors: item.forbiddenBehavior ?? [],
      answer: result.value.answer,
      next_actions: result.value.next_actions,
      referenced_facts: result.value.referenced_facts,
      confidence: result.value.confidence,
      model_version: result.modelVersion,
      workflow_version: result.workflowVersion,
    });
  }

  const failed = rows.filter((row) => row.status === 'failed').length;
  const semanticReview = rows.filter((row) => row.semantic_review_required).length;
  return {
    label: 'LIVE_CONTRACT_BASELINE — semantic safety/quality review is still required before Beta claims',
    total_dataset: cases.length,
    executed: rows.length,
    contract_passed: rows.length - failed,
    contract_failed: failed,
    semantic_review_required: semanticReview,
    contract_pass_rate: rows.length ? (rows.length - failed) / rows.length : null,
    rows,
  };
}
