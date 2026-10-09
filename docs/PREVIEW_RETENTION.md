# Preview 保留修复 / Preview retention fix

旧预览工作流每次只上传 main 与当次 PR，导致新的预览覆盖之前已验收的 PR23。修复后的默认分支工作流每次组合以下内容：

The old workflow uploaded only main plus the triggering PR, removing the accepted PR23 preview. The default-branch workflow now composes:

- 当前 main 根站，不接入 AI。发布前检查 main SHA，若构建期间 main 更新则停止，避免覆盖新版主站。
- 固定已验收 PR23：`6d5b139f0e11e14b76a0abcc06fb515920af4b68`，不接入 AI。
- PR24：取同仓库 `codex/xiaoman-ai-beta` 分支、`Sprint validation` 工作流 `358468136`、`pull_request` 事件最近一次成功运行的 `head_sha`。仅此预览注入公开 AI API 地址，不包含密钥。
- 其他当次通过验证的同仓库 PR，沿用独立预览路径且不接入 AI。

- Current main at the public root, with AI disabled. A final main-SHA check stops publication if main changed while building.
- Accepted PR23 pinned to `6d5b139f0e11e14b76a0abcc06fb515920af4b68`, with AI disabled.
- PR24 pinned to the `head_sha` of the latest successful same-repository `pull_request` run of workflow `358468136` on `codex/xiaoman-ai-beta`. Only this preview receives the public AI endpoint; no credentials enter the build.
- Any other current validated same-repository PR keeps its temporary preview path with AI disabled.

PR23 与 PR24 会在后续其他 PR 的预览发布中保留；其他临时 PR 仍只保留当次版本。找不到合格的 PR24 成功检查时，工作流停止，避免以缺少 AI 预览的产物覆盖现有站点。旧检查重跑不会将 PR24 回滚到更新成功检查之前的版本。

PR23 and PR24 survive later preview releases for other PRs. Other temporary previews remain limited to the triggering PR. A missing qualifying PR24 run stops publication instead of deleting the retained AI preview. Rerunning an older validation cannot displace a newer successful PR24 run.

## 合并后恢复 / Restore after merging

本修复不修改 GitHub Pages 环境保护：发布仍从 `main` 运行。合并本 PR 后，既有根站发布仍可能暂时覆盖所有预览。等待该发布结束，在 `main` 手动运行 **Deploy validated PR preview**（`deploy-pr-preview.yml`，无输入参数）即可恢复根站、PR23 与 PR24 组合。此操作应在已获发布授权后执行。

The GitHub Pages environment policy stays unchanged: deployment still runs from `main`. Merging this fix can trigger the existing root-only deployment, temporarily removing previews. After it finishes, manually dispatch **Deploy validated PR preview** (`deploy-pr-preview.yml`) on `main`, with no inputs, to restore the combined root, PR23 and PR24. Dispatch only after publication is authorized.

根站发布与预览发布共用 `pages` 并发组，避免相互竞态。根站工作流本身未重构：以后新的 main 发布仍需要随后运行预览工作流来恢复预览。这一限制与“其他 PR 预览不会删除 PR23/24”是两件事。

Root and preview workflows share the `pages` concurrency group to prevent racing deployments. The root workflow itself is unchanged: later main releases still require a subsequent preview workflow run to restore previews. This is separate from retaining PR23/24 during other PR preview releases.

验证：`node --test tests/preview-plan.test.mjs` 覆盖运行 SHA、同仓库/分支/PR 校验、成功条件、旧运行重跑及固定 PR23 保留。工作流也会在构建前运行这些无外部依赖的测试。

Validation: `node --test tests/preview-plan.test.mjs` covers run-SHA selection, repository/branch/PR checks, successful-run requirements, old reruns and fixed PR23 retention. The workflow runs these dependency-free checks before building.
