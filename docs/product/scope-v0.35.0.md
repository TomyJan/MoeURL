# v0.35.0 有界页脚链接

2026-10-30 19:06 UTC 文档状态同步（远端状态只据 2026-10-30 18:13:09 UTC 只读快照，非本次实时查询）：Task1–3 已标准完成，Task4 进行中且仅步骤 1 已完成。既有 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 已推送候选 `c44d23c0c7fe9ff41c52c19bd92dbe3c45636b08`；其自身 [CI run41097109781](https://github.com/TomyJan/MoeURL/actions/runs/41097109781) 九项 SUCCESS，完整 7331 行原始日志现已 ROOT 连续读至 EOF。真实 CodeRabbit review5716229915 的 kind=reviewed、sourceCommitId=coveredCommitId=该候选完整 SHA，review 与 overview 已全文读回；快照 effective open 为 0，但两条新增 outside 文档 Minor 仍须本次字段／状态同步及一次公开处置闭环，不与原五类延期 Minor 混合。本次文档后继的自身 CI、完整原始日志与真实 exact-head 审查仍待，不借 c44 证据；尚未合并、未完成 master 自身 CI／标准 Task4／最终归档清理，未 tag／release／deploy。以下旧阶段与失败记录均为历史，保留实际提交、输入、运行时和证据归属。

历史记录（原文保留）：状态：2026-10-30 Task1–3 已标准完成，后端、前端、完整浏览器和精确产品本地门禁已有各自输入与运行时证据；Task4 进行中。[PR #239](https://github.com/TomyJan/MoeURL/pull/239) 候选 632c619 的 [CI](https://github.com/TomyJan/MoeURL/actions/runs/41054453846) 有 Test、Test Coverage、E2E 三项失败，当前正在窄修 ACE 校验及旧场景选择同步，不可合并，未发布。执行者根据长期自主迭代授权选择本增量，不冒用户逐条批准。起点仍为 fresh master API 与独立 fetch 相等的 65e859f797b7c422f83d8eac056b06ae2d60a1db；旧 PR #238 的完成证据不归属本版。

## 目标与版本选择

允许自托管管理员在全站页脚添加少量文档、联系或政策入口，落实已有自定义链接规划。相比媒体上传及全站访问合并导出，本增量不新增文件存储、服务端联网或跨用户数据聚合；独立资源保留旧页脚文本、固定署名与系统设置并发边界。

## 现状盘点

| 能力／来源 | 当前状态／是否纳入 | 后端／数据库 | 前端 | 测试与风险 |
| --- | --- | --- | --- | --- |
| [现有页脚](../specs/themes-and-i18n.md#页脚配置) | 纯文本与固定署名已实现；保留不重构 | 旧 DTO／版本不扩展 | 保留文字、构建链接及弹性布局 | 新旧组合回归；低风险 |
| 自定义页脚链接／同上 | 已实现最多 5 项；c44 候选自身九项 CI 成功，Task4 仍进行中，未合并 | 独立三 API、单键、CAS、仅键名审计、00031 | 独立编辑器与公开 nav 已实现 | 共享 URL 语料、严格 JSON、真实 PG 与本地门禁保持各自归属；c44 原始 CI 全文 EOF，本次文档后继门禁／公开处置仍待，中风险 |
| [首页文案](scope-v0.33.0.md)、[固定强调色](scope-v0.34.0.md) | 已合并未发布；本版仅验证资源独立 | 不改旧键／权限／审计 | 不改旧表单或账号偏好 | 独立保存、身份轮次、公开晚到；中风险 |
| Logo／Favicon／任意主题色 | 规划未开发；不纳入 | 媒体与存储边界另立版本 | 无上传或编辑入口 | 避免 PWA／内容注入范围扩张 |
| [全站访问合并导出](roadmap.md) | 未开发；不纳入 | 跨用户权限、隐私和快照预算独立设计 | 不新增导出 UI | 高风险，不与品牌入口混合 |
| 旧五类延期 Minor | 已披露；不纳入顺手修复 | 不改旧测试异常 rollback | 不大扫历史文档 | 新测试最早清理必须有界；不称旧问题已修 |
| [生产缺口](development-status.md#验证进展与缺口) | DNS/TLS、外部 OIDC、恢复回退及部署验收仍缺；不纳入 | 不操作日常实例／生产库 | 无发布结论 | CI／容器不替代真实生产 |

## 必须实现

- 最多 5 个有序 label／URL 项，默认空；允许重复，不隐式排序或丢弃空行。label 按 Go trim，1–40 Unicode 码点；URL trim 后最多 2048 ASCII 字节，精确规则见规格。
- 独立管理表单：新增、删除、上移、下移、清空保存；编辑只改草稿并清旧成功反馈，冲突保草稿显式重载，禁止自动重试写。中英双语与键盘可用。
- 公开只返回 links；空或读取失败无自定义 nav。后台 pending 保留最近成功值；当前失败清空；本次挂载实际读取，不复活旧 cache。管理提交只发布当前身份服务端成功结果。
- 只允许绝对 HTTP(S) URI，label 为文本节点。允许 localhost／内网，但服务端永不 DNS／抓取／代理；仅用户主动新窗口导航，noopener／noreferrer／no-referrer，无预取。
- 当前数据库有效非内置账号、builtin admin 组及双权限、完整精度 CAS、五秒事务与账号→组→配置锁序、变化和仅键名审计同事务。旧 general／home／appearance 与个人偏好保持独立。
- Down→Up 保留管理员列表、完整版本及非空审计历史；缺行／坏结构／坏 URL 启动和读取 fail closed，不静默修默认。
- 当前输入的后端、隔离当前依赖前端、真实双视口浏览器及精确产品门禁，唯一 fresh 整分支终审，候选和 master 各九 CI、真实审查闭环、标准任务与可恢复归档分别留证。

## 非目标

HTML／Markdown／CSS、媒体上传、Logo／Favicon、备案号专有字段、翻译管理、图标编辑、CMS、嵌套菜单、点击统计、链接可达性／安全认证、服务端 URL 抓取、跨客户端推送、新依赖／新权限、tag／release／deploy 均不纳入。

## 文档与完成口径

[规格](../specs/2026-10-30-v0.35.0-footer-links-design.md)、[计划](../implementation/v0.35.0-plan.md)、[矩阵](../implementation/v0.35.0-test-matrix.md)、[任务](../implementation/v0.35.0-tasks.md)和[验收](../implementation/v0.35.0-acceptance.md)共同约束实施。实现、本地门禁、目标 CI、合并与发布分开；B06 的 Go／TS 同源语料消费、前端与浏览器已实现并有本地证据；历史候选 `632c619` 的 Node 26.13.0 曾暴露原生 URL 对无效 ACE 的接受差异，其当时 CI 未通过。后继修复的完整门禁、各候选真实审查闭环、合并、master 自身 CI 和发布须按各自提交分别留证，不借旧提交或其他运行时结果替代。
