# 问小满私人体验接入 / Private Ask Xiaoman integration

## 当前成果 / What is implemented

在 V6 `6d5b139` 上增量接入「问小满」。保留原来的周期规则、本机账本与 GitHub Pages 网站；仅复用 PR #13/#15 的 AI 契约和 Dify 调用层，不合入旧分支的界面和周期代码。

The change adds Ask Xiaoman on top of V6 `6d5b139`. It reuses the AI contract/provider from PRs #13/#15 without importing their older UI or financial-cycle implementation.

链路 / Flow:

`GitHub Pages → POST /api/ai/question (Vercel Node Function) → Dify Cloud workflow → validated answer`

本次只接入「问小满」`answerFinancialQuestion`；AI 记账、AI 周期复盘尚未开放。金额继续由现有规则计算；AI 没有写账、改周期、改性质或交易接口。摘要含本周期金额、消费结构和投资汇总，不含逐笔记录、备注、账户名称。每个问题独立回答，不上传历史聊天，也不提供跨周期比较数据。

Only Ask Xiaoman (`answerFinancialQuestion`) is integrated. AI bookkeeping and AI cycle reviews are not enabled. Existing rules calculate money. AI has no ledger mutation or trading API. Payloads contain aggregates, not transaction rows, notes, account names, chat history, or prior-period comparisons.

## 真实验证记录 / Live verification record

截至 2026-10-10，已完成真实 HTTP 调用与独立 AI 语义复核。下表的通过数是本批合成用例的复核结果，不是模型总体准确率，也不代表用户验收或 Beta 已就绪。原始响应与复核报告分开保留，原始报告中的 `pending_review` 不会被覆盖。

| 工作流版本 | 实际测试范围 | AI 语义复核 | 主要结果与证据 |
| --- | --- | --- | --- |
| v0.1 | 完整 20 条合成 Smoke | 18 / 20 | 01 混淆剩余可支出与消费上限，09 错误排除投资转账。[原始报告](dify/question-smoke-live-v0.1-20261010.json) / [复核](dify/question-smoke-review-v0.1-20261010.json) |
| v0.2 | 完整 20 条合成 Smoke | 18 / 20 | 01、09 本轮修复；07、19 仍建议未支持的产品操作。06 的缺失引用检查过严，回答的目标与缺口足以回应题意，并非金额错误。[原始报告](dify/question-smoke-live-v0.2-20261010.json) / [复核](dify/question-smoke-review-v0.2-20261010.json) |
| v0.3 | 01 / 07 / 09 / 19，共 4 条重点回归 | 3 / 4 | 19 仍把“本次摘要没有历史数据”说成“整个账本没有历史记录”；01、07 另有措辞建议。[原始报告](dify/question-targeted-v03-20261010.json) / [复核](dify/question-targeted-review-v03-20261010.json) |

