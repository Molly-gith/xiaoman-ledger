# 小满 V0.3 Live Eval

这套 Runner 用于验证「问小满」真实 Provider，**不会**把 API Key 写入仓库，也不会在未配置真实 Provider 时伪造模型准确率。

## 两层评测

1. `npm run eval`：本地 fixture/schema/regression Gate，不调用真实模型。
2. `npm run eval:live -- --limit=20`：真实 Provider contract smoke；默认只跑 20 条，控制成本。
3. `npm run eval:live -- --full`：运行 V0.3 全部 180 条 Question cases。

Live report 自动记录 `model_version`、`workflow_version`、contract pass/fail 与 required fact coverage。`forbiddenBehavior` 仍保留为显式语义审核项；在这层审核完成前，不把 contract pass rate 宣称为产品准确率或 Beta readiness。

## OpenAI-compatible 私密运行环境

只在私密 Server / CI Secret 环境配置：

```text
XIAOMAN_AI_PROVIDER=openai-compatible
XIAOMAN_AI_BASE_URL=https://<provider>/v1
XIAOMAN_AI_API_KEY=<secret>
XIAOMAN_AI_MODEL=<model-id>
XIAOMAN_AI_MODEL_VERSION=<optional-stable-version>
XIAOMAN_AI_WORKFLOW_VERSION=xiaoman-v0.3-question-v1
XIAOMAN_AI_TIMEOUT_MS=30000
```

运行：

```bash
npm run eval:live -- --limit=20
npm run eval:live -- --full
```

## Dify 私密运行环境

Dify 保留为可视化 Prototype / 学习适配，不是生产唯一依赖：

```text
XIAOMAN_AI_PROVIDER=dify
XIAOMAN_DIFY_BASE_URL=https://api.dify.ai
XIAOMAN_DIFY_API_KEY=<secret>
XIAOMAN_DIFY_MODEL_VERSION=<model-version>
XIAOMAN_DIFY_WORKFLOW_VERSION=<workflow-version>
XIAOMAN_DIFY_USER_ID=xiaoman-live-eval
```

## 失败原则

- 缺少 Provider 或 Secret：Runner 以非零状态退出，不生成 Baseline。
- Provider 返回不符合 contract 的 JSON：记为 contract failure。
- `referenced_facts` 引用快照外事实：Adapter 直接判无效。
- 财务阶段没有确定性 `financial_stage:*` fact 时，不允许模型自行给出确定阶段。
- 具体证券/基金买卖指令、收益保证、自动交易属于安全边界；语义审核未完成时不得宣称上线。
