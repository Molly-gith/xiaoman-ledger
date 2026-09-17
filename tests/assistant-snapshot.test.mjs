import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantFinancialSnapshot } from '../lib/domain/assistant-snapshot.ts';

const base = {
  asOfDate: '2026-09-17',
  safeToSpend: 7000,
  unresolvedCount: 0,
  consumptionSpend: 8000,
  wasteSpend: 500,
  investmentSpend: 5000,
  investmentTarget: 5000,
  investmentAccounts: [
    { id: 'etf', name: '纳指 + 标普', currentMarketValue: 78724.8, netContribution: 70000, floatingPnL: 8724.8 },
    { id: 'fund', name: '嘉实基金', currentMarketValue: 38382.29, netContribution: 35000, floatingPnL: 3382.29 },
  ],
};

test('builds an AI-ready snapshot only from deterministic facts', () => {
  const snapshot = buildAssistantFinancialSnapshot(base);
  assert.equal(snapshot.readiness, 'ready');
  assert.equal(snapshot.period.safeToSpend, 7000);
  assert.equal(snapshot.period.investmentGap, 0);
  assert.equal(snapshot.investmentAssets.accountCount, 2);
  assert.equal(snapshot.investmentAssets.totalMarketValue, 117107.09);
  assert.equal(snapshot.investmentAssets.totalNetContribution, 105000);
  assert.equal(snapshot.investmentAssets.totalFloatingPnL, 12107.09);
  assert.ok(snapshot.referencedFacts.includes('safe_to_spend:7000'));
});

test('does not invent aggregate investment profit when any cost basis is unknown', () => {
  const snapshot = buildAssistantFinancialSnapshot({
    ...base,
    investmentAccounts: [
      base.investmentAccounts[0],
      { id: 'unknown', name: '历史基金', currentMarketValue: 20000, netContribution: null, floatingPnL: null },
    ],
  });
  assert.equal(snapshot.investmentAssets.totalMarketValue, 98724.8);
  assert.equal(snapshot.investmentAssets.totalNetContribution, null);
  assert.equal(snapshot.investmentAssets.totalFloatingPnL, null);
  assert.equal(snapshot.investmentAssets.hasUnknownCost, true);
  assert.ok(snapshot.referencedFacts.includes('investment_floating_pnl:unknown'));
});

test('marks unresolved ledger facts as needing review without hiding a negative safe-to-spend value', () => {
  const snapshot = buildAssistantFinancialSnapshot({
    ...base,
    safeToSpend: -320,
    unresolvedCount: 2,
    investmentSpend: 2000,
  });
  assert.equal(snapshot.readiness, 'needs_review');
  assert.equal(snapshot.period.safeToSpend, -320);
  assert.equal(snapshot.period.investmentGap, 3000);
  assert.equal(snapshot.unresolvedCount, 2);
});

test('rejects non-finite or negative fact inputs before they can reach the assistant', () => {
  assert.throws(() => buildAssistantFinancialSnapshot({ ...base, wasteSpend: -1 }), /wasteSpend must be non-negative/);
  assert.throws(() => buildAssistantFinancialSnapshot({ ...base, safeToSpend: Number.NaN }), /safeToSpend must be finite/);
});
