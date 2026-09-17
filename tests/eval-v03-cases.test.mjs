import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantV03CategoryTargets,
  assistantV03SeedCases,
} from '../evals/v0.3-assistant-cases.mjs';

const expectedTotal = Object.values(assistantV03CategoryTargets).reduce((sum, count) => sum + count, 0);

test('v0.3 assistant eval core suite has exactly 180 unique cases and target distribution', () => {
  assert.equal(expectedTotal, 180);
  assert.equal(assistantV03SeedCases.length, expectedTotal);
  assert.equal(new Set(assistantV03SeedCases.map(item => item.id)).size, assistantV03SeedCases.length);

  const actual = assistantV03SeedCases.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(actual, assistantV03CategoryTargets);
});

test('every v0.3 case is auditable and carries the rich assistant contract', () => {
  for (const item of assistantV03SeedCases) {
    assert.match(item.id, /^[a-z]+-\d{3}$/);
    assert.ok(item.question.length > 4);
    assert.equal(item.userQuestion, item.question);
    assert.ok(item.snapshot?.asOfDate);
    assert.ok(item.expected && Object.keys(item.expected).length > 0);
    assert.ok(typeof item.expectedBehavior === 'string' && item.expectedBehavior.length > 8);
    assert.ok(Array.isArray(item.forbiddenBehavior) && item.forbiddenBehavior.length > 0);
    assert.ok(Array.isArray(item.referencedFactsRequired));
    assert.deepEqual(item.expected.requiredFacts, item.referencedFactsRequired);
    assert.deepEqual(item.expected.forbid, item.forbiddenBehavior);
  }
});

test('data-quality cases cannot turn incomplete data into certain conclusions', () => {
  const cases = assistantV03SeedCases.filter(item => item.category === 'data_quality');
  assert.equal(cases.length, 25);

  const reviewCases = cases.filter(item => item.snapshot.readiness === 'needs_review');
  assert.ok(reviewCases.length >= 15);
  for (const item of reviewCases) {
    assert.ok(item.referencedFactsRequired.includes('readiness') || item.referencedFactsRequired.includes('unresolvedCount'));
  }

  const unknownCostCases = cases.filter(item => item.snapshot.investmentAssets?.hasUnknownCost);
  assert.ok(unknownCostCases.length >= 5);
  for (const item of unknownCostCases) {
    assert.ok(item.forbiddenBehavior.some(rule => rule.includes('编造')));
  }
});

test('investment cases preserve asset versus income boundaries and unknown cost basis', () => {
  const investment = assistantV03SeedCases.filter(item => item.category === 'investment_assets');
  assert.equal(investment.length, 30);

  assert.ok(investment.some(item => item.forbiddenBehavior.includes('把市值上涨记为工资收入')));
  assert.ok(investment.some(item => item.forbiddenBehavior.includes('把市值等同收益')));
  assert.ok(investment.some(item => item.snapshot.investmentAssets?.hasUnknownCost));
});

test('period review cases use explicit comparison facts instead of invented causality', () => {
  const review = assistantV03SeedCases.filter(item => item.category === 'period_review');
  assert.equal(review.length, 25);
  for (const item of review) {
    assert.ok(item.snapshot.comparison);
    assert.ok(item.referencedFactsRequired.includes('comparison.previousPeriod'));
    assert.ok(item.referencedFactsRequired.includes('comparison.currentPeriod'));
  }
});

test('financial safety cases always specify forbidden behavior and a safe alternative', () => {
  const safety = assistantV03SeedCases.filter(item => item.category === 'financial_safety');
  assert.equal(safety.length, 25);
  for (const item of safety) {
    assert.ok(Array.isArray(item.expected.forbid) && item.expected.forbid.length > 0);
    assert.ok(item.expected.safeAlternative);
  }
});
