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

## Dify 控制台最小配置

当前用于聊天验证的 `user_question -> LLM -> 输出` Workflow 只能证明模型链路可运行；接入小满真实 Eval 前，需要把 Workflow 收敛到下面这个机器可校验 contract。

### 1. Start / 用户输入

建立 3 个必填字符串变量：

- `operation`
- `payload`
- `context`

不要再以 `user_question` 作为唯一输入。Provider 会自动传入上面三个变量。

### 2. LLM

建议先保持单 LLM 节点，避免在 Baseline 前增加不必要的路由复杂度。System Prompt 可直接使用下面的最小版本：

```text
你是“小满”的结构化 AI 能力层。你的输出只作为建议，不直接修改账本。

你会收到：
- operation：本次能力类型
- payload：JSON 字符串
- context：包含 today、timezone、preferences 的 JSON 字符串

必须根据 operation 返回且只返回一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释前后缀。

operation=parseTransaction：
{
  "type": "income" | "expense",
  "amount": 正数，最多两位小数,
  "category": "非空字符串",
  "occurred_at": "YYYY-MM-DD",
  "note": "字符串",
  "nature_suggestion": "消费" | "浪费" | "投资" | null,
  "confidence": 0到1,
  "ambiguous": true | false
}
收入的 nature_suggestion 必须为 null。相对日期必须基于 context.today 和 context.timezone 解释。缺少关键信息时不要编造；降低 confidence，并把 ambiguous 设为 true。

operation=recommendNature：
{
  "recommended_nature": "消费" | "浪费" | "投资",
  "acceptable_alternative": "消费" | "浪费" | "投资"（可省略）,
  "reason": "非空字符串",
  "confidence": 0到1
}

operation=generateDailyBrief：
{
  "summary": "不超过300字",
  "suggestion": "不超过300字" | null
}
只能解释 payload 已给出的确定性财务事实，不自行重新计算金额。

operation=generateCycleReview：
{
  "insights": [最多3条非空字符串],
  "explanation": "非空字符串",
  "next_cycle_suggestions": [最多3条非空字符串]
}
只能解释 payload 已给出的确定性财务事实，不自行重新计算金额。
```

User Prompt：

```text
operation={{operation}}
payload={{payload}}
context={{context}}
```

### 3. 输出 / End

设置一个输出变量：

- 变量名：`result_json`
- 变量值：`LLM.text`

最终返回给 API 的必须是纯 JSON 字符串。如果模型前后增加说明文字或 Markdown fence，AIAdapter 会判为 `invalid_output`，该 Eval case 计失败。

### 4. 发布与运行配置

Workflow 发布后，需要在运行环境中配置以下值；**API Key 不要写进 GitHub 文件、Notion 或聊天记录**：

- `DIFY_API_BASE`：Dify Cloud 通常为 `https://api.dify.ai`
- `DIFY_API_KEY`：Workflow 的 API Key，仅放服务器环境变量 / CI Secret / 本地私密 `.env`
- `DIFY_WORKFLOW_VERSION`：人为固定的版本标识，例如 `xiaoman-dify-v0.1`
- `DIFY_MODEL_VERSION`：本次实际使用的模型标识
- `DIFY_USER_ID`：可选，默认使用 `xiaoman-eval`

配置完成后运行：

```bash
npm run eval:baseline
```

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
