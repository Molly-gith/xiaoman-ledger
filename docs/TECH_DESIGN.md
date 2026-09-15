# 小满 Technical Design V0.1

## Architecture goal

Web Alpha should stay simple while preserving reusable core logic for future App and WeChat mini-program clients. Deterministic financial rules and AI capabilities remain separate.

## Current repository reality

The existing repo is already implemented and currently includes:

- React 19;
- a `vinext` runtime/build path rather than a blank conventional Next.js app;
- `app/`, `lib/`, `db/`, `drizzle/` directories;
- `@supabase/supabase-js`;
- Drizzle ORM;
- existing tests and GitHub build scripts.

Therefore Sprint 1 starts with an audit. Do not perform a broad stack migration before understanding the current code.

## Target conceptual layers

```text
UI / app
   |
Application / service layer
   |----------------------|
Domain Core              AI Adapter
   |                      |
Repository Contract      Dify prototype
   |                      |
Local Adapter            LangGraph.js later, if justified
```

## Approved data strategy

Web Alpha: local-first.

- Define repository contracts from day one.
- Local browser persistence is one adapter only.
- UI must not directly use storage primitives for core finance state.
- Before closed Beta: add Supabase Auth + PostgreSQL + RLS and migrate persistence behind the same contracts.

## Domain Core

Must be independent from UI, browser storage and LLM providers.

Primary concepts:

- FinancialCycle
- BudgetPlan
- Transaction
- SafeToSpend
- FinancialHealth
- Achievement

Core formulas live here, not inside page components.

## AI Adapter

Stable interfaces should hide Dify/LangGraph implementation details:

```ts
parseTransaction(input, context)
recommendNature(transaction, context)
generateDailyBrief(snapshot, context)
generateCycleReview(metrics, context)
```

Client UI must never need to know which AI provider/workflow is underneath.

## Data objects V0.1

- User
- LifeStatus
- FinancialCycle
- BudgetPlan
- Transaction
- DailySnapshot
- CycleReview
- Achievement
- AIRecommendationLog
- FeedbackEvent

Alpha should implement only fields required by P0 flows.

## Security baseline

- No API keys committed or exposed client-side.
- Client does not call LLM/Dify secrets directly.
- AI logs are minimized.
- Before Beta cloud launch, Supabase RLS is mandatory.
- Before Beta cloud launch, user data export/delete path is required.

## Dify → LangGraph.js migration trigger

Migrate only when the product actually needs one or more of:

- multi-step persistent state;
- meaningful conditional branching;
- tool calling;
- human-in-the-loop checkpoints;
- retries/recovery;
- long-lived context;
- stronger workflow observability.

Do not use multi-agent architecture for presentation value alone.

## Web → App → Mini Program

Business/domain rules, shared schemas and backend/AI contracts should be reusable.

Long-term client direction:

- Web: experiment + deeper analysis.
- App: primary daily client; later Expo / React Native candidate.
- WeChat mini-program: lightweight entry point, not a complete App clone.

## Sprint 1 engineering order

1. Audit current repo.
2. Establish domain/data/AI boundaries with minimal disruptive refactor.
3. Add Repository contract and local adapter.
4. Implement cycle and safe-to-spend pure rules + tests.
5. Implement onboarding/first cycle.
6. Implement manual transaction CRUD.
7. Implement home P0 state.
8. Add Dify prototype behind AI adapter.
9. Add eval harness.

## Open technical decisions

- Exact local persistence technology: localStorage vs IndexedDB or existing repo mechanism, to be decided after audit.
- Whether a monorepo restructure is warranted now or deferred.
- Exact Dify model/provider after baseline and cost test.
- When LangGraph.js becomes justified.
