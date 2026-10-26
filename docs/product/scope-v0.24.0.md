# v0.24.0 匿名访问记录 CSV 导出

状态：2026-10-27 已通过 [PR #219](https://github.com/TomyJan/MoeURL/pull/219) squash 合并为 `5c3fee5ca2ff3c53f7b028ca87d9a99f41cd706e`。最终 head `769a9d97` 的[目标 CI](https://github.com/TomyJan/MoeURL/actions/runs/40374212790)与实际合并提交的[主分支 CI](https://github.com/TomyJan/MoeURL/actions/runs/40384305979)各 9 项成功；最终实际 CodeRabbit 增量复审无新增有效意见，详见[验收](../implementation/v0.24.0-acceptance.md)。功能已合并，尚未正式发布；原分支基线 `5f6702d9` 和逐候选本地证据保持原归属。

## 目标与盘点

补齐原规划中详细统计的导出能力，支持用户将单条短链已应用范围及筛选下的匿名成功访问记录交给表格工具分析。沿用既有 Go、SQLC、PostgreSQL 和 Vue／Vuetify，不增加数据采集、依赖、全局导航或后台任务。

| 能力与来源 | 现状及本版取舍 | 后端与数据库 | 前端与验证 | 风险 |
| --- | --- | --- | --- | --- |
| [匿名访问记录](../specs/statistics-and-events.md) | 已有单链日期、设备、国家筛选和游标分页；本版复用过滤语义，保持只读查询。 | 只导出成功跳转的已有匿名字段，当前快照重新授权和检查归属。 | 当前记录区域增加独立下载动作。 | 中，跨账号或筛选错位。 |
| 单链记录导出 | 纳入，最多 1000 条，原始可变长文本与最终 CSV 分别最多 8 MiB。 | 新增专用导出权限及最小授权迁移、预算受限 SQLC 查询。 | 服务端生成 CSV；不从浏览器缓存／分页拼接，不静默截断。 | 中，容量与公式注入。 |
| 审计、全站访问及大数据导出 | 本版不纳入，审计导出另由 v0.25.0 实施。 | 需要独立授权、容量与保留设计。 | 不开放占位入口。 | 高，保持范围清晰。 |

## 必须实现

- 个人和管理单链记录区域导出当前已加载、已应用的 UTC 日期范围及设备／国家筛选，不受当前页码影响。
- 独立可配置 `short_link:export_visits`，叠加 `short_link:read_visits` 和个人读取／归属，或后台入口与全站读取；user／admin 默认及 standard 拥有，guest／basic／restricted 不拥有。
- 同一 5 秒只读 repeatable-read 快照内重读有效账号、数据库组权限、未删除短链及 owner；分页参数不接受，超量或超字节预算整批拒绝，空结果允许表头文件。
- 固定机器字段、UTC 完整时间、UTF-8 BOM、CRLF、标准 CSV 转义和公式注入保护；不含目标 URL、账号、原始 IP／UA／Referer 或秘密，不新增事件或审计记录。
- 双语、手机布局、错误重试、权限／身份／过滤／路由与组件生命周期隔离；导出不能使用未应用的国家草稿或正在刷新的旧记录范围。
- 权限迁移 Up／Down／再次 Up、人工后授予保留、真实数据库、HTTP、前端和真实 Compose 浏览器验证；保持既有 100% 门禁及排除边界。

设计见[规格](../specs/2026-10-26-v0.24.0-visit-record-export-design.md)，实施与证据见[计划](../implementation/v0.24.0-plan.md)和[验收](../implementation/v0.24.0-acceptance.md)。
