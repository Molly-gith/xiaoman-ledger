# 账号同步与本机数据复制验收

2026-10-25，香港时间。账号隔离与同步主体已通过验收；个人试用注册的实际邮件闭环仍待验证，公开注册尚未就绪。**尚未执行前端或后端发布**。下面的真实验证针对原 Supabase 项目及本轮候选页面，不能据此宣称 PR24 已上线这些功能。

## 本轮完成

- 游客仍使用原本机账本。登录后直接读写当前账号的云端账本、对话和分类偏好；不把云端数据缓存或降级保存到游客区，登录也不会自动上传本机旧账。
- 服务器以登录身份验证数据归属；请求中的账号编号仅用于拒绝旧会话误写。两个账号互相隔离，两个设备对同一版本同时保存只允许一个成功。
- 用户在「我的」点击「复制本机数据到这个账号」后才读取本机内容，先预览三个账本的账目、对话、偏好数量，再确认一次。四份资源在一个事务中复制；目标已有任一资源，包括曾清空后保留的版本记录，均拒绝覆盖。本机原内容保留。
- 切换账号会清除页面草稿、旧回答和撤销入口。独立审查发现的慢同步覆盖新保存状态问题已修复：同步与保存共用页面操作锁，延迟读取回归通过。游客助手记忆读取失败不阻断手动记账。
- 自有账户划转由程序边界检查处理：不生成收入或支出草稿，明确当前不支持单独记录转账；未知性质仍澄清。Dify 保持已发布的 **#6**，本轮未发布新的 Prompt。

## 验收结果与口径

所有账目与账号均为合成测试数据，浏览器使用独立上下文，未操作用户已有 Chrome/IAB 账本。本轮截至本文记录时，**真实模型调用 0 次**。

| 层次 | 已验证结果 | 范围说明 |
| --- | --- | --- |
| 单元与 API、渲染 | 280 项单元/API + 2 项渲染通过 | 包括云存储、身份变化、版本冲突、复制失败与重复确认保护；类型与 lint 检查通过 |
| 默认浏览器构建 | 43 通过、20 跳过 | 无模型接口配置时，AI 专项按设计跳过，不计为通过 |
| AI 模拟浏览器构建 | 43 通过 | 使用模拟响应，不调用真实模型；与默认轮合计覆盖注册最终调整前的63个不同用例，不能将两轮相加称为86个不同用例 |
| 最终个人试用账号专项 | 9/9通过，注册专项2/2复核通过 | 覆盖模拟注册待确认和未授权邮箱拒绝；最新类型与lint通过，实际邮件收件未测试。原注册关闭专项1项仅作历史记录 |
| 数据库事务验证 | 34 项断言通过，测试事务回滚 | 检查所有权隔离、未登录拒绝、版本冲突、批次原子性等；回滚测试不保留测试写入 |
| 真实账号 API | 两个合成账号，10 项通过 | 包括真实双客户端并发：1 次提交成功、1 次冲突；伪造账号、跨账号读写及旧令牌切换被拒绝 |
| 真实浏览器 | 两个独立上下文，8 项检查通过 | A 的账目与偏好可在第二个环境读取；退出后游客仍为空；B 看不到 A；自然语言查账、刷新追问与对话同步通过，未调用模型 |

网络中断不冒充保存成功。若服务器可能已经提交而响应丢失，页面提示重新载入核对，不自动重试或重复复制。

最后新增未授权邮箱用例后，浏览器套件共有64个不同用例。上面的完整两轮是在最终注册改动前覆盖63个用例；最终改动后跑了账号9项及其中注册2项复核，完整64项最终CI尚待执行。这里不把重叠专项重复相加，也不把早期全量结果当作最终全量结果。

## 数据库和注册状态

原 Supabase 项目 `ossuymtantsctyhtwnyw` 已从暂停状态恢复为健康状态。已应用增量迁移 [`20261025021127_xiaoman_account_resources.sql`](../../supabase/migrations/20261025021127_xiaoman_account_resources.sql)：增加账号资源与权限、版本检查及原子 RPC，不删除旧表或自动迁移本机数据。

