# 多账本浏览器验收

2026-10-24，独立 Chrome 测试上下文完成全部 **43 项**浏览器回归：原有 34 项与新增 9 项，结果 `43 passed (46.1s)`。AI 与语音均使用模拟，不调用真实模型，不访问用户浏览器或真实账本。

## 已验证

- 个人、家庭、旅行分别保存手工收入与支出；最近账目、金额与支出性质统计互不混入。顶部在记账、账单、我的页显示当前账本，刷新保留选择。
- 顶部与本机数据面板都能真正切换账本；完整 JSON 备份包含当前本及另外两本，清空后恢复三本内容和原选择。
- v3 原有用途标签的数据迁入对应账本，不复制进另外两本，原金额与记录保留。
- AI 在三本分别生成并保存收入、支出；请求仅包含当前本的所选日期汇总，不包含其他账本、逐笔备注或账本名称。
- 切换账本清除未保存草稿；旧账本迟到的回答和草稿均不显示。另一标签页切本后，旧页面的手工保存和 AI 确认均被版本冲突保护拒绝，不会写错账本。
- 原有手工增改删、日期筛选、资产、备份、离线、语音和失败兜底全部通过。390×844、1440×1000、320×760、844×390 及模拟 410px 键盘视口通过，无保存按钮遮挡回归。

新增测试：`tests/browser/multi-ledger.spec.ts`。原始备份由 `exportLedger` 直接读取，无投影或再标准化，避免测试隐藏另外两本丢失的问题。ESLint 与 `git diff --check` 通过。

## 复现

```powershell
$env:VITE_AI_API_URL = 'https://xiaoman-ai-test.example/api/ai/assistant'
npm run build:github
$env:AI_BROWSER_TEST = '1'
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npx playwright test --reporter=line
```

发布前必须使用正式 API 配置重新构建。未设置 `AI_BROWSER_TEST=1` 时，新增 5 项 AI 隔离测试按设计跳过；新增 4 项数据与交互测试仍执行。

## 手机截图

只为等待切本提示消失并归档清晰截图，定向重跑首项测试，结果 `1 passed (4.7s)`，未重复整套回归。

- [家庭账本首页](C:/Users/Administrator/Documents/ChatGPT/Agent开发/work/xiaoman-ai-beta-evidence/multi-ledger-20261024/family-home-mobile.png)：只显示家庭收入 2,000 元、支出 20 元。
- [切换账本菜单](C:/Users/Administrator/Documents/ChatGPT/Agent开发/work/xiaoman-ai-beta-evidence/multi-ledger-20261024/switch-menu-mobile.png)：三本可选，家庭标记正在使用，清楚说明切换会清除未保存输入和草稿。

## 旧页面兼容边界

v4 使用同库 IndexedDB 版本 2 阻止旧客户端继续写入不认识的多账本数据；旧页面占用升级时会提示关闭旧页面再试。旧版备份可迁入新版，新版完整备份需用新版恢复。旧客户端保护由数据层实现与测试覆盖，本文件的浏览器证据验证新版交互和旧数据迁移，不代表旧站还能编辑 v4。
