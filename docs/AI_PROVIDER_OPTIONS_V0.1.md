# 小满 AI Provider 方案 V0.1

## 目的

小满的 AI 能力不绑定某一个可视化工作流工具。产品层只依赖 `AIProvider` 接口，模型输出仍必须经过 `AIAdapter` 校验、用户确认后才能写账。

这意味着：

- Dify 可以继续作为可视化 Prototype / 教学工具；
- 正式研发与 Eval 可以直接走“代码原生 Provider”，不要求 Product Owner 手工拖节点；
- Prompt、JSON Contract、版本号都进入 GitHub，通过 PR + CI 管理；
- 更换模型供应商不改变账本 Domain Rule。

## 推荐默认路径：代码原生 OpenAI-compatible Provider

适用于 OpenAI、DeepSeek 以及其它兼容 Chat Completions 协议的模型端点。

运行时只需要一次性配置服务器环境变量：

- `AI_PROVIDER=openai-compatible`
- `AI_API_BASE`：例如供应商的兼容 API 根路径
- `AI_API_KEY`：仅放服务器 / CI Secret / 本地私密 `.env`
- `AI_MODEL`：模型 id
- `AI_WORKFLOW_VERSION`：代码 Prompt / Orchestration 版本，例如 `xiaoman-code-v0.1`
- `AI_MODEL_VERSION`：可选；缺省时使用 `AI_MODEL`

随后直接运行：

```bash
npm run eval:baseline
```

优点：

1. 不需要在 Dify 控制台手工改 Workflow；
2. Prompt / Schema / Fallback 都可由 Dev/Codex 在仓库内维护；
3. 所有变更可审查、可回滚、可自动测试；
4. Eval 使用同一 Provider 接口，不改变 80-case 数据集与评分逻辑。

## Dify 路径

如果后续仍希望保留可视化 Workflow，可继续使用：

- `AI_PROVIDER=dify`（或不设置，当前兼容默认）
- `DIFY_API_BASE`
- `DIFY_API_KEY`
- `DIFY_WORKFLOW_VERSION`
- `DIFY_MODEL_VERSION`

Dify 不是必须依赖，而是一个可替换 Provider。

## Product Owner 需要理解什么

只需要掌握三件事：

1. **输入**：用户问题 / 已计算好的财务事实；
2. **AI 做什么**：理解、分类、解释、生成结构化建议；
3. **安全边界**：AI 不直接写账、不负责确定性金额计算，低置信与非法输出回退人工。

具体 API、Prompt 拼装、请求重试、JSON 解析、Eval 运行由 AI Workflow Engineer / Dev 承担。

## 当前 Gate

真实 Baseline 仍需要一个真实模型 API Key；但不再要求 Molly 手工维护 Dify Workflow。拿到任一支持的服务端模型凭证后，即可运行同一套 80-case Baseline。
