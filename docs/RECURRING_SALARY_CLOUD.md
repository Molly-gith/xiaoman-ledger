# 自动工资：云端调度合同与发布检查

## 当前状态（2026-10-27）

- 只读确认项目 `ossuymtantsctyhtwnyw` 的 PostgreSQL 为 17.6；`pg_cron` 默认版本 1.6.4 可用，但尚未启用，`cron.job` 不存在。
- 已准备 [私有函数迁移](../supabase/migrations/20261027014643_xiaoman_recurring_salary.sql) 与 [合成回滚测试](../tests/recurring-salary.sql)。迁移不安装扩展、不建立定时任务、不处理账户数据。
- 云端回滚测试尝试被自动审批拦截，尚未执行，不能把 SQL 草案称为线上已验证或已上线。实际被拦的是一个包含 `CREATE SCHEMA/FUNCTION`、权限语句和合成 `auth.users`/资源插入的事务，即使末尾 `ROLLBACK`，审查器仍要求可信用户授权覆盖远端 DDL。没有换通道重试；只读复核 `xiaoman_private` schema、worker 和 `cron.job` 均仍不存在。
- 0 云端 DDL 执行、0 真实 payload 读取、Cron 未启用。账号和本机模式目前都只在打开或回到网页时补记。
- 另经批准在忽略目录 `work/pg-verify` 安装临时 `@electric-sql/pglite@0.5.12`，不改项目依赖/锁文件、不创建服务。纯本地 PostgreSQL 18.6 / PL/pgSQL 验证：**59 条 SQL 断言通过，108 组 JS/SQL 差分一致**；回滚后私有 schema、合成用户和资源均不存在。证据为 `work/pg-verify/results.json` 与 `work/pg-verify/run.mjs`。本地通过不等于生产 PostgreSQL 17.6 或 Cron 已验证；PGlite 单连接不能实证双连接锁竞争。

## 对用户的行为

**当前本机和账号模式均需下次打开或回到网页补记。以下描述后台获批、验证并启用后的预期：**账号账本可在网页关闭后由服务器处理；本机模式仍需下次打开网页。只有明确开启“自动记工资”的账本生效，旧薪资预算不会自动添加收入。

统一按 `Asia/Hong_Kong` 的日期判断发薪日，浏览器对应 `recurringSalaryToday()`；建议定时任务每小时运行一次，因此正常云端处理可能晚于当天零点，不能承诺秒级或银行实际到账确认。自动收入备注始终说明“请核对实际到账”。预算计算依日期自然进入新期间；Cron 不改预算比例或新增旧 cycle。

## 持久化合同

每本 `SalaryBudgetSettings.autoIncome` 为可选对象：

```ts
{ enabled: boolean; startDate: string; lastProcessedMonth: string | null }
```

需同时满足 `salaryBudget.enabled` 与 `autoIncome.enabled`、发薪日 1–31、预计工资大于 0。月份用 `YYYY-MM`，日期用 `YYYY-MM-DD`，支持 1900–9998。启用或重启从当天起，保留已处理月份；更改配置前由客户端先按旧配置处理已到期月份。

- 从起算月与水位下一月中较晚者开始，逐月处理到今天；31 日在短月取月末。
- 当月发薪日在启用日之前也推进水位，但不补收入，防止后来改发薪日时回补用户未启用的月份。
- 每本确定性记录 ID 为 `salary-auto-YYYY-MM`；`autoSalary={month,scheduledDate}` 保留原计划月份。账本之间可使用相同 ID，账户和账本相互隔离。
- 同月已有自动标记、确定性 ID 或明确“工资/薪资/薪水/薪酬/salary/payroll/paycheck”的收入时不重复添加，但推进水位。普通同额收入、工资卡转入、否定“不是工资”不当作工资。
- 删除或编辑自动记录不倒退水位，因此不会自动重生。移动到别月的自动工资不作为该别月的手记工资。
- 金额取 `expectedSalary`，预算的 `periodOverride` 及金额/比例分配不影响自动收入。
- 超过每本 5000 笔或遇到无效配置时，整次账户资源转换失败；没有部分账本、收入或水位写入。worker 对该账户保持原样，并继续其他账户。
- 新增时按日期降序排序，原来同日记录顺序保持；仅推进水位时不重排账目。

