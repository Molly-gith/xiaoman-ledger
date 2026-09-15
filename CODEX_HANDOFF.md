# Codex Handoff — Xiaoman Web Alpha Sprint 1

## Mission

Implement the first Web Alpha sprint without changing product intent. Start from the existing repository and evolve it incrementally.

Read first, in order:

1. `XIAOMAN_PROJECT_MASTER.md`
2. `docs/PRD.md`
3. `docs/UX_FLOW.md`
4. `docs/AI_SPEC.md`
5. `docs/EVAL_SPEC.md`
6. `docs/TECH_DESIGN.md`
7. `docs/DECISIONS.md`

## Non-negotiable product rules

- Alpha is local-first.
- Storage must sit behind a repository interface; UI/domain code must not directly depend on browser storage.
- Before closed Beta, storage will migrate to Supabase Auth + PostgreSQL + RLS.
- Deterministic financial calculations must not be delegated to LLMs.
- Manual bookkeeping must remain fully usable when AI is unavailable.
- `消费 / 浪费 / 投资` is a user-confirmed value; AI may only recommend.
- LifeStatus changes require user confirmation.
- Do not add automatic payment capture in this sprint.
- Do not add stock/fund recommendations.

## First task: repository audit

Before modifying implementation, inspect the current repository and produce a short engineering note in the PR description covering:

- current runtime/build system;
- existing state/data flow;
- current Supabase/Drizzle usage;
- current transaction model;
- current tests;
- what can be reused;
- what must be refactored;
- whether a monorepo migration is necessary now or should wait.

Do **not** perform a large stack migration during this audit.

## Sprint 1 target

Deliver the non-AI financial loop first:

1. Repository contract + local persistence adapter.
2. Domain models for FinancialCycle, BudgetPlan and Transaction.
3. Pure rule functions for salary-cycle dates and safe-to-spend.
4. Onboarding / first financial cycle setup.
5. Manual transaction CRUD.
6. User-facing expense nature: 消费 / 浪费 / 投资.
7. Home core state: safe-to-spend, days remaining, budget progress, nature mix, recent transactions.
8. Unit tests for deterministic rules.

AI work may proceed behind adapters, but must not delay this loop.

## Recommended implementation boundaries

Use the existing repo conventions where sensible. The desired conceptual boundaries are:

- `domain`: pure financial types and calculations; no React/browser/storage/AI dependencies.
- `data`: repository contracts and adapters.
- `ai`: AI client/adapters and schemas; no direct UI dependency.
- `app/ui`: presentation and interaction.
- `eval`: test sets and evaluation runner.

If current folders differ, adapt incrementally rather than moving everything at once.

## Suggested contracts

```ts
interface LedgerRepository {
  getProfile(): Promise<UserProfile | null>
  saveProfile(profile: UserProfile): Promise<void>
  getActiveCycle(): Promise<FinancialCycle | null>
  saveCycle(cycle: FinancialCycle): Promise<void>
  listTransactions(cycleId: string): Promise<Transaction[]>
  saveTransaction(tx: Transaction): Promise<void>
  updateTransaction(tx: Transaction): Promise<void>
  deleteTransaction(id: string): Promise<void>
}
```

The exact API may change after repo audit, but the separation principle must remain.

## Rule-engine acceptance examples

For defined V0.1 inputs:

`safeToSpend = availableIncome - plannedSavings - necessaryReserve - actualVariableSpend`

Tests should cover at least:

- normal cycle;
- cycle crossing calendar month;
- zero income;
- zero planned savings;
- budget edited after creation;
- transaction add/edit/delete recalculation;
- negative safe-to-spend result;
- salary day near month end.

## UX acceptance

- First-time setup should lead directly to the first safe-to-spend result.
- Home's primary visual answer is “还能安心花多少”.
- Manual bookkeeping shortest path is amount → category → expense nature → save.
- AI must not be required to complete a transaction.
- Core pages: 首页 / 账单 / + / 复盘 / 我的.

## AI integration rule

Do not couple UI to Dify directly. Use an AI adapter interface so the provider/workflow can later move to LangGraph.js without changing product-facing contracts.

## Definition of Done for Sprint 1 foundation

- Existing app still builds.
- Core deterministic tests pass.
- No UI code directly reads/writes local storage for core financial data.
- First financial cycle can be created.
- Manual transactions can be added, edited and deleted.
- Safe-to-spend updates correctly after transaction changes.
- Home surfaces the required P0 state.
- No secret keys committed.
- PR description includes repo audit, architecture decisions, tests run, known gaps and screenshots when UI changes are included.

## Escalation rule

If implementation requires changing a product rule, stop and raise it as a decision question. Do not silently make product decisions in code.
