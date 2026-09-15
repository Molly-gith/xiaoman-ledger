# Xiaoman Decision Log V0.1

## D-001 — Core product loop

**Decision**: Xiaoman is not only a bookkeeping app. The core loop is salary → plan → spend → feedback → review → next-cycle adjustment.

**Why**: The product opportunity is managing money during the cycle, not only reporting where money went afterward.

## D-002 — Web before native App

**Decision**: Validate the product on Web first, then build native/mobile App, then a lightweight WeChat mini-program.

**Why**: The main product risk is whether safe-to-spend, expense nature and feedback are useful, not native-device capability.

## D-003 — Manual bookkeeping remains first-class

**Decision**: Manual bookkeeping is mandatory even after AI bookkeeping exists.

**Why**: AI must improve efficiency, not become a dependency that blocks core tasks.

## D-004 — Expense nature wording

**Decision**: User-facing labels are written in full: `消费 / 浪费 / 投资`.

**Why**: Single-character labels create unnecessary learning cost and `投` can be mistaken for securities investing.

## D-005 — AI vs deterministic rules

**Decision**: Core finance math uses deterministic code; AI handles understanding, explanation, recommendation and personalization.

**Why**: Financial calculations require reproducibility and auditability.

## D-006 — Expense nature is recommendation, not verdict

**Decision**: AI may recommend `消费 / 浪费 / 投资`; the user has final control.

**Why**: The classification is partially subjective and context-dependent.

## D-007 — LifeStatus confirmation

**Decision**: Missing salary or meaningful income change may trigger a question, but the system may not automatically declare unemployment, job change or pay change.

**Why**: The signal is ambiguous and the user must confirm personal state.

## D-008 — Daily brief

**Decision**: A daily/regular brief may combine spending progress with finance guidance, but guidance should be based on current personal state whenever possible and should not degrade into random finance tips.

## D-009 — Xiaoman character

**Decision**: Xiaoman is one core character, not a character-selection system. Future animal/sport/holiday elements are variations of Xiaoman.

**Why**: A single core IP creates stronger brand consistency.

## D-010 — G3 Web Alpha data strategy

**Status**: Approved by Product Owner.

**Decision**: Web Alpha is local-first. From day one, persistence must be isolated behind a Repository/Data Adapter. Before closed Beta, migrate to Supabase Auth + PostgreSQL + RLS.

**Why**: Validate the product loop faster without creating long-term storage coupling.

## D-011 — Dify and LangGraph roles

**Decision**: Dify is the rapid AI prototype/evaluation environment. LangGraph.js is introduced only when production workflow complexity justifies it.

**Why**: Avoid premature orchestration complexity and forced multi-agent architecture.

## D-012 — Engineering authority boundary

**Decision**: Engineering may propose product changes but may not silently reinterpret approved product rules.

**Why**: Product truth and implementation decisions must remain traceable. Ambiguity is escalated through explicit decisions.

## D-013 — Alpha salary and spending semantics

**Status**: Product Owner explicitly approved in the implementation task on 2026-09-15: “采用这组 Alpha 规则”.

- Salary days 29–31 clamp to the month's last day when necessary. Each following month uses the originally selected salary day again.
- Available cycle income is explicitly confirmed in the budget. Income transactions are records only and do not increase safe-to-spend automatically, avoiding double-counted salary.
- Expense allocation is separate from subjective nature: variable spending reduces safe-to-spend; spending from necessary reserve uses an amount already deducted in the budget and is not deducted twice.

## D-014 — Sprint 1 implementation boundaries

**Engineering decision**: Keep React/vinext, Pages entry, IndexedDB database/store/key, visual system and backup flows. No monorepo, Drizzle migration or live Supabase changes.

- Domain arithmetic uses integer fen; persisted amounts remain yuan for compatibility. Salary rules use date-only strings and UTC calendar arithmetic; the UI determines today's local date.
- A versioned repository snapshot contains profile, cycles, budgets, transactions and preserved legacy preferences. A future cloud adapter implements the same operations. Mutations validate data and commit before updating UI; revisions reject stale writers.
- Legacy records retain unknown nature/allocation/cycle until user confirmation. Relevant unassigned expenses suppress the safe-to-spend headline, avoiding an overstated balance. Migration does not erase presumed sample records.
- Reserve allocation cannot exceed the confirmed reserve: the form retains the entry and asks the user to adjust the reserve or split the excess into variable spending. No silent reallocation. Automatic split behavior remains a future product decision.
- A new cycle requires explicit income/budget confirmation; old records and cycles remain. Changing the next salary day cannot create overlapping periods.
- AI remains disabled by default; adapter/eval plumbing does not imply a measured model baseline.
# 2026-09-15 · 工资起步建议 / Salary starter preset

用户批准：每个新周期输入到手工资后，建议计划储蓄 15%、房租账单预留 35%、其余用于日常；全部可改。按分取整，日常为余数。用户修改过的字段不随工资自动覆盖；已有周期保留原预算，只有显式点击重填建议才更新。此为小满产品建议，非书中原比例。消费性质的 70/5/25 参考不参与安心可花公式。

User approved: every new cycle suggests 15% savings and 35% bills from take-home income; everyday money is the integer-fen remainder. Preserve edited fields and existing cycle budgets; explicit reapply can reset them. This is a product preset, not the book's ratio. The 70/5/25 expense-nature reference does not change safe-to-spend calculations.
