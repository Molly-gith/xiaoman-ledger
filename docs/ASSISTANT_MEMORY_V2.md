# 助手记忆 v2

## 保留与隔离

本次去掉本机和云端追加对话时的 `slice(-40)`。读、导出、导入及“复制本机数据到账户”保留现存的完整历史，分别按当前身份与个人、家庭、旅行三本账本隔离。过去已经被旧版截断的消息无法由此次升级恢复。

每本仍有独立 revision；同一 revision 的并发写入只允许一份成功，另一份提示重新载入。没有内存假保存、自动覆盖或自动重试。账号切换前后的身份校验及服务器 `expected_user_id` 不变。

## 数据合同

`MemoryState.version = 2`，新增完整的 `companion`：

```ts
{
  tone: "gentle" | "playful" | "plain"; // 默认 playful
  remindersEnabled: boolean;             // 默认 true
  dailyExpenseTarget: number | null;      // 元，默认 null，允许 0
  lunchReference: number | null;          // 元，默认 null，填写时须大于 0
  mutedUntil: string | null;              // YYYY-MM-DD，默认 null
}
```

金额最多两位小数；日期接受既有 1900–9998 年范围。`setCompanionPreferences(owner, kind, preferences, expectedRevision)` 接收完整配置，遵守与会话相同的 CAS。配置不代表登录认证或真实账户余额。

助手消息可带 `reminderId`（字母、数字、冒号、下划线、连字符，最多 200 字符）以及 `replyTo`（既有消息 ID 格式）。提醒使用日期间的下划线，不使用斜杠。保存这两个字段不代表重新执行历史提醒或草稿。

`clearConversation` 和 `clearOwnerConversations` 清除会话及待补问内容，保留分类规则和陪伴配置；`clearOwner` 清除所有助手记忆并恢复陪伴默认值，不操作账目。完整账本 JSON 与助手记忆备份仍分开。

## 容量与兼容

- 消息没有条数上限；单条原有 2000 字符限制保留。
- 每本客户端写入检查 UTF-8 字节，采用带空白的 JSON 计数和 1,950,000 字节上限，为云端实际 JSONB 2,000,000 字节限制预留空间。
- 容量不足时整次写入失败，保留原有历史并提示先导出、整理；不会删除旧消息腾空间。读取和导出不受写入容量检查阻拦。
- 三本完整备份上限为 7,000,000 字节，能够容纳三本各接近上限的内容。导入仍逐本验证并在一个事务中替换，不导入外来身份和 revision。
- 旧版 v1 本机数据、云端内容和备份无损读取，并补上默认陪伴配置。新备份为 v2。
- 本机 IndexedDB 使用原数据库与 store，版本升至 2。旧版 `open(..., 1)` 会拒绝；升级被仍打开的旧页面阻塞时提示关闭旧页面。失败请求的迟到连接会关闭。
- 云端新 payload 明确标记 v2。增量触发器允许尚未升级的旧内容继续使用，但拒绝把已经升级的资源降回旧格式，避免旧客户端以 40 条内容覆盖完整历史。

## 迁移与验证

迁移文件：`supabase/migrations/20261027083459_xiaoman_memory_v2.sql`。它只替换现有资源校验触发器的记忆分支，保留 ledger、revision/CAS 和权限设置。部署时先应用服务器迁移，再发布 v2 客户端；不要回退已有 v2 数据为旧格式。

2026-10-27：增量迁移已应用到现有 Supabase 项目；远端 27 条虚拟账户断言通过并整批回滚，没有读取真实账本。迁移后安全检查没有新增告警。以下本地检查也已通过：

- `tests/assistant-memory.test.mjs`：21 项；包含超过 40 条保留、旧 IDB 无损升级、旧版写入拒绝、阻塞恢复、容量、三本备份、清理与偏好。
- `tests/cloud-storage.test.mjs`：22 项；包含云端完整历史、陪伴隔离、失败不写、并发 CAS、导入和清理。
- `tests/cloud-migration.test.mjs`：11 项；包含 180 条跨三本历史及陪伴配置的一次原子迁入。
- 全仓 TypeScript 检查及上述数据/测试文件 ESLint 通过。
- 本地 PGlite 0.5.12 / PostgreSQL 18.6：新增 `tests/assistant-memory-v2.sql` 27 项、原账号/RLS/CAS SQL 34 项、自动工资 SQL 59 项均通过。每套合成账号/资源均回滚为零。
- 字节边界实测：319 条各 2000 个中文字，客户端计数 1,947,933 字节；PostgreSQL JSONB 实际 1,942,168 字节。再追加一整条被客户端拒绝。

本地执行文件为忽略目录中的 `work/pg-verify/memory-v2.mjs`，结果为 `work/pg-verify/memory-v2-results.json`。本地验证零远端连接、零远端 DDL、零真实用户数据读取；它不证明生产 PostgreSQL 17.6 已应用，也不模拟双连接锁竞争。