本人已完成 Supabase 后台登录。原 Site URL 为 `localhost:3000` 且没有返回网址允许列表；现已将 Site URL 与唯一 Redirect URL 都改为 `https://molly-gith.github.io/xiaoman-ledger/previews/pr-24/`，不使用通配符。

只读返回探测通过：携带无效令牌请求允许的 PR24 地址时收到303并返回PR24；请求外部 `https://example.invalid/` 时也收到303，安全回落到同一PR24。两者最终目标均为 `https://molly-gith.github.io` 下的 `/xiaoman-ledger/previews/pr-24/`。此检查没有发送邮件，不能据此声称收件和确认成功。配置截图：[auth-return-settings.png](C:/Users/Administrator/Documents/ChatGPT/Agent开发/evidence/account-20261025/auth-return-settings.png)。

Custom SMTP未启用；[Supabase官方说明](https://supabase.com/docs/guides/auth/auth-smtp)规定默认邮件只投递到项目组织团队成员邮箱。因此当前候选版增加的是**授权邮箱的个人试用注册**：Molly可用登录后台的同一邮箱注册小满账号，未授权邮箱会得到明确提示。**实际收件箱投递尚未测试，公开注册仍等待邮件服务方案选择**，不能称为通用注册已经完成。邮箱确认保护没有关闭；本轮未购买服务、增加费用或索取新密钥。

真实验证结束后，根线程仅按精确ID并核对QA测试标记清理了两个合成账号；复查匹配测试账号剩余0个，忽略目录里的临时凭据文件已移除。保留的结果JSON与合成截图不含可登录凭据。

## 证据位置

- 真实 API 结果：[live-account-result.json](../../work/account-verification-20261025/live-account-result.json)，包含 10 项检查及 `modelCalls: 0`。
- 真实浏览器结果：[live-browser-result.json](../../work/account-verification-20261025/live-browser-result.json)，包含两个上下文、8 项检查及截图清单。
- 同目录的 `context-1-account-a.png`、`context-1-account-b.png`、`context-1-guest-after-logout.png`、`context-2-account-a-local-query.png`、`context-2-account-a-followup.png` 记录合成账号隔离与同步；原始工作证据不作为公开账号资料发布。
- 最终320px个人试用界面：[account-pilot-signup-320px.png](C:/Users/Administrator/Documents/ChatGPT/Agent开发/evidence/account-20261025/account-pilot-signup-320px.png)；未授权邮箱说明：[account-pilot-email-denied-320px.png](C:/Users/Administrator/Documents/ChatGPT/Agent开发/evidence/account-20261025/account-pilot-email-denied-320px.png)。两图来自隔离模拟测试，未发送真实邮件。
- 用户工作区证据目录：`C:/Users/Administrator/Documents/ChatGPT/Agent开发/evidence/account-20261025/`。旧 `account-login-320px.png` 属于此前注册关闭的候选界面，不代表最终个人试用界面；`auth-return-settings.png` 记录已修正的邮件返回配置。

## 待填写的发布记录

| 项目 | 当前状态 / 发布后补录 |
| --- | --- |
| 发布提交 | 待填写 commit SHA |
| GitHub CI | 尚未执行本轮发布；待填写 run 链接与结果 |
| GitHub Pages / PR24 | 尚未执行本轮发布；待填写 run 链接、在线脚本名和上线核对结果 |
| Vercel | 尚未执行本轮发布；待填写 deployment ID、提交与 READY 核对结果 |
| Dify | 继续使用已发布 #6；本轮未重新发布 |

下一步执行完整CI与候选版发布核对，再由本人按[使用步骤](../ACCOUNT_SYNC_GUIDE.md)验证实际收件、确认和旧账复制。已有已确认账号的同步已验证；公众注册仍待邮件服务选择，本机模式始终可用。
