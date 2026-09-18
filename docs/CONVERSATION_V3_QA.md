# Conversation-first V3 验证记录

日期：2026-09-18。PR #17；本轮在 `67e0fd2` 上继续实现。截图使用独立测试账本，不含真实个人账目。

## 本轮修改

- 从组件中删除底部导航，移除将旧导航伪装成返回按钮的样式。
- 首页保留记账、财务看板、账户与资产、周期复盘；顶部恢复设置与备份入口。
- 聊天输入、快捷问题、AI 可用状态组成一个底部输入区；实际高度用于页面底部留白，可滚动到最后一项。
- 接入可视区域变化，键盘出现时输入框上移并收起快捷问题；输入保留，发送不虚构模型回答。
- Web / Mobile 共用结构与视觉；财务、资产、复盘保留原有信息。资产返回原入口。
- [产品参考链接](UI_REFERENCES.md) 取代 UI 作品集。

## 本地 QA

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint | 通过 |
| 单元测试 | 41 / 41 |
| 服务端渲染检查 | 2 / 2 |
| 应用构建、GitHub Pages 构建 | 通过 |
| 浏览器回归（Microsoft Edge / Chromium） | 19 / 19 |
| 模拟 AI 测试 | 3 / 3；仅检查评测流程，不代表真实模型准确率 |
| 视口 | 1440×1000、390×844、320×760、844×390 横屏 |

新增浏览器断言覆盖：DOM 无旧 tabbar、输入区固定、页面无横向溢出、末尾内容可完全滚动到输入区上方、记账弹窗、返回不遮挡标题、返回后滚动复位、设置可达、财务→资产→财务、快捷问题聚焦输入、模拟键盘可视区域缩小和恢复。

既有回归继续覆盖：增删改账目、持久化、离线重新载入、备份导入导出、过期标签页保护、迁移核对、投资投入与市值分离、70/5/25 计算。

## 截图证据

| 页面 | 手机 390px | Web 1440px |
| --- | --- | --- |
| 首页 | [截图](screenshots/v3-home-390.png) | [截图](screenshots/v3-home-1440.png) |
| 财务 | [截图](screenshots/v3-bills-390.png) | [截图](screenshots/v3-bills-1440.png) |
| 资产 | [截图](screenshots/v3-assets-390.png) | [截图](screenshots/v3-assets-1440.png) |
| 复盘 | [截图](screenshots/v3-review-390.png) | [截图](screenshots/v3-review-1440.png) |

[320px 窄屏](screenshots/conversation-320.png) · [横屏](screenshots/conversation-844.png)

## 验收与限制

Preview：https://molly-gith.github.io/xiaoman-ledger/previews/pr-17/

首次进入先建立财务周期；随后可以从首页进入四项功能。向下滚动时输入保持在底部；右上角人像进入设置，锁形按钮管理本地备份。

AI Provider 尚未接通，本轮没有真实 AI 分析和 Live Eval。手机尺寸和键盘变化经过浏览器自动化检查，尚无真实 iPhone / Android 软键盘实机证据。历史 PRODUCT.md / DESIGN.md 仍记载旧森林风格，属于已存在的旧文档；本轮 UI 以 Conversation-first 契约和真实实现为准。

PR 保持未合并，体验通过后再决定后续集成。
