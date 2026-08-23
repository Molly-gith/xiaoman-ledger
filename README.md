# 小满账本

一个适合手机使用的本地优先记账应用。无需注册即可用文字或语音记账，并按日、周、月、年查看收支、预算与存款目标。

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
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
- `npm test`: 构建并验证本地存储与发布配置
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

