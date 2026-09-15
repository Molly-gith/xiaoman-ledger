# 小满 AI Capability Spec V0.1

## Principle

数据是真实世界；规则保证正确性；AI负责理解、分析、解释和建议；用户拥有最终决定权。

## A1 Natural-language bookkeeping

Input: user text or ASR text.

Example: `昨晚跟朋友吃火锅我付了268。`

Output schema:

- `type`
- `amount`
- `category`
- `occurred_at`
- `note`
- `nature_suggestion`
- `confidence`

Rules:

- Amount/type/date extraction must pass schema validation.
- Low confidence or multi-amount ambiguity requires confirmation.
- Failure fallback: preserve original text and open manual bookkeeping form.

## A2 Category recommendation

Input: transaction text + known merchant/note + optional historical preference.

Output: `category + confidence + short_reason`.

User edits must be logged separately from AI suggestion.

## A3 消费 / 浪费 / 投资 recommendation

Input: transaction + user context + optional historical choices.

Output:

- `recommended_nature`
- `acceptable_alternative?`
- `reason`
- `confidence`

This is a subjective recommendation, not an absolute truth.

High-risk error example: clearly necessary medical/basic-living spending being confidently labeled as `浪费`.

## A4 Daily brief

Input: DailySnapshot, remaining days, budget progress, recent change signals, LifeStatus.

Output: one short status summary + 0–1 personalized suggestion.

Forbidden:

- random finance tips unrelated to user state;
- invented changes;
- anxiety-inducing peer comparison.

## A5 Key feedback explanation

Trigger comes from deterministic rules. AI only explains the consequence in human language.

Example: rule engine provides `safe_to_spend: 1080 -> 381`; AI explains this without recomputing it.

## A6 Cycle review

Input: deterministic cycle metrics + anomaly signals + historical comparison.

Output: max 3 key insights + short explanation + next-cycle candidate suggestions.

Forbidden:

- independently calculating percentages;
- inventing trends;
- referencing unavailable facts.

## A7 LifeStatus anomaly prompt

AI/rules may detect fixed-income missing or meaningful income change, but may not declare unemployment/job change.

Flow: `detect signal -> ask user -> user confirms -> strategy changes`.

## Non-AI capabilities

Must be code/rule based:

- safe-to-spend;
- budget remaining;
- savings rate;
- financial-cycle dates;
- 消/浪/投 proportions;
- financial health score;
- achievement triggers.

## Prototype → production

Prototype: Dify for prompt/model/workflow/schema experimentation.

Production: migrate to LangGraph.js only when complexity emerges: stateful multi-step flows, conditions, tools, HITL, retries, persistent context, observability.

Do not force multi-agent design.

## Stable AI adapter surface

Recommended product-facing interfaces:

```ts
parseTransaction(input, context)
recommendNature(transaction, context)
generateDailyBrief(snapshot, context)
generateCycleReview(metrics, context)
```

UI must not call Dify directly.

## Logging

Retain minimally necessary:

- AI input or privacy-minimized representation;
- AI suggestion;
- confidence;
- user final value;
- whether user edited;
- model version;
- prompt/workflow version.

Sensitive financial content requires privacy review before long-term logging.
