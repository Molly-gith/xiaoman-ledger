# 问小满私人体验接入 / Private Ask Xiaoman integration

## 当前成果 / What is implemented

在 V6 `6d5b139` 上增量接入「问小满」。保留原来的周期规则、本机账本与 GitHub Pages 网站；仅复用 PR #13/#15 的 AI 契约和 Dify 调用层，不合入旧分支的界面和周期代码。

The change adds Ask Xiaoman on top of V6 `6d5b139`. It reuses the AI contract/provider from PRs #13/#15 without importing their older UI or financial-cycle implementation.

链路 / Flow:

`GitHub Pages → POST /api/ai/question (Vercel Node Function) → Dify Cloud workflow → validated answer`

只开放 `answerFinancialQuestion`。金额继续由现有规则计算；AI 没有写账、改周期、改性质或交易接口。摘要含本周期金额、消费结构和投资汇总，不含逐笔记录、备注、账户名称。每个问题独立回答，不上传历史聊天。

Only `answerFinancialQuestion` is exposed. Existing rules calculate money. AI has no ledger mutation or trading API. Payloads contain aggregates, not transaction rows, notes, account names, or chat history.

## 用户如何使用 / User experience

首次发送问题时，用户查看说明、填写私人体验码、主动勾选同意，再点击「同意并发送」。没有默认上传；随后也只在点击发送时上传。体验码与同意状态仅留在当前页面内存，刷新或「关闭 AI」即失效。关闭 AI 会取消当前客户端请求；已到达 Dify 的运行可能继续结束。Dify 和模型供应商可能保留调用记录，界面会说明。网络、模型、校验或限流失败都保留问题，手动记账继续可用。

Before the first request, the user explicitly consents and enters a private beta access code. Consent and the code remain in memory only. Refreshing or disabling AI clears them. Disabling AI aborts the client request; an already submitted Dify run may still complete. The consent notice explains provider-side logs. Failure preserves the question and never blocks manual bookkeeping.

## 部署准备 / Deployment preparation

代码已准备，但未部署、未发布 Dify、未配置任何真实密钥。用户当前选择保留 Dify 草稿，并自行配置密钥。下面是后续接入步骤；密钥只在对应平台私密输入，不在聊天中发送。

The code is prepared but is not deployed or connected to live secrets. The user has chosen to keep Dify as a draft and configure secrets personally. The steps below describe future integration. Secrets belong only in the relevant platform's private settings, never in chat.

1. 在现有 Vercel 账号中创建独立 `xiaoman-ai-beta` 项目，项目根目录为本仓库，使用 `vercel.json`（Framework: Other / null）。构建只产生简短说明页与 `api/ai/question.ts`，不迁移 Pages 网站。Node.js 22 或更新受支持的 LTS。
2. 先可无密钥部署。来源允许列表为空或请求来源不匹配时，接口先返回 `403 origin_denied`；已配置匹配的来源且收到 POST 请求，但仍缺少密钥时，返回 `503 not_configured`。确认目标与部署产物后，由用户在该项目私密环境变量中配置 `DIFY_API_KEY`、`AI_BETA_TOKEN`（Secret）。体验码使用密码学随机生成的至少 32 字符值，只分发给本人/明确邀请的体验者，不放构建变量、仓库或 URL。
3. Config 变量为 `AI_ALLOWED_ORIGINS=https://molly-gith.github.io`、`DIFY_MODEL_VERSION=deepseek-v4-pro`、`DIFY_WORKFLOW_VERSION=xiaoman-question-v0.1`。更新实际模型或 Prompt 时同步修改版本标签。完整无密钥示例见 `.env.ai.example`。
4. 在该项目配置 **唯一一条** `@vercel/firewall` 限流规则，Rate limit ID 为 `xiaoman-question`，固定窗口 60 秒、6 次、超限 429。代码使用固定私人体验键，所有授权请求共享该地区计数。核对并发布后实测限流；不存在规则、返回错误或 1.5 秒超时均阻止模型调用。预览部署按官方要求启用自动化保护绕过与系统环境变量，相关绕过 Secret 仅限后端。Pages 的跨域调用不能携带 Vercel 登录页，公开可达的私人体验 API 由自身体验码鉴权；不能把部署保护绕过 Secret 放进网页。
5. 导入或保留 `docs/dify/xiaoman-finance-assistant.yml` 的工作流，确认 DeepSeek 模型配置和额度。输入为三个字符串 `operation`、`payload`、`context`，输出为 `result_json`，使用 blocking API。工作流发布后再创建/使用该应用专属 API Key，放入 Vercel Secret。发布前重新查看同目录 Prompt、Schema 与试跑记录。
6. 用虚构账本在真实 API 验收：鉴权、同意、数值回答、未知值、拒绝荐股、失败兜底、限流。通过后将完整接口地址 `https://<verified-host>/api/ai/question` 写入 GitHub Actions **变量** `VITE_AI_API_URL` 并重新构建 Pages；该变量不含密钥。PR Preview 工作流如由其他分支维护，也要明确传入此变量。
7. 继续完成正式 20 条 Smoke、失败用例修正与 180 条评测。当前 3 类场景不是正式完整基线。对外多用户 Beta 前仍需按项目既有决策完成用户身份与云账本方案；当前体验码仅用于私人验证。

