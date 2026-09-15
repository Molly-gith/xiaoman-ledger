# 森林乐园体验更新 / Storybook experience update

## 中文

本次基于用户实际体验反馈，改进看不懂的支出选项、语音入口、预算初始建议，并替换整体视觉。

### 可以体验什么
- **日常花销**：吃饭、出行等，从“安心可花”扣。
- **房租等已留好的钱**：从账单预留中扣，不再扣一次安心可花。两种选择用清楚的单选卡与例子表达。
- **语音备注**：麦克风按钮、声波、正在听/停止/转换状态。授权失败、不支持、没有听清时解释下一步，手动输入始终可用。
- **工资建议**：例如工资 3,000 元，建议先存 450 元、房租账单预留 1,050 元，留给日常 1,500 元。每次新周期都计算；已手动修改的金额不自动覆盖；修改已有周期时保留原预算。
- **森林乐园**：原创种子小精灵、柔和电影光影的森林场景、统一线条图标、温暖配色。手机与桌面有独立布局，金额保持真实文字，录音动效支持减少动态效果偏好。

### 比例依据与边界
2026-09-15，Product Owner 批准小满可编辑的 **15% 储蓄 / 35% 账单 / 其余日常** 起步方案。

作者横山光昭说明的参考为 **消费 70% / 浪费 5% / 投资 25%**，其中投资含储蓄、金融投资和个人成长；并建议依据实际家庭情况调整。已核对[作者本人文章](https://media.monex.co.jp/articles/-/18319)及[作者机构发布](https://myfp.jp/?p=36162)。尚未获得本书对应原页，故不声称已经逐页核对《上班族的财务自由计划》。上述产品起步比例不等于书中原比例，35% 房租账单也不等于 70% 消费。界面提供可展开的来源说明。

### 技术验证
- 35 项自动测试（33 项规则/数据/AI适配器 + 2 项服务端/集成）。
- 10 项浏览器验收：原有记账与备份流程，新增建议更新/手动覆盖保护/新周期、语音状态与降级、离线插画。
- 类型检查、代码检查、两种发布构建。
- 独立复核发现“停止录音报错后的旧计时器会打断重试”，已修复并加入模拟失败后重试的回归验收；复核结论为该问题已解决。
- 语音测试使用浏览器接口替身，不表示已测真实麦克风识别准确率。实际可用性依赖浏览器、麦克风授权与网络；浏览器语音服务可能在线处理音频。
- 原有账本格式不变。插画加入离线缓存；公开静态资源忽略不影响内容的 Origin 缓存差异，修复离线模块加载问题。

### 已知范围
本版不接入云端账本或真实 AI 工作流。无需为换肤迁移或清空账本。现有服务端依赖安全整改仍属于服务器/Beta 前的待办。

## English

This iteration responds to direct product feedback with clearer expense allocation, recognizable voice input, editable salary-based defaults, and an original cinematic forest identity.

- Everyday expenses reduce safe-to-spend; bills use the money previously reserved. Radio choices explain both with examples.
- Voice notes have microphone, waveform, recording/stop/processing states and actionable fallback messages. Manual entry remains available.
- New cycles suggest 15% savings, 35% bills, and the remainder for everyday spending. Manually edited amounts and existing budgets are preserved unless the user explicitly reapplies suggestions.
- An original seed companion and forest artwork carry the storybook style across mobile/desktop layouts. Financial figures remain accessible text; reduced-motion preferences are honored.

The Product Owner approved the 15/35 preset on 2026-09-15. It is a product starting point, not a direct book quotation. Yokoyama's verified 70/5/25 expense-nature framework includes savings and self-development under investment. The exact book pages have not been verified. Sources are linked above and exposed in the form.

Validation: 35 automated tests, 10 browser acceptance scenarios, typecheck, lint, and vinext/Pages builds. Voice tests use a browser API substitute and do not establish real microphone/transcription accuracy. Browser support, permission and network remain relevant. Artwork is cached offline; the existing ledger format is preserved. Cloud storage, live AI workflows and server/Beta dependency remediation remain outside this release.
