# 私人 AI Preview 组合发布 / Private AI preview composition

本分支新增一个明确选择的 `preview-compose` 发布模式。一次 Pages 产物包含以下三个站点；只有 PR24 接入公开 AI API 地址，密钥与体验码均不进入构建。

This branch adds an explicit `preview-compose` mode. One Pages artifact contains three sites; only PR24 receives the public AI API URL. Neither credentials nor the private beta code enter the build.

| URL path | Source | AI API |
| --- | --- | --- |
| `/xiaoman-ledger/` | verified main `c667b9a58da70ce6c91ea4cd9e4a34c072878b95` | empty |
| `/xiaoman-ledger/previews/pr-23/` | accepted V6 `6d5b139f0e11e14b76a0abcc06fb515920af4b68` | empty |
| `/xiaoman-ledger/previews/pr-24/` | explicit validated PR24 SHA, matching the dispatched branch HEAD | `https://xiaoman-ai-beta.vercel.app/api/ai/question` |

## 发布步骤 / Release steps

1. 完成本轮提交及真实 AI 验收，确认最终 SHA 的 Sprint validation 通过；等待它触发的旧自动 Preview 工作流结束。发布前重新核对 main 仍为表中固定 SHA。
2. 在已获授权后，调用既有 `deploy-pages.yml` 的 `workflow_dispatch`，`ref` 为 `codex/xiaoman-ai-beta`，`inputs.mode` 为 `preview-compose`，`inputs.preview_sha` 为该分支最终通过验证的完整 SHA。分支在校验与调用之间若更新，工作流拒绝构建。
3. 等待构建与部署成功。逐个检查根站、PR23、PR24 的首页、JS 与样式均为 HTTP 200；PR24 显示私人 AI 入口，PR23 仍保持原版。

1. Finish the release commits and live AI acceptance. Require successful Sprint validation at the final SHA, and wait for the old automatic preview run it triggers to finish. Recheck that main still matches the pinned SHA above.
2. Once publication is authorized, dispatch the existing `deploy-pages.yml` at `ref: codex/xiaoman-ai-beta` with `mode: preview-compose` and `preview_sha: <full validated SHA>`. The workflow rejects a SHA different from the dispatched branch HEAD.
3. Require a successful deployment, then check the root, PR23 and PR24 entry pages and assets return HTTP 200. Confirm the private AI entry appears only in PR24.

构建会检查每个站点的资源路径，缺少任一版本、旧版本意外带入 AI 地址或 PR24 未带入地址都会失败，不上传残缺站点。选错分支或在 PR 分支选择 `root` 不会发布根站。

The composer validates all three asset bases and AI configuration before creating output. A missing site, AI enabled in a retained site, or an absent PR24 endpoint blocks the artifact. Selecting `root` on the PR branch cannot publish the root site.

## 当前限制 / Current limitation

默认分支现有 `deploy-pr-preview.yml` 在每次 PR 的 Sprint validation 通过后，只发布 main 与当次 PR，会覆盖其他预览。本次组合工作流没有修改默认分支，因此必须最后执行；后续再推送 PR 或部署 main，仍可能需要再次组合发布。永久修复需要单独审核默认分支的发布工作流。不要声称本变更已永久解决预览保留。

The existing default-branch `deploy-pr-preview.yml` publishes only main plus the most recently validated PR, replacing other previews. This change does not modify that default-branch workflow. Run composition last; later PR pushes or main deployments may require composing again. Permanent retention requires a separately reviewed change to the default-branch workflows.

GitHub 官方支持在既有手动工作流上指定分支 `ref`，不要求先合并本分支。需要仓库写入/Actions 写入权限；运行使用原有 Pages 与 OIDC 权限，不增加平台密钥。

GitHub supports selecting a branch `ref` for an existing manual workflow without merging this branch first. Dispatch requires repository/Actions write access; the run uses existing Pages and OIDC permissions, with no additional platform credential.

Sources: [Manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [Workflow dispatch REST API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
