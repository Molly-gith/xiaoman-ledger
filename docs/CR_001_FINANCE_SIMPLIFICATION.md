# CR-001｜财务结构简化

## Status

Product Owner approved. Implementation in progress.

## Supersedes

This change supersedes the **expense-allocation** portion of D-013 and the 2026-09-15 `15% savings / 35% bills / remainder everyday` starter preset for **new or explicitly migrated cycles**.

Old cycles remain readable and keep their previous calculation until the user explicitly adjusts the cycle or starts a new one.

## Product decision

1. MVP no longer asks users to pre-plan a `necessary reserve` for rent/bills.
2. Bookkeeping no longer asks `日常花销 / 房租等已留好的钱` or any equivalent spend-source question.
3. Rent, utilities, insurance and similar expenses are recorded normally when they happen.
4. Default structure becomes:
   - 消费 ≈ 70% — reference, not a quota to consume.
   - 浪费 ≤ 5% — ceiling, not spendable allowance.
   - 投资 ≥ 25% — protected target for savings, long-term assets, learning, health, etc.
5. MVP headline is **本周期可支出** rather than the stronger promise **安心可花**.

## Deterministic formula for new cycles

`periodSpendable = income - consumptionSpend - wasteSpend - max(investmentTarget, investmentSpend)`

This guarantees:

- the uncompleted part of the investment target stays protected;
- actual investment above target is still reflected;
- investment is not double-deducted as both target and actual expense.

LLMs may explain or recommend but must not calculate this value.

## Compatibility strategy

`BudgetPlan.model` distinguishes:

- `legacy`: existing behavior, including old reserve/spend-kind semantics;
- `nature`: CR-001 behavior.

Old saved plans without `model` normalize to `legacy`. New cycle setup saves `model="nature"`, keeps `necessaryReserve=0`, and retains legacy fields only for storage compatibility. `spendKind` remains readable but is no longer user-facing; new/edited expenses receive a compatibility default internally.

## UX contract

New user flow:

`发薪日 + 收入 → 看到 70/5/25 起步结构 → 开始周期`

Bookkeeping:

`金额 → 分类 → 消费性质 → 备注/日期（按需）→ 保存`

No internal money-bucket concept is shown.

## Future AI behavior

Recurring expenses are learned from real history and proposed back to the user. AI must not silently create fixed obligations or budgets.