Deployment uses a separate Vercel project with this repository root and `vercel.json`. Deploying without secrets intentionally leaves AI disabled. Configure server-only Secrets, metadata and origin Config values, then a single `xiaoman-question` Firewall SDK rule (6 requests / 60 seconds). Confirm Dify is published and verify synthetic requests before adding the public API URL to the Pages build. Keep deployment-bypass credentials server-only. Formal smoke/full evaluation and the existing pre-Beta identity/storage requirements remain outstanding.

## 验证与边界 / Verification and limits

- `npm run typecheck -- --incremental false`、`npm run lint`、`npm run test:unit`、`npm run test:ai`。
- 默认模式：`npm test`、`npm run build:github`、`npm run test:browser`。
- AI 界面模拟：构建时设 `VITE_AI_API_URL=https://xiaoman-ai-test.example/api/ai/question`；运行时设 `AI_BROWSER_TEST=1` 后执行 `npm run test:browser -- tests/browser/ai-question.spec.ts`。所有网络回包是虚构测试数据，不调用真实模型。
- 输入限 16 KiB、问题限 500 字符、只接收确定的摘要字段；响应限 32 KiB，验证 JSON、字段、长度、置信度和事实引用。后端模型超时 25 秒，前端 30 秒，Function 35 秒。不自动重试付费请求。
- 应用代码不记录问题、财务摘要、Authorization 或 Provider 错误正文；响应 `Cache-Control: no-store`。禁止将 Dify provider 导入客户端，构建产物应检查无 Dify 调用地址或密钥。
- 类型/引用校验不能证明自然语言正文绝无错误。真实语义质量依赖 Prompt 与正式评测，不能将模拟通过数称为模型准确率。
- Vercel 限流按地区计数，是滥用保护而非绝对全局费用上限。Dify/模型余额和 Vercel 用量仍需设合适上限与告警；本实现不需要额外数据库。
- Vercel 官方说明所有套餐支持固定窗口限流；Hobby 每项目 1 条规则，本实现只需 1 条。实际账户额度与计费应在部署前确认。

Tests cover contract, privacy, auth, bounds, limiter failure, provider failure and browser consent/revocation. Mock pass counts are not live model accuracy. Reference validation cannot guarantee prose correctness. Regional rate limits are abuse protection, not a hard global spend cap. No additional database is required.

官方依据 / Primary references: [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js), [Firewall SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk), [Rate-limiting availability](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Dify Workflow API](https://docs.dify.ai/en/api-reference/workflow-runs/run-workflow).
