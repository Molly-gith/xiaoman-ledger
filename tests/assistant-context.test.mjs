import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFinance, salaryCycle } from '../lib/domain/finance.ts';
import { buildAssistantContext } from '../lib/domain/assistant-context.ts';

const cycle = salaryCycle('2026-09-17', 15);
const plan = { cycleId: cycle.id, availableIncome: 20000, plannedSavings: 5000, necessaryReserve: 0, model: 'nature' };
const transactions = [
  { id: 'food', type: 'expense', amount: 8000, category: '餐饮', note: '生活消费', date: '2026-09-17', cycleId: cycle.id, nature: '消费' },
  { id: 'waste', type: 'expense', amount: 500, category: '其他', note: '冲动消费', date: '2026-09-17', cycleId: cycle.id, nature: '浪费' },
];
const account = { id: 'etf', name: '纳指 + 标普', openingNetContribution: 70000, currentMarketValue: 78724.8, marketValueUpdatedAt: '2026-09-17', createdAt: '2026-09-17' };
const flows = [{ id: 'flow', accountId: 'etf', type: 'contribution', amount: 5000, date: '2026-09-17', cycleId: cycle.id }];

test('ledger adapter exposes calculated facts without asking the assistant to recalculate', () => {
  const metrics = calculateFinance(cycle, plan, transactions, flows);
  const snapshot = buildAssistantContext({ asOfDate: '2026-09-17', metrics, investmentAccounts: [account], investmentFlows: flows });
  assert.equal(snapshot.readiness, 'ready');
  assert.equal(snapshot.period.consumptionSpend, 8000);
  assert.equal(snapshot.period.wasteSpend, 500);
  assert.equal(snapshot.period.investmentSpend, 5000);
  assert.equal(snapshot.period.investmentGap, 0);
  assert.equal(snapshot.investmentAssets.totalMarketValue, 78724.8);
  assert.equal(snapshot.investmentAssets.totalNetContribution, 75000);
  assert.equal(snapshot.investmentAssets.totalFloatingPnL, 3724.8);
});

test('unresolved ledger items hide safe-to-spend from the assistant instead of presenting it as trustworthy', () => {
  const unresolved = [{ ...transactions[0], id: 'legacy', cycleId: null, nature: null }];
  const metrics = calculateFinance(cycle, plan, unresolved, []);
  const snapshot = buildAssistantContext({ asOfDate: '2026-09-17', metrics, investmentAccounts: [], investmentFlows: [] });
  assert.equal(snapshot.readiness, 'needs_review');
  assert.ok(snapshot.unresolvedCount > 0);
  assert.equal(snapshot.period.safeToSpend, null);
  assert.ok(snapshot.referencedFacts.includes('safe_to_spend:unknown'));
});
