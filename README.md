# 小满账本

用一句话记账、查账和连续追问的财务助手。无需预先配置预算，手动记账支持消费 / 浪费 / 投资；账单可按月或自定义日期查看。

Sprint 1 的架构、验收示例、测试和已知缺口见 [交付说明](docs/SPRINT_1_DELIVERY.md)。

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm ci
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## 数据说明

- 无需登录的本机模式将账目保存在当前浏览器；换手机前请导出备份。
- 已确认邮箱的账号可以登录云端模式，账目、对话和偏好随账号保存；另一设备登录后读取，已打开页面可点重新同步。云端模式需要联网。
- 本机旧账不会自动上传。空白账号可预览后一次复制三本账目、对话与偏好，本机原件保留；有云数据时拒绝覆盖。
- CSV 导出用于 Excel、Numbers 等表格软件查看。
- 清理浏览器数据可能造成未备份的账目丢失。
- 当前已发布版本支持个人试用注册，限项目组织已授权的邮箱；Molly 可使用登录 Supabase 后台的同一邮箱。邮件返回地址已修正，但实际收件尚未验证，不能称为公开注册就绪。未配置自有邮件服务时，Supabase 默认只向组织团队成员发送邮件；公开注册仍待邮件服务方案确认，未新增付费服务或密钥。[官方邮件限制](https://supabase.com/docs/guides/auth/auth-smtp)与[账号使用步骤](docs/ACCOUNT_SYNC_GUIDE.md)。
- 小满支持文字/浏览器语音记账，生成草稿后确认保存，无需体验码。常见查账在本机完成；复杂表达会把本次文字、当前账本最近八条对话和查询条件交给 Dify 理解，不自动发送全部逐笔账目。所有金额仍由程序读取账本计算。

个人、家庭和旅行账本分别保存账目、最近四十条对话与分类偏好。刷新后可继续追问；偏好需明确确认，可在「记忆与偏好」修改、删除或备份。保存位置以「我的」显示的本机/当前账号模式为准；完整 AI 周期复盘仍在计划中。

当前交付与后续顺序见 [助手计划表](docs/XIAOMAN_AI_PLAN.md)；从一句话到查询、计算和确认保存的过程见 [Dify 中文流程指南](docs/dify/assistant-v2-workflow-guide.md)。真实模型检查与离线/模拟测试分别记录，结构合格不代表模型理解正确。旧版接入历史保留在 [AI 接入说明](docs/AI_BETA_RUNTIME.md)。

10月25日账号同步主体已通过合成账号与独立浏览器验收。功能提交 `0bb83eebe549fcfb4961d532c4453965cb929a21` 的Vercel后端为READY，CI #161和Pages #60均成功；[PR24体验页](https://molly-gith.github.io/xiaoman-ledger/previews/pr-24/#/)已提供新版脚本 `index-Dv3YUpZo.js`。发布后320px隔离浏览器检查也通过：个人试用说明、模拟注册待确认、本机合成记账和刷新后账目/对话保留；没有发送真实注册邮件。完整依据见[发布记录](docs/evidence/account-milestone-20261025.md)。

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run build:github`: 构建 GitHub Pages 静态版本
- `npm run typecheck` / `npm run lint`: 类型与代码检查
- `npm run test:browser`: 浏览器验收（先运行 `npm run build:github` 和 `npx playwright install chromium`）
- `npm run eval`: AI 评测骨架，默认未启用真实模型
- `npm run eval:question`: 问小满 20 条合成输入的离线校验；真实模型调用须另获授权并显式启用
- `npm test`: 构建并验证本地存储与发布配置
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

