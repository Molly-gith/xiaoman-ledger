# 小满 Web Beta V0.3 V6｜Technical Impact Review

## 兼容策略
当前持久化 schema 继续保持 version 3，采用“新增可选字段 + 旧字段兼容”，避免一次性破坏旧备份。

## FinancialCycle
新增可选 cycleType：
- calendar_month
- salary_based
- custom

保留 salaryDay / nextSalaryDate 作为 legacy-compatible 字段：
- calendar_month 内部 anchor=1
- salary_based 沿用 salaryDay
- custom 使用显式 start/end；nextSalaryDate 仅作为“下一周期边界日”的 legacy 字段

## BudgetPlan
继续使用 availableIncome 作为存储字段以兼容旧数据；产品文案统一为“本周期可用资金”。
新增 fundingSources[] 可选字段。

## Migration
- 缺少 cycleType 的旧周期视为 salary_based。
- 旧 profile.salaryDay 保留。
- 旧 necessaryReserve / spendKind 只保留兼容，不进入 V6 新流程。
- Backup import 必须同时接受旧 V3 与新增字段。

## Rule Engine
确定性计算仍只使用周期可用资金、投资目标和实际支出；LLM 不参与计算。

## Test Plan
- calendar month
- salary based 1–31 / 短月
- custom start/end
- fundingSources optional / sum
- legacy V3 import
- nature model safe-to-spend
- Desktop / 390 / 320 browser regression