**v0.4 最终网页联调：用例 19 通过独立 AI 语义复核。** 2026-10-10 约 01:09 HKT，在隔离的临时浏览器存储中打开 [PR #24 Preview](https://molly-gith.github.io/xiaoman-ledger/previews/pr-24/)（前端 `d5ed4aee`），用全虚构账本主动同意并发送一次，页面完整显示“本次收到的摘要没有上个周期的数据，暂时无法比较变化。”，无建议列表或错误；输入清空、加载结束，剩余可支出仍为 7500、账目仍为空。Dify #4 / Vercel 配置标签为 `xiaoman-question-v0.4`（后端代码 `0f5ead8`）；未捕获原始网络响应，不断言精确 HTTP 状态或响应版本字段。[实测记录](dify/browser-check-v0.4-20261010.json) / [同意弹窗](dify/web-ai-consent-v04.png) / [最终回答](dify/web-ai-answer-v04.png)。追加 25 次授权额度已用完；这是单条网页端到端验证，不是用户验收，最新版尚未完成完整 20 条回归或 180 条评测。

早期 [Studio 试跑](dify/studio-trial-record.json) 共 6 次、3 类场景，保留为历史过程证据。180 条完整真实模型评测尚未运行；不能将不同版本的通过项拼成最新版完整通过。

Two complete 20-case live runs each received 18 semantic passes. The v0.3 targeted run received 3 passes out of 4. These are independent AI reviews of synthetic cases, not general model accuracy or user acceptance. See the v0.4 status line above for the final browser-to-model check. The 180-case live evaluation remains unrun.

## 用户如何使用 / User experience

首次发送问题时，用户查看说明、填写私人体验码、主动勾选同意，再点击「同意并发送」。没有默认上传；随后也只在点击发送时上传。体验码与同意状态仅留在当前页面内存，刷新或「关闭 AI」即失效。关闭 AI 会取消当前客户端请求；已到达 Dify 的运行可能继续结束。Dify 和模型供应商可能保留调用记录，界面会说明。网络、模型、校验或限流失败都保留问题，手动记账继续可用。

Before the first request, the user explicitly consents and enters a private beta access code. Consent and the code remain in memory only. Refreshing or disabling AI clears them. Disabling AI aborts the client request; an already submitted Dify run may still complete. The consent notice explains provider-side logs. Failure preserves the question and never blocks manual bookkeeping.

## 部署与维护 / Deployment and maintenance

独立 Vercel 项目与真实 Dify 接口已用于上述合成测试；最终网页联调状态见上方单独记录。下面是复现与维护步骤，实际部署记录同时保存在 [PR #24](https://github.com/Molly-gith/xiaoman-ledger/pull/24)。密钥由用户在对应平台私密配置，不在聊天中发送。

The separate Vercel project and live Dify API were used for the synthetic runs above. The final browser integration result is recorded separately. The steps below document reproduction and maintenance; PR #24 retains deployment evidence. Secrets belong only in the relevant platform's private settings, never in chat.

1. 使用已创建的独立 `xiaoman-ai-beta` Vercel 项目，项目根目录为本仓库，使用 `vercel.json`（Framework: Other / null）。构建只产生简短说明页与 `api/ai/question.ts`，不迁移 Pages 网站。Node.js 22 或更新受支持的 LTS。
2. 先可无密钥部署。来源允许列表为空或请求来源不匹配时，接口先返回 `403 origin_denied`；已配置匹配的来源且收到 POST 请求，但仍缺少密钥时，返回 `503 not_configured`。确认目标与部署产物后，由用户在该项目私密环境变量中配置 `DIFY_API_KEY`、`AI_BETA_TOKEN`（Secret）。体验码使用密码学随机生成的至少 32 字符值，只分发给本人/明确邀请的体验者，不放构建变量、仓库或 URL。
3. Config 变量为 `AI_ALLOWED_ORIGINS=https://molly-gith.github.io`、`DIFY_MODEL_VERSION=deepseek-v4-pro`，以及与实际已发布 Prompt 一致的 `DIFY_WORKFLOW_VERSION`。例如只有 v0.4 发布后才能标记 `xiaoman-question-v0.4`，不能只修改标签。完整无密钥配置模板见 `.env.ai.example`；其中版本示例需替换成当次实际版本。
4. 在该项目配置 **唯一一条** `@vercel/firewall` 限流规则，Rate limit ID 为 `xiaoman-question`，固定窗口 60 秒、6 次、超限 429。代码使用固定私人体验键，所有授权请求共享该地区计数。核对并发布后实测限流；不存在规则、返回错误或 1.5 秒超时均阻止模型调用。启用系统环境变量自动暴露：生产环境使用 `VERCEL_PROJECT_PRODUCTION_URL` 查询限流，只要生产主域公开可达，就不需要额外的保护绕过 Secret；主域缺失或格式不合法时关闭调用，不回退到受保护的部署地址。预览环境使用 `VERCEL_URL`，按官方要求启用自动化保护绕过，相关 Secret 仅限后端。Pages 的跨域调用不能携带 Vercel 登录页，公开可达的私人体验 API 由自身体验码鉴权；不能把部署保护绕过 Secret 放进网页。
5. 导入或保留 `docs/dify/xiaoman-finance-assistant.yml` 的工作流，确认 DeepSeek 模型配置和额度。输入为三个字符串 `operation`、`payload`、`context`，输出为 `result_json`，使用 blocking API。工作流发布后再创建/使用该应用专属 API Key，放入 Vercel Secret。发布前重新查看同目录 Prompt、Schema 与试跑记录。
6. 用虚构账本验证鉴权、同意、数值回答、未知值、拒绝荐股、失败兜底、限流及浏览器到模型的完整链路。[PR #25](https://github.com/Molly-gith/xiaoman-ledger/pull/25) 已将组合发布流程合入 `main`（`8570b2e`）：该工作流仅为 PR #24 的构建环境直接设置 `VITE_AI_API_URL=https://xiaoman-ai-beta.vercel.app/api/ai/question`，不依赖仓库变量；主站与 PR #23 构建时该值为空。这个公开地址不含密钥。使用此正式发布流程，不恢复已删除的临时分支拼接脚本。
7. 保留历次 Smoke、重点回归与网页联调结果；v0.4 尚未重跑完整 20 条，180 条真实模型评测仍未运行。追加 25 次授权额度已用完，后续模型调用需另获授权。对外多用户 Beta 前仍需按项目既有决策完成用户身份与云账本方案；当前体验码仅用于私人验证，AI 记账和 AI 周期复盘不在本次启用范围。

Deployment uses the separate Vercel project with this repository root and `vercel.json`. Missing secrets intentionally leave AI disabled. Server-only Secrets, metadata and origin Config values accompany a single `xiaoman-question` Firewall SDK rule (6 requests / 60 seconds). Expose system environment variables. Production checks use `VERCEL_PROJECT_PRODUCTION_URL` and need no additional bypass Secret when that domain is public; missing or invalid host configuration fails closed. Preview function checks use `VERCEL_URL` and require server-only Protection Bypass for Automation. Workflow labels must match the published prompt. The PR #25 Pages workflow directly sets the fixed public API URL only for PR #24, without repository variables; the main site and PR #23 receive an empty value. Final browser verification, the 180-case live evaluation and the existing pre-Beta identity/storage requirements remain separate gates.

## 验证与边界 / Verification and limits

- `npm run typecheck -- --incremental false`、`npm run lint`、`npm run test:unit`、`npm run test:ai`。
- 问小满 Smoke 的离线输入校验：`npm run eval:question`，检查 20 条合成用例，不读取密钥或调用模型。`npm run test:unit` 同时运行执行器的 13 条离线行为测试，覆盖限次、间隔、错误停机、脱敏与语义待审状态；CI 不执行线上模型调用。
- 线上 Smoke 需明确授权，并显式使用 `--live --report`（完整用法：`npm run eval:question -- --help`）。结构与事实引用检查通过后，仍须逐条独立复核自然语言结论、口径和安全边界；当前留存的是 AI 语义复核，不等同用户验收。`pending_review` 不能当作语义通过或 Beta 就绪。
- 默认模式：`npm test`、`npm run build:github`、`npm run test:browser`。
- AI 界面模拟：构建时设 `VITE_AI_API_URL=https://xiaoman-ai-test.example/api/ai/question`；运行时设 `AI_BROWSER_TEST=1` 后执行 `npm run test:browser -- tests/browser/ai-question.spec.ts`。所有网络回包是虚构测试数据，不调用真实模型。
- 输入限 16 KiB、问题限 500 字符、只接收确定的摘要字段；响应限 32 KiB，验证 JSON、字段、长度、置信度和事实引用。后端模型超时 25 秒，前端 30 秒，Function 35 秒。不自动重试付费请求。
- 应用代码不记录问题、财务摘要、Authorization 或 Provider 错误正文；响应 `Cache-Control: no-store`。禁止将 Dify provider 导入客户端，构建产物应检查无 Dify 调用地址或密钥。
- 类型/引用校验不能证明自然语言正文绝无错误。真实语义质量依赖 Prompt 与正式评测，不能将模拟通过数称为模型准确率。
- Vercel 限流按地区计数，是滥用保护而非绝对全局费用上限。Dify/模型余额和 Vercel 用量仍需设合适上限与告警；本实现不需要额外数据库。
- Vercel 官方说明所有套餐支持固定窗口限流；Hobby 每项目 1 条规则，本实现只需 1 条。实际账户额度与计费应在部署前确认。

Tests cover contract, privacy, auth, bounds, limiter failure, provider failure and browser consent/revocation. Mock pass counts are not live model accuracy. Reference validation cannot guarantee prose correctness. Regional rate limits are abuse protection, not a hard global spend cap. No additional database is required.

官方依据 / Primary references: [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js), [Firewall SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk), [Deployment Protection](https://vercel.com/docs/deployment-protection#how-to-migrate-to-standard-protection), [System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_project_production_url), [Rate-limiting availability](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Dify Workflow API](https://docs.dify.ai/en/api-reference/workflow-runs/run-workflow).
