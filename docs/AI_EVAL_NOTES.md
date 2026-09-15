# Sprint 1 AI adapter and evaluation boundary

## Delivered

- `lib/ai/adapter.ts` provides the four product-facing operations without a Dify/LangGraph dependency. The default adapter is disabled and makes no requests.
- Providers return untrusted values. Runtime checks cover amount, type, real calendar date, confidence, nature labels, daily-brief shape and review insight count. Network failures, malformed output and timeouts become explicit manual fallbacks. Parsing preserves the original text exactly.
- All successful outputs are suggestions requiring review; low confidence and provider-reported ambiguity add explicit confirmation reasons. There is no save operation or path to a final user-confirmed nature in the adapter.
- Financial facts enter as already computed metrics. This module performs no financial calculations and has no repository access.
- No input or output is persisted or logged. A real provider must keep credentials server-side, honor cancellation, and define privacy-minimized retention before long-term logging.

## Running checks

```sh
node --test tests/ai-adapter.test.mjs
node evals/run-smoke.mjs
node evals/run-smoke.mjs --fixture-provider
```

The default evaluation reports **three skipped cases, zero evaluated, accuracy null**. The fixture provider echoes expected outputs to check harness plumbing. Its passing result says nothing about model accuracy. Fixture runs contain no network requests or real financial records.

## Limits and decisions before AI activation

- This is a non-blocking foundation, not a live Dify prototype or an AI accuracy baseline. Manual ledger work does not depend on it. The adapter is not connected to UI in this sprint.
- Three synthetic smoke fixtures are not the approved approximately 290-case corpus. Category-only cases, ambiguous/multiple amounts, refunds, broad date cases, subjective multi-label cases and the full review rubric still require reviewed datasets.
- The harness reports field mismatches, obvious nature errors, order-of-magnitude errors and income/expense reversals. It blocks P0 regressions; it never grants automatic release approval from this skeleton.
- Schema validity cannot prove factual correctness or detect every ambiguity. User review remains required even at high confidence. Future review evaluation must check supplied facts, fabricated claims, tone and useful advice manually or with an independently validated rubric.
- The draft uses yuan with two decimal places and a local `YYYY-MM-DD` date. It must be explicitly mapped into a user-confirmed domain transaction later; AI nature suggestions must remain separate from the user's final choice.
- A temporary confidence threshold of 0.8 is configurable plumbing, not an approved product confidence policy. Product Owner must approve provider/model, confidence UX, retention/privacy and labeled datasets before activation. Existing refund rules remain unresolved; a refund is not silently added as a new financial rule here.
