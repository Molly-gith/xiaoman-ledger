# Xiaoman Project Master V0.1

> Source of truth for engineering handoff. Product truth lives in the AI Product Factory / Notion; this file is the condensed engineering-facing snapshot.

## 1. Product vision

Xiaoman is an AI personal finance management assistant built around the user's real salary cycle. It should help ordinary wage earners answer three questions:

1. How much can I still spend safely?
2. Was this spending necessary, wasteful, or an investment in the future?
3. Do I need to adjust my spending now rather than discovering the problem at month end?

Core loop:

`salary -> plan cycle money -> spend -> record -> feedback -> review -> adjust next cycle`

## 2. Web MVP P0 scope

- Financial cycle based on salary date.
- Budget planning: cycle income, planned savings, necessary reserve.
- Deterministic `safe_to_spend` calculation.
- Manual bookkeeping CRUD.
- Expense category and nature: `消费 / 浪费 / 投资`.
- Home view centered on safe-to-spend, remaining days, budget progress, nature mix.
- L1/L2/L3 feedback system.
- Daily brief settings and basic data contract.
- Cycle review and basic financial health skeleton.
- Xiaoman character appears selectively in onboarding, important feedback, review, achievements.
- AI natural-language bookkeeping prototype in parallel; must never block manual bookkeeping.

## 3. Explicitly out of scope for Web Alpha

- Automatic capture of WeChat/Alipay payments.
- Bank balance synchronization.
- Full asset/liability management.
- Family shared accounts.
- Stock/fund recommendations.
- Complex character shop.
- Forced multi-agent architecture.

## 4. Product principles

- Data is fact; deterministic rules provide correctness; AI provides understanding, explanation and suggestions.
- LLM must not calculate core financial metrics.
- User always has final control over subjective AI recommendations.
- AI failure must fall back to a complete manual path.
- The product should be quiet most of the time and obvious only at meaningful moments.
- Data is the protagonist; Xiaoman is the interpreter.

## 5. Approved G3 decision: Web Alpha data mode

**Decision B approved.**

- Web Alpha is local-first.
- From day one, UI/domain code must depend on a repository interface, never directly on `localStorage`/IndexedDB.
- Local persistence is an adapter implementation only.
- Before closed Beta, migrate to Supabase Auth + PostgreSQL + RLS + cloud persistence.
- Migration must not require rewriting domain rules or UI flows.

## 6. Safe-to-spend V0.1

Deterministic formula:

`safe_to_spend = cycle_available_income - planned_savings - necessary_reserve - actual_variable_spend`

Rules:

- No LLM calculation.
- Refunds, unpaid credit balance and committed future spend remain TBD for later versions unless engineering needs a placeholder type now.
- Calculation must be implemented as pure domain logic with unit tests.

## 7. Expense nature

Display full names in user-facing forms:

- 消费: normal necessary/reasonable living spending.
- 浪费: low-value, impulsive, duplicated or regret-heavy spending.
- 投资: spending toward future capability, health, savings or long-term value.

AI may recommend; user confirms or edits. Keep AI suggestion and final user value separately for evaluation.

## 8. AI boundary

AI capabilities planned:

- Parse natural-language bookkeeping input.
- Recommend expense category.
- Recommend `消费 / 浪费 / 投资` with reason and confidence.
- Generate daily brief from system-provided metrics.
- Explain rule-triggered feedback.
- Generate cycle review from system-provided deterministic metrics.
- Detect possible income-status change but never declare unemployment/job-change without user confirmation.

Non-AI capabilities:

- Safe-to-spend.
- Budget remaining.
- Savings rate.
- Financial cycle dates.
- Expense nature proportions.
- Financial health score.
- Achievement triggers.

## 9. AI implementation strategy

Prototype: Dify.

Production migration: LangGraph.js only when complexity justifies it, e.g. stateful multi-step workflows, conditional branches, tool calls, human-in-the-loop, retries, persistent context or observability needs.

Do not introduce multi-agent architecture only for demonstration value.

AI product interface should remain stable behind an adapter, e.g.:

- `parseTransaction(input, context)`
- `recommendNature(transaction, context)`
- `generateDailyBrief(snapshot, context)`
- `generateCycleReview(metrics, context)`

## 10. Evaluation

Initial target dataset:

- Natural-language bookkeeping: 80 cases.
- Category classification: 80 cases.
- Expense nature: 100 cases.
- Cycle review: 30 cases.

Initial target metrics (targets, not industry standards):

- Amount accuracy >= 98%.
- Income/expense type accuracy >= 98%.
- Time extraction >= 90%.
- Category top-1 >= 90%.
- Expense nature acceptable recommendation rate >= 80%.
- Obvious nature error rate <= 5%.
- Cycle review rubric >= 8/10.
- Severe factual errors in cycle review = 0.
- Deterministic financial rule tests = 100% correct for defined cases.

Any prompt/model/schema/workflow change must run regression tests. A change that improves average score but worsens P0 errors cannot ship.

## 11. Core data objects

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

For Alpha, implement only fields required by current P0 flows, but keep schemas evolvable.

## 12. UX information architecture

Bottom navigation:

`首页 | 账单 | + | 复盘 | 我的`

Home hierarchy:

1. Safe-to-spend + days until next salary.
2. Budget progress + 消费/浪费/投资 structure.
3. Xiaoman feedback + recent transactions.

Manual bookkeeping shortest path:

`amount -> category -> 消费/浪费/投资 -> save`

AI bookkeeping:

`natural language -> structured draft -> user confirm/edit -> save`

## 13. Feedback levels

- L1: silent/lightweight post-save feedback.
- L2: obvious but non-blocking card.
- L3: rare strong warning showing consequence, with user freedom to continue.

Feedback should explain consequence, not judge character.

## 14. LifeStatus

V0.1 statuses:

- stable employed
- new job / probation
- pay rise
- pay cut
- unemployed / between jobs
- unstable income
- re-employed

AI/rules may surface an anomaly, but status changes require explicit user confirmation.

## 15. Current repository reality

This is an existing repository, not a blank greenfield app. Current root includes `app/`, `lib/`, `db/`, `drizzle/`, Supabase dependency, React 19 and a `vinext`-based runtime/build setup.

Engineering must **audit before refactoring**. Do not blindly replace the existing stack just because the target architecture document mentions Next.js. Preserve working behavior where possible and propose any large migration separately.

## 16. Current project state

State: `DEV_READY`.

Next work: Sprint 1 Web Alpha foundation.

Priority order:

1. Repository audit and module boundaries.
2. Data Repository interface + local adapter.
3. Financial cycle + safe-to-spend rule engine.
4. Onboarding and first cycle setup.
5. Manual transaction CRUD + expense nature.
6. Home core status cards.
7. Dify natural-language bookkeeping prototype in parallel.
8. Eval baseline and regression harness in parallel.

## 17. Engineering change policy

- Product specs are not to be silently reinterpreted by engineering.
- If a product rule is ambiguous, create an explicit issue/question instead of inventing behavior.
- Large architecture migrations need a written proposal before implementation.
- Keep changes incremental and reviewable.
- Every Story must include acceptance criteria and tests where applicable.
