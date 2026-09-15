# 小满 AI Eval Spec V0.1

## Goal

证明 AI 能力在核心任务上可用、可控、可回归，而不是只看主观体验。

## Initial metrics

| Capability | Metric | V0.1 target |
|---|---|---:|
| Amount extraction | Accuracy | >= 98% |
| Income/expense type | Accuracy | >= 98% |
| Time extraction | Accuracy | >= 90% |
| Category | Top-1 Accuracy | >= 90% |
| 消费/浪费/投资 | Acceptable recommendation rate | >= 80% |
| Expense nature | Obvious error rate | <= 5% |
| Cycle review | Rubric average | >= 8/10 |
| Cycle review | Severe factual error | 0 |

These are initial targets, not industry standards. Run a baseline first and adjust thresholds based on risk and observed model capability.

## Error severity

### P0 severe

- amount order-of-magnitude error;
- income/expense reversal;
- refund recorded as expense;
- fabricated financial fact.

Target: < 1%.

### P1 medium

- category error;
- time error;
- clearly unreasonable recommendation that user can correct.

### P2 minor

- note wording difference;
- non-critical phrasing issue.

## Initial test set

- Natural-language bookkeeping: 80 cases.
- Category classification: 80 cases.
- 消费/浪费/投资: 100 cases.
- Cycle review: 30 full cases.

Total: ~290 cases.

## Case schema

`case_id / capability / user_input / user_context / expected_structured_output / gold_label / acceptable_labels / unacceptable_labels / gold_reason / risk_level / boundary_case / model_output / pass / failure_reason / prompt_version / model_version`

## Subjective nature evaluation

Do not force one gold answer when multiple answers are reasonable.

Example: a gym membership may allow `投资` or `消费`; only clear context such as repeated impulsive purchase should strongly support `浪费`.

## Cycle review rubric — 10 points

- Data correctness: 0–2
- Finds the important change: 0–2
- No fabrication: 0–2
- Advice is actionable: 0–2
- Matches Xiaoman tone: 0–2

## Regression Gate

Every prompt/model/schema/workflow change runs the core regression set.

A change that improves aggregate score but worsens P0 error rate cannot ship automatically.

## Online Bad Case loop

`AI suggestion -> user edit/failure -> Bad Case Pool -> human label -> Regression Set -> optimize -> rerun`

## Rule tests — non-AI

Safe-to-spend, budget, financial cycle, financial health and achievement rules use deterministic unit tests. Defined core cases require 100% correctness.
