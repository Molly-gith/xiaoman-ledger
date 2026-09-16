# 小满 Dify + Eval 执行说明 V0.1

## 本轮目标

把已有的 provider-neutral AI Adapter 变成一个**可替换、可验证、失败不影响手动记账**的 Dify 接入骨架，并建立第一批可复现 Eval 数据。

本文件不声称真实模型已经达到上线指标。没有真实 Dify Workflow 与凭证时，系统必须明确停在“未跑真实 Baseline”，而不是用 mock 结果冒充模型效果。

## 架构边界

`用户输入 -> DifyProvider -> AIAdapter schema validation -> 用户确认 -> 账本写入`

- DifyProvider 只负责调用 Workflow。
- AIAdapter 负责严格校验 JSON、超时和失败回退。
- AI 输出永远是 suggestion，不直接写账。
- 金额、预算、财务周期等确定性计算仍由 Domain Rule 完成。
- 没有 Provider 或 Provider 不可用时，恢复原始输入并回到手动路径。

## Dify Workflow Contract

服务器端调用：`POST {DIFY_API_BASE}/v1/workflows/run`

请求 inputs：

- `operation`: `parseTransaction | recommendNature | generateDailyBrief | generateCycleReview`
- `payload`: operation 输入的 JSON 字符串
- `context`: `{ today, timezone, preferences? }` 的 JSON 字符串

推荐 Workflow 输出：

- `data.outputs.result_json`: 符合对应 AIAdapter schema 的 JSON 字符串。

Prototype 迁移阶段也兼容 `result` / `output`，后续应收敛为单一 `result_json`。

## 环境变量

必须只配置在服务器或 CI Secret 中，不得提交到 GitHub：

- `DIFY_API_BASE`
- `DIFY_API_KEY`
- `DIFY_WORKFLOW_VERSION`
- `DIFY_MODEL_VERSION`
- `DIFY_USER_ID`（可选）

## 第一批 Eval 数据

`evals/baseline-cases.mjs` 当前包含 80 条种子用例：

- 自然语言记账：30 条
- 分类重点样本：20 条
- 消费 / 浪费 / 投资：30 条

其中消浪投允许多个合理答案，例如“长期使用的健身房年卡”可以接受 `投资` 或 `消费`，避免为了方便评分强行制造唯一答案。

这 80 条是第一批 seed set，不替代 `EVAL_SPEC.md` 中后续完整数据集目标。

## 如何跑真实 Baseline

配置环境变量后执行：

```bash
npm run eval:baseline
```

输出包含：

- evaluated / skipped
- passed / failed
- accuracy
- P0 数量与 P0 rate
- 每条 case 的失败字段、severity、model/workflow version

若缺少真实 Provider 配置，命令会输出 `missing_live_provider_config` 并退出，不产生虚假的准确率。

## 当前 Gate

代码级完成条件：

- Provider 请求契约有自动测试；
- API key 不进入浏览器代码或错误文案；
- 80 条数据集结构有自动测试；
- 手动 fallback 保持不变；
- repository CI 全绿。

模型级完成条件仍需要真实 Dify：

1. 跑第一版 Baseline；
2. 按 P0/P1/P2 看 Bad Case；
3. 固化 model/workflow version；
4. 建立 Regression Set；
5. 达到 `EVAL_SPEC.md` 的风险门槛后才讨论 Beta。
