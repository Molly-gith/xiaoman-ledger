import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantV03SeedCases } from '../evals/v0.3-assistant-cases.mjs';
import { normalizeAssistantEvalSnapshot, requiredFactCoverage, runLiveQuestionEvaluation } from '../evals/live-question-runner.mjs';

test('normalizes eval fixture into deterministic assistant fact keys', () => {
  const snapshot = normalizeAssistantEvalSnapshot(assistantV03SeedCases[0].snapshot);
  assert.ok(snapshot.referencedFacts.includes('safe_to_spend:7000'));
  assert.ok(snapshot.referencedFacts.includes('investment_account_count:2'));
  assert.ok(snapshot.referencedFacts.includes('investment_market_value:117107.09'));
});

test('required fact coverage maps V0.3 rubric keys to auditable fact prefixes', () => {
  const item = assistantV03SeedCases.find((candidate) => candidate.referencedFactsRequired.includes('safeToSpend'));
  const snapshot = normalizeAssistantEvalSnapshot(item.snapshot);
  const result = requiredFactCoverage(item.referencedFactsRequired, snapshot.referencedFacts);
  assert.equal(result.passed, true);
  assert.deepEqual(result.missing, []);
});

test('all 180 V0.3 question cases are consumable by the live contract harness', async () => {
  const fakeAdapter = {
    async answerFinancialQuestion({ snapshot }) {
      return {
        status: 'suggestion',
        value: {
          answer: 'fixture answer',
          next_actions: [],
          referenced_facts: snapshot.referencedFacts,
          confidence: 1,
        },
        requiresConfirmation: true,
        confirmationReasons: ['user_review'],
        modelVersion: 'fixture-model',
        workflowVersion: 'fixture-workflow',
      };
    },
  };
  const report = await runLiveQuestionEvaluation(fakeAdapter, assistantV03SeedCases, { limit: 180 });
  assert.equal(report.total_dataset, 180);
  assert.equal(report.executed, 180);
  assert.equal(report.contract_failed, 0);
  assert.equal(report.contract_passed, 180);
});
