# Sprint 1 技术复核 / Technical Review

## 中文

### 给产品负责人的结论

Sprint 1 是第一轮开发迭代，交付的是可以运行的功能；`PRD.md` 是描述要做什么的需求文档。技术审核由 AI 承担，产品负责人不需要阅读源码、选择测试工具或核对数据库实现。

本次独立代码检查发现 4 个之前测试未覆盖的问题，已逐一修复并补充复现测试。核心财务公式未发现新的已证实缺陷。

| 优先级 | 问题及影响 | 修复 |
|---|---|---|
| 高 | 数据库暂时打不开时被当成空账，新建账本后可能遮蔽原账。 | 读取失败就保留原账并提示重试，不从空账继续初始化。 |
| 高 | 升级时可能选中旧的备用副本，显示较少的账目。 | 兼容旧版优先读取数据库的规则；保留备用副本，不让旧副本覆盖当前账。 |
| 高 | 换时区后，旧账时间戳落到另一天，导致整本账无法读取。 | 新确认的日期保存为固定日历日期；保留旧时间戳和原周期，日期有歧义时暂不显示相关安心可花，待用户确认。 |
| 中 | 联网使用新版后，离线仍可能打开首次安装的旧版。 | 成功在线访问时，先缓存新版所需资源，再更新离线首页。 |

### 验证范围

- 32 项规则、数据存取、分类和 AI 接口测试，以及 2 项服务端加载/集成检查。
- 6 项浏览器验收，覆盖完整记账、旧账确认、多页面冲突、零/负余额、新周期、保存失败和离线升级。
- 类型检查、代码检查、vinext 构建、GitHub Pages 构建。

### 您需要判断什么

您只需要判断：是否容易看懂“还能安心花多少”、记账是否顺手、消费性质是否有意义，以及后续版本优先做什么。计算、存储、代码质量和测试结果由 AI 复核并报告。

这不是对所有未来场景“绝无问题”的承诺。真实 AI、完整标注评测、云存储与权限验证尚未交付；现有依赖安全公告也仍需要在服务器/Beta 发布前专项处理。若旧账日期需要确认，那是缺失原始信息的核对，不是让用户承担技术审核。

## English

### Conclusion for the Product Owner

Sprint 1 is the first development iteration, delivering runnable functionality. `PRD.md` is the requirements document describing what to build. AI owns technical review; the Product Owner does not need to read source code, choose test tools or audit storage implementations.

An independent code review found four gaps in the previous test coverage. All four were fixed and received regression tests. No additional confirmed defect was found in the core financial formula.

| Priority | Issue and impact | Resolution |
|---|---|---|
| High | A temporary database-open failure could return an empty ledger and allow initialization to shadow the original data. | Read failures retain the existing ledger and ask for a retry; they never bootstrap empty state. |
| High | Upgrade could select a stale fallback copy and show fewer transactions. | Preserve the original v1 IDB-first authority and retain the fallback without letting it replace current data. |
| High | A timezone change could move a legacy timestamp to another calendar day and prevent the whole ledger from loading. | Newly confirmed dates are date-only. Legacy timestamps and original cycles remain intact; uncertain dates hide the affected safe-to-spend headline until confirmation. |
| Medium | An online app update could still reopen the original release offline. | Successful online navigation caches the required new assets before publishing the new offline shell. |

### Validation scope

- 32 rule/repository/classification/AI tests plus 2 rendered/integration checks.
- 6 browser acceptance tests, covering CRUD, legacy confirmation, concurrent tabs, zero/negative balances, rollover, persistence failure and offline upgrades.
- Typecheck, lint, vinext build and GitHub Pages build.

### Decisions that remain yours

Judge whether safe-to-spend is understandable, bookkeeping feels easy, expense nature is useful and the next priorities fit your needs. AI checks and reports calculations, storage, code quality and test results.

This review does not guarantee that every future scenario is defect-free. Real AI integration, full labeled evaluation, cloud storage and access-control verification remain pending. Existing dependency advisories require focused work before server/Beta deployment. Confirming an ambiguous historical date resolves missing source information; it is not a technical-review task.
