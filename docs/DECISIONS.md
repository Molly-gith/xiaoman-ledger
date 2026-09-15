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
