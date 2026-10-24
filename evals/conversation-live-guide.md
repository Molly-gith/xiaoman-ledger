# V2 发布后合成验证

脚本默认离线。只有确认 Dify 和 Vercel 已发布，且本轮额度允许时才执行 `--live`；不得为重跑自动增加调用预算。

```sh
node --experimental-strip-types evals/run-conversation-live.mjs
node --experimental-strip-types evals/run-conversation-live.mjs --live --report conversation-live-20261024.json
```

固定调用公开生产 `/api/ai/assistant`，Origin 为 `https://molly-gith.github.io`。不读环境密钥、体验码、账户或真实账本，不发送伪造 IP。选取既有合成案例 11 条 V2 加 1 条旧 `assistLedger`，最多 12 次；每次响应后至少等 11 秒，单次 30 秒超时，首次失败停止，无重试。补问后的 30 元使用上一条真实返回的问题。

覆盖混合三笔、跨年日期、缺金额与补充、月份分类查询、等长区间比较、家庭账本追问、改问收入、待确认偏好、历史注入、自有账户划转和旧接口兼容。固定输入日期是合成场景日期，不假装是执行当天。

报告写入 `work/xiaoman-ai-beta-evidence/`，同名报告不会覆盖；首个请求前先保存计划，每次调用后立即落盘。各条报告分开记录：

- `input`、`expected`：实际发送的虚构输入和人工预期。
- `httpStatus`、`transport`：HTTP、来源允许和不缓存检查。
- `output`、`structural`：合法公开返回值及结构检查；不是 Dify 节点原始输出。
- `automatedSemantic`：精确金额、日期、分类、性质、查询条件和偏好检查。
- `semanticReview`：始终初始为 `pending`，保留逐条题意与禁止行为清单，等待独立复核。
- `status`：自动检查通过只记 `checks_passed_pending_semantic_review`，不宣称用户验收通过。

这是 27 条样例中的代表性子集，也不验证浏览器交互、本地实际保存或跨账本存储。超时可能已经产生一次模型费用；保留已有报告，再决定剩余预算的用途。
