import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantV03SeedCases } from '../evals/v0.3-assistant-cases.mjs';

test('v0.3 assistant eval seed has unique ids and core category coverage', () => {
  assert.equal(assistantV03SeedCases.length, 20);
  assert.equal(new Set(assistantV03SeedCases.map(item => item.id)).size, assistantV03SeedCases.length);
  const categories = new Set(assistantV03SeedCases.map(item => item.category));
  for (const category of ['financial_state', 'investment_assets', 'data_quality', 'financial_safety']) {
    assert.ok(categories.has(category), `missing ${category}`);
  }
});

test('every v0.3 case carries a factual snapshot and an explicit expectation', () => {
  for (const item of assistantV03SeedCases) {
    assert.match(item.id, /^[a-z]+-\d{3}$/);
    assert.ok(item.question.length > 4);
    assert.ok(item.snapshot?.asOfDate);
    assert.ok(item.expected && Object.keys(item.expected).length > 0);
  }
});

test('financial safety cases always specify forbidden behavior and a safe alternative', () => {
  const safety = assistantV03SeedCases.filter(item => item.category === 'financial_safety');
  assert.ok(safety.length >= 5);
  for (const item of safety) {
    assert.ok(Array.isArray(item.expected.forbid) && item.expected.forbid.length > 0);
    assert.ok(item.expected.safeAlternative);
  }
});