旧带明确时区的时间戳按可落入月份的 UTC 窗口保守防重（月首减 14 小时，到下月首加 12 小时，右开区间），兼容没有秒的 ISO 时间。**无时区的旧手记工资时间戳由设备本地时间决定，云端会停止该账户本次处理并报匿名失败计数，不猜测 UTC；用户需在网页确认该条日期。**普通已确定日期不受影响。

## 权限与并发

函数全部位于不公开的 `xiaoman_private`，使用 `SECURITY INVOKER`、空 `search_path`，撤销 `PUBLIC` / `anon` / `authenticated` 的 schema 和函数权限。没有新增浏览器 RPC 或服务密钥。Cron 连接用数据库管理角色执行。

worker 只筛选明确开启的 `ledger` 资源，按用户 ID 顺序 `FOR UPDATE SKIP LOCKED`；当前被网页更新锁住的资源留到下一轮处理。三个账本在同一资源内转换，并一次提交 `revision + 1` 与 `payload.revision + 1`，继续经过现有资源 trigger。旧网页带旧 revision 的保存会被 CAS 拒绝，不会覆盖调度添加的工资。`owner_filter` 仅供私有测试限定临时账号；正式调度不传此参数。

不读取或处理助手记忆资源。日志仅允许资源计数，不输出账户 ID、金额、账目正文或 SQLERRM。部分坏数据会以 `XIAOMAN_SALARY_RESOURCES_FAILED` 警告计数出现；Cron 作业成功状态本身不代表每个资源都处理成功，需同时看该匿名警告。进程异常或项目暂停会延后执行，恢复后按水位补记。

## 审查后执行顺序

1. 一次集中获得对“远端合成回滚测试 → 通过后持久化迁移并启用 Cron”的授权。先执行一个事务：`BEGIN`、迁移文本、测试文本（去除其第二个 `BEGIN`）、最终 `ROLLBACK`。所有 worker 调用必须传测试内刚生成的 UUID；不得取消过滤或把真实账户加入测试。
2. 通过后检查 schema/worker 仍不存在，确认回滚；检查测试计数与错误路径，不只看 SQL 请求成功。
3. 前两步通过且上述授权覆盖后，用 `apply_migration` 持久化私有函数；检查函数权限和安全建议。
4. 在支持新字段的网页上线后，按同一次授权启用下面的任务。不会自动替既有账本开启 `autoIncome`；若验证失败，先修复，不带失败结果启动后台。

```sql
create extension if not exists pg_cron;
select cron.schedule(
  'xiaoman-recurring-salary-hourly',
  '5 * * * *',
  $$set statement_timeout = '5min'; select xiaoman_private.process_recurring_salaries();$$
);
```

以上为待审查示例，**尚未执行**。任务每小时第 5 分钟运行；函数内转换为香港日期，无需改数据库全局时区。暂停使用 `cron.alter_job(job_id, active := false)`；删除使用 `cron.unschedule('xiaoman-recurring-salary-hourly')`，不得卸载扩展来暂停单个任务。不要直接修改 `cron.job`。

检查调度只需读取该任务的 `jobname/schedule/active` 与运行状态、开始/结束时间；无需读取用户 payload。`cron.job_run_details` 默认不会自动清理；规模目前为一天 24 次，需要后续按现有维护策略保留有限天数，不在本次顺带清理别的任务日志。

## 官方依据

- [Supabase Cron](https://supabase.com/docs/guides/cron)：数据库内运行 SQL/函数；建议单次任务不超过 10 分钟。
- [Cron 安装](https://supabase.com/docs/guides/cron/install)与[快速开始](https://supabase.com/docs/guides/cron/quickstart)：启用扩展、schedule/alter/unschedule 和运行日志行为。
- [2026-07-22 扩展版本规则](https://supabase.com/changelog/extension-version-pinning-ignored)：不在迁移硬编码扩展版本，使用项目提供的默认版本。
- [Cron 表写入限制](https://supabase.com/changelog/19298-directly-updating-rows-in-the-cron-job-table-is-no-longer-allowed)：任务通过 Cron 函数管理。
- [pg_cron](https://github.com/citusdata/pg_cron)：同一任务只运行一个实例；仍以资源锁与 CAS 防止网页并发覆盖。
- [PGlite 本地内存模式](https://pglite.dev/docs/)与[多语句 exec API](https://pglite.dev/docs/api)：用于本地验证，不连接 Supabase。
