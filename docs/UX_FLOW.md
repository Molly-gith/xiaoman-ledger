# 小满 UX Flow & IA V0.1

## Design principles

1. 一眼知道还能花多少钱。
2. 一句话或 2–3 秒完成记账。
3. AI 默认帮用户填，用户负责审核。
4. 平时安静，关键节点强反馈。
5. 每个财务周期都有“开始 → 执行 → 复盘 → 再开始”的仪式感。

## Main flow

`首次进入 → 设置发薪日 → 确认本周期收入 → 设置计划储蓄 → 设置必要支出预留 → 生成初始安心可花 → 首页 → 手动/AI记账 → 保存 → 更新安心可花 → 判断是否反馈 → 周期结束 → 财务健康考试 + 3个洞察 → 下一周期建议 → 用户确认 → 下一周期`

## Home hierarchy

### Level 1 — decision information

- 安心可花 ¥X
- 距下次发薪 N 天

### Level 2 — status information

- 预算进度
- 消费 / 浪费 / 投资结构

### Level 3 — support information

- 小满反馈
- 最近账目
- 查看更多

## Manual bookkeeping

Fields:

- 金额
- 消费分类：餐饮 / 交通 / 购物 / 娱乐 / 居住 / 医疗 / 学习 / 其他
- 消费性质：消费 / 浪费 / 投资
- 备注（可选）
- 日期（默认当前）
- `记好了`

Shortest path: `amount -> category -> nature -> save`.

## AI bookkeeping

Prompt: `告诉小满，你刚刚花了什么。`

AI returns an editable draft containing amount, income/expense type, category, date, note and nature suggestion.

Must provide:

- fast edit;
- `为什么这样判断？` explanation;
- manual fallback when AI fails.

## Feedback levels

- L1: Toast / lightweight state change.
- L2: Obvious but non-blocking card.
- L3: Rare strong warning + `还是要记 / 先放一放`.

## Xiaoman character rule

平时退居辅助；Onboarding、关键提醒、复盘、成就解锁时加强角色表现。

**数据是主角，小满是讲解数据的人。**

## Daily brief

首屏最多 3 组信息：安心可花、剩余天数、昨日/近期变化。

若没有值得说的个性化建议，不强行输出“小妙招”。

## Status change

若固定工资缺失：先询问状态，不自动下结论。待业状态后续可切换到“现金安全期”视角。
