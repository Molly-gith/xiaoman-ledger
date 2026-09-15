# 小满账本

一个围绕工资周期的本地优先记账应用。设置发薪日、可用收入、计划储蓄和必要预留，即可查看“安心可花”；手动记账支持消费 / 浪费 / 投资，语音可辅助填写备注。

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

- 账目保存在当前浏览器的 IndexedDB 中，无法被其他设备自动读取。
- 换手机前请在“本机数据与备份”中导出 JSON 文件；新设备可导入恢复。
- CSV 导出用于 Excel、Numbers 等表格软件查看。
- 清理浏览器数据可能造成未备份的账目丢失。
- Supabase 相关文件暂时保留，供后续可选云同步版本使用；第一版不会上传账目。

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run build:github`: 构建 GitHub Pages 静态版本
- `npm run typecheck` / `npm run lint`: 类型与代码检查
- `npm run test:browser`: 浏览器验收（先运行 `npm run build:github` 和 `npx playwright install chromium`）
- `npm run eval`: AI 评测骨架，默认未启用真实模型
- `npm test`: 构建并验证本地存储与发布配置
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

