# 开发进度与能力清单

[v0.35.0 有界页脚链接](scope-v0.35.0.md) 后端已实现并通过当前本地完整 Go／Linux race／vet／业务 100% 与 SQLC 零漂移，标准 Task1 已完成、Task2 进行中，当前隔离 frozen 依赖、strict entity／公开协调器／SiteFooter、独立管理 editor 与身份竞态已实现，完整 135 文件／2333 测试及四项 100%、types／lint／外置构建已通过，metadata 为 0.35.0；原子前端提交与标准 Task2 尚待，浏览器／远端交付仍待。独立 fresh master／open PR 与 fetch 已确认起点 65e859f797b7c422f83d8eac056b06ae2d60a1db，新分支已进入完整前端门禁核验阶段，尚无完整版本交付结论。见[计划](../implementation/v0.35.0-plan.md)、[任务](../implementation/v0.35.0-tasks.md)与[验收](../implementation/v0.35.0-acceptance.md)；下文旧阶段表述保留历史归属，不能借旧 CI 宣称新版本完成。

[v0.34.0 站点强调色预设](scope-v0.34.0.md) 已由 [PR #237](https://github.com/TomyJan/MoeURL/pull/237) 于 2026-10-29T21:10:29Z 合并为 fc88c0e8b9192174e62b225fdc3cb0b87a253451。最终候选 99ebef5 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40949991695) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40955501280) 各九项成功，真实审查覆盖最终候选、全部有效意见闭环；标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成，未正式发布。固定 iris／ocean／forest 三预设、独立 CAS 与仅键名审计保持既有主题模式、个人偏好和公开访问；任意颜色编辑仍未开放；本次维护不改依赖、权限或 schema。原失败、逐候选运行时和当时延期三项 Minor 见[验收](../implementation/v0.34.0-acceptance.md)。当前[独立验证与文档维护](../implementation/2026-10-30-site-accent-closeout-plan.md)不新增业务版本；补验 Task1 已标准完成，维护自己的终审及 PR／CI／合并仍待做。

[v0.33.1 首页文案反馈补丁](scope-v0.33.1.md) 已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a647febf6d7c5ee306605432066ca5bd2e8`。最终候选 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功，真实最新审查覆盖、全部有效意见闭环；标准 Task1–3、完整最终归档与准确 leaf 可恢复清理完成。原本地执行 SHA、失败与证明边界见[验收](../implementation/v0.33.1-acceptance.md)；未正式发布，不替代当前[文档维护轮](../implementation/2026-10-29-delivery-status-plan.md)自己的交付验证。

[v0.33.0 首页文案](scope-v0.33.0.md) 已由 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`，最终 `34a520b` 的 PR CI40852026042 与合并 master CI40858639758 各九成功，真实最新审查／有效意见闭环、标准 Task1–4、完整最终归档与准确 leaf 可恢复清理完成。三个 Minor 在该版延期，所有原始失败、执行 SHA、完整输入与运行时保持[验收](../implementation/v0.33.0-acceptance.md)归属；未正式发布。

[v0.32.0 二维码外观预设](scope-v0.32.0.md) 已由 [PR #230](https://github.com/TomyJan/MoeURL/pull/230) 合并为 `99f87709`；最终候选 `28214ef` 的 PR CI40816638924 与合并 master CI40821882951 各九成功，真实最新审查／有效意见闭环，标准 Task1–4 与最终完整 SDD 归档均完成。三个本地深色／白底 PNG 预设，不持久化；原单元及各候选4／110浏览器、七原图和产品制品保持[验收](../implementation/v0.32.0-acceptance.md)归属，未正式发布。

[v0.31.0 OIDC 创建模板](scope-v0.31.0.md) 已由 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 合并为 `c6712051`，最终 `e9c3025` 的 PR CI40741884841 与合并 master CI40748005532 各九成功，真实最终审查／有效意见闭环，标准 Task1–4 与完整最终归档均完成。仅 Google／手动草稿，不放宽 verified-email；原单元及各候选制品保持[验收](../implementation/v0.31.0-acceptance.md)归属，未正式发布。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](../implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

2026-10-28：[v0.29.0 每域名默认跳转方式](scope-v0.29.0.md) 已由 [PR #227](https://github.com/TomyJan/MoeURL/pull/227) 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`。最终 `4dfa4d43` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40629796924) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40631422772) 各九成功，真实 CodeRabbit 覆盖最终、有效 open0。配置仅用于创建初选、明确手动优先，旧省略模式与已有短链不变；唯一独立终审、root 修复与原失败均保持[验收](../implementation/v0.29.0-acceptance.md)归属，尚未正式发布。

此前功能 [v0.25.0 操作审计 CSV](scope-v0.25.0.md) 由 PR #222 合并为 `6933f94c`，其合并 CI #40406334592 的手机 E2E 失败保持历史归属。后继[维护 PR #223](https://github.com/TomyJan/MoeURL/pull/223) 清理 4 条开发依赖公告并修复 Toast 同步，已合并为 `cafacf1520e4ea59934af4c1339a56224c2fdcd0`；精确最终 `a9a53b98` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40415038034) 和新合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40421454231) 各 9 成功，实际 CodeRabbit 首审与最终增量覆盖最新变更，无有效未解决问题。远端恢复与逐候选证据见[维护验收](../implementation/2026-10-27-frontend-security-dependencies-acceptance.md)，不改写旧失败；正式发布未执行。

v0.26.0 个人偏好已由 PR #224 合并，v0.27.0 域名排序已由 PR #225 合并，各自证据见[个人默认验收](../implementation/v0.26.0-acceptance.md)和[排序验收](../implementation/v0.27.0-acceptance.md)。[v0.28.0 用户组默认](scope-v0.28.0.md) 已由 [PR #226](https://github.com/TomyJan/MoeURL/pull/226) 于 2026-10-27T21:21:01Z 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`，最终候选 `028008114edda315cfaef0f2effbc0c6c127ae7c` 的 [PR CI #40575287235](https://github.com/TomyJan/MoeURL/actions/runs/40575287235) 与合并 [master CI #40586040807](https://github.com/TomyJan/MoeURL/actions/runs/40586040807) 各九成功，实际 CodeRabbit 覆盖最终且有效 open0。原阶段与失败保持[验收](../implementation/v0.28.0-acceptance.md)归属；以上均未正式发布。

更新日期：2026-10-27。历史远端文档基线 `722b2ce03ee79c05b55737e16eaab2d83c36372b` 基于代码 `c4928a85`，包含 PR #198 合并的 [v0.17.0 短链批量管理](scope-v0.17.0.md) 及当时的依赖和 Go 证书安全修复。该文档基线的 [Check Code](https://github.com/TomyJan/MoeURL/actions/runs/39775160522) 全部 9 项通过，不替代后续代码候选的结果。v0.18.0 已通过 PR #208 合并为 `0f01a2e5`，其原分支本地证据不替代合并提交 CI 或发布。`33f287ec`、`1c6df4a` 等历史证据单独保留，不改写为新提交结果。真实生产演练与正式发布尚未完成。本页是进度入口，版本边界由 scope 和 spec 定义，指定提交及环境的实际验证由对应 acceptance 记录。

## 状态口径

- **已实现**：当前代码已有可用业务闭环，不代表已经正式发布。
- **部分实现**：基础能力可用，表中列出的扩展尚未实现。
- **待开发**：属于原有产品规划或远期方向，尚无对应完整闭环，不自动纳入下一版本。
- **待验证**：代码或脚本已有，但缺少指定提交、运行时或目标环境的执行证据；不与待开发功能混算。

## 已实现与部分实现

| 模块 | 当前可用能力 | 尚未实现的扩展 | 范围与规格 |
| --- | --- | --- | --- |
| 初始化与本地认证 | 首次初始化站点和管理员；禁止重复初始化；Cookie Session、登录退出、账号状态检查和登录失败限流；证明当前密码后自助改密、全部旧会话撤销及重新登录。 | 不提供自助注册、找回密码或纯 OIDC 账号设置本地密码流程。 | [用户与认证](../specs/users-and-auth.md)、[个人改密范围](scope-v0.13.0.md)、[生产就绪范围](scope-v0.6.0.md) |
| 用户与个人设置 | 管理员创建、列表、启停、修改昵称和重置普通用户密码；个人昵称及账号语言／主题偏好。v0.19.0 单账号及 v0.30.0 最多 100 个账号的 user／admin 成员迁移已合并，包含版本冲突保护、旧会话撤销及事务审计；历史候选和原失败保持各自验收归属，尚未正式发布。 | 头像上传、时区及其他个人偏好、自定义组和多用户组。 | [个人设置范围](scope-v0.1.2.md)、[账号偏好](scope-v0.15.0.md)、[单账号迁移](scope-v0.19.0.md)、[批量迁移](scope-v0.30.0.md)、[管理后台](../specs/admin.md) |
| 用户组与权限 | 内置 guest、user、admin；动态权限解析；user／admin 权限编辑；三个预设、管理权限保护及乐观并发。guest 保持只读空权限。 | 自定义用户组、组织空间、访客资源归属与访客创建开放。 | [用户组范围](scope-v0.5.0.md)、[权限](../specs/permissions.md) |
| 短链基础管理 | 随机及权限控制的自定义短码，全局唯一且不可复用；个人与全站列表、分页、筛选、启停、目标编辑和软删除。已合并当前列表最多 100 条原子启停／软删、单条和批量归属转移与事务审计、最多 1000 条／8 MiB 的筛选清单 CSV。v0.22.0 PR 与实际合并提交 CI 各 9 项成功。 | 跨页全选、个人赠送和导入仍未开发。 | [短链](../specs/short-links.md)、[自定义短码](scope-v0.12.0.md)、[批量管理](scope-v0.17.0.md)、[归属转移](scope-v0.20.0.md)、[清单导出](scope-v0.21.0.md)、[批量转移](scope-v0.22.0.md) |
| 访问模式与生命周期 | direct、intermediate、confirmation；中间页 3–10 秒倒计时；过期时间；浏览器生成二维码，v0.32.0 已合并三个本地固定外观预设；公开访问状态页。 | 模板选择和编辑、任意二维码样式编辑、目标可达性检测与自动审核。 | [访问体验范围](scope-v0.2.0.md)、[确认页范围](scope-v0.4.0.md)、[二维码预设](scope-v0.32.0.md) |
| 访问密码 | Argon2id 哈希、数据库一致失败限流、15 分钟访问授权；修改密码使旧授权失效。 | 本版闭环已实现，不提供独立授权管理 UI。 | [密码保护范围](scope-v0.3.0.md) |
| 最大访问次数 | 权限控制的可选限额；最终跳转原子领取；编辑保留用量、清除后重开周期；统一耗尽状态。 | 自动周期重置、独立清零、额度历史和告警。 | [最大访问次数范围](scope-v0.10.0.md) |
| 标题与标签 | 创建、编辑和清空；管理列表展示；关键词搜索及精确标签筛选；权限与公开字段隔离。v0.23.0 已合并当前列表 1–100 条原子添加／移除／替换标签及清空，保持标题、访问配置与历史。 | 尚未正式发布。集中标签库、重命名合并、颜色层级、独立备注及 Open Graph 未开发。 | [元数据范围](scope-v0.11.0.md)、[批量标签](scope-v0.23.0.md)、[验收](../implementation/v0.23.0-acceptance.md) |
| 概览与分析 | 已合并个人概览、最近短链、单链匿名聚合、最长 90 天 UTC 范围和聚合 CSV，以及管理员全站快照、趋势／热门、本人／管理单链匿名访问分页与浏览器／系统类别；旧空类别显示未知。v0.24.0 已合并单链完整筛选匿名记录 CSV，最多 1000 条／8 MiB，叠加独立权限。 | 尚未正式发布；超出 90 天或任意时区分析、全站访问合并导出及事件归档未实现。 | [个人概览](scope-v0.1.1.md)、[聚合导出](scope-v0.16.0.md)、[v0.24.0 范围](scope-v0.24.0.md)、[统计与事件](../specs/statistics-and-events.md) |
| 操作审计 | v0.18.0 已合并关键业务变更与日志同事务、真实 actor、白名单字段及只读筛选；180 天在线保留和有界清理，非空审计安全拒绝回滚。v0.25.0 已通过 PR #222 合并按日期／actor／resource／action 下载最多 1000 条／8 MiB 审计元数据 CSV。 | 尚未正式发布；合并后手机 E2E 修复跟进见验收。独立登录安全事件中心、外部 SIEM 与防篡改签名未实现。 | [v0.18.0 范围](scope-v0.18.0.md)、[v0.25.0 范围](scope-v0.25.0.md)、[设计](../specs/2026-10-27-v0.25.0-audit-export-design.md)、[验收](../implementation/v0.25.0-acceptance.md) |
| OIDC | 多 Provider 管理；标准 Discovery、Authorization Code、PKCE、state、nonce 及浏览器绑定；邮箱域名白名单首次供应；复用本地 Session 与权限。v0.31.0 已合并 Google／手动创建草稿模板。 | 自定义 Provider 模板、主动账号绑定、组映射、SAML、LDAP、SCIM 和 Passkey。 | [OIDC 范围](scope-v0.7.0.md)、[OIDC 设计](../specs/2026-09-11-v0.7.0-oidc-login-design.md)、[创建模板](scope-v0.31.0.md) |
| 多域名 | 管理、启停、组授权、全局默认及创建选择；访问限定所属启用域名；短链引用保护。v0.26 个人默认、v0.27 排序、v0.28 组默认及 v0.29 域名默认跳转方式均已合并，各自最终 PR／合并 CI 九成功及真实审查闭环。 | 尚未正式发布；用户自助绑定、自动 DNS/TLS、既有短链域名迁移未开发。 | [多域名范围](scope-v0.8.0.md)、[个人默认](scope-v0.26.0.md)、[排序](scope-v0.27.0.md)、[组默认](scope-v0.28.0.md)、[默认方式](scope-v0.29.0.md)、[域名](../specs/domains.md) |
| 系统设置与品牌 | 站点名称、默认语言／主题、纯文本页脚和本地登录开关；关闭本地登录与最后一个可用 OIDC Provider 共享安全边界。v0.33.0 首页标题／简介、v0.33.1 反馈补丁及 v0.34.0 三个固定站点强调色均已合并。强调色与个人深浅模式独立；候选与 master 各九 CI、真实审查、标准任务和归档均有独立证据，尚未正式发布。 | Logo／Favicon 上传、任意主题色编辑、HTML 页脚、部署参数在线修改。 | [系统设置范围](scope-v0.9.0.md)、[首页文案](scope-v0.33.0.md)、[反馈补丁](scope-v0.33.1.md)、[站点强调色](scope-v0.34.0.md) |
| 前端体验 | 中英双语、浅深色及跟随系统、响应式布局、PWA 基础；标准表格／列表／菜单、可堆叠 Toast、短链下的分析入口、长 URL 省略、减少动态效果支持。 | 更多语言、主题编辑器、自定义 CSS、跳转页模板编辑。 | [导航与页面](../specs/navigation-and-pages.md)、[主题与多语言](../specs/themes-and-i18n.md) |
| 部署与维护 | 单机 Compose、外部 TLS 代理示例、健康检查、请求防护、有界退出、分批清理、备份恢复及升级回退脚本与手册。 | 高可用、内置 TLS、完整监控追踪、事件归档；生产演练证据另列下节。 | [生产就绪范围](scope-v0.6.0.md)、[部署手册](../deployment/single-host-compose.md) |

上表的未实现扩展是能力边界，并非全部已排期。涉及账号安全、访客开放、统计明细或模板注入的扩展，须先定义安全与数据保留规则。当前统计不保存原始 IP、完整 User-Agent 或完整 Referer；不能为了详细统计直接放宽既有隐私边界。

## 最近完成的前端整理

本节记录前端整理阶段，其本身未新增业务版本；当前默认视觉为「鸢尾蓝 × 薄荷青」。

- 统一公共页面、控制台、表单和对话框；修复页脚占用布局外高度与概览翻译缺失。
- 初始化、登录等操作使用友好校验及可堆叠 Toast；持久加载错误保留页面内重试入口；初始化完成提供登录和首页入口，密码原值传递。
- 桌面端新建短链保留在侧栏上部；访问分析作为对应短链的二级页面，不再独立占用导航。
- 列表使用 Vuetify 标准表格、列表和菜单；长目标地址省略显示，窄屏在表格容器内滚动。
- `Powered by MoeURL` 固定展示，仅 `V` 开头的版本文字带源码链接。版本在构建时注入：精确 tag 链接到 tag，否则显示版本与短 commit hash 并链接到 commit。
- 加入克制动画及减少动态效果适配，统一浅深色、状态色和文字对比度。

设计与证据分别见 [界面更新验收](../implementation/2026-10-14-ui-refresh-acceptance.md)、[认证反馈验收](../implementation/2026-10-14-auth-feedback-acceptance.md)、[细节验收](../implementation/2026-10-14-ui-details-acceptance.md)、[标准列表验收](../implementation/2026-10-15-standard-lists-acceptance.md) 和 [配色验收](../implementation/2026-10-15-color-refresh-acceptance.md)。

## 验证进展与缺口

以下汇总各版本已有记录；v0.20.0 行单独记录本次实现工作树的新验证，不将历史提交的门禁改写为当前结果。

各版本未完成门禁均指对应候选及环境。v0.20.0 的远端状态于 2026-10-24 复核，其余远端记录保留原日期和候选；主分支、PR 与历史候选分别记录，历史成功不替代新提交。

| 证据范围 | 已记录结果 | 不能替代的验证 |
| --- | --- | --- |
| [v0.25.0 验收](../implementation/v0.25.0-acceptance.md) | PR #222 最终 `d250b4b` 的 CI #40404362865 全部 9 项成功：1704 前端／四项 100%、Go 业务 100%、95 完整 E2E 及安全／smoke。实际 CodeRabbit run `5500f594` 覆盖全部 50 文件和最终 head，无有效意见；已合并为 `6933f94c`。原逐候选本地证据和部分 RED 流程偏差继续保留。 | 旧合并 CI #40406334592 为 8 成功／E2E 失败；后继 PR #223 的新合并 `cafacf15` 在 #40421454231 实际 9 成功，手机失败已闭环。尚未正式发布，不改写旧失败。 |
| [v0.24.0 验收](../implementation/v0.24.0-acceptance.md) | [PR #219](https://github.com/TomyJan/MoeURL/pull/219) 最终 head `769a9d97` 的 [CI #40374212790](https://github.com/TomyJan/MoeURL/actions/runs/40374212790) 与合并提交 `5c3fee5c` 的 [CI #40384305979](https://github.com/TomyJan/MoeURL/actions/runs/40384305979)各 9 项成功，实际确认 1615 项前端、业务 100%、91 项完整 E2E。CodeRabbit 最终实际增量 `45bc6a0c` 无新增有效意见。 | 已合并，尚未正式发布；原逐候选本地证据和工作树生成物误定向继续保留，不替代 v0.25.0。 |
| [v0.23.0 验收](../implementation/v0.23.0-acceptance.md) | [PR #218](https://github.com/TomyJan/MoeURL/pull/218) 最终 head `635b53ae449c4f66ee6b26759fac619cbfccb8cb` 的 [CI #40300323879](https://github.com/TomyJan/MoeURL/actions/runs/40300323879) 和合并提交 `5f6702d9` 的 [CI #40306786126](https://github.com/TomyJan/MoeURL/actions/runs/40306786126) 各 9 项成功；最终 PR 原始日志核验 1518 项前端／四项 100%、Go 业务 100%、85 项完整 E2E。CodeRabbit run `085626ca-8590-4cb0-a30f-ca091e80c641` 实际完整复审 44 文件，无有效意见、docstring 100%。首轮并发观测失败和额度跳过仍保留历史归属。 | 已合并，尚未正式发布，真实生产验收待执行；不替代 v0.24.0 候选门禁。 |
| [v0.21.0 验收](../implementation/v0.21.0-acceptance.md) | 最终 head `1641e2a` 的[目标 CI](https://github.com/TomyJan/MoeURL/actions/runs/40132665857) 全部 9 项成功：1367 项前端、四项 100%、Go 业务 100%、77 项完整 Playwright 及安全／smoke 通过。PR #216 已合并为 `dfc9a5a1`，该实际合并提交的[独立 CI](https://github.com/TomyJan/MoeURL/actions/runs/40133310132) 也全部 9 项成功。原本地树 `36a9d5ed` 及首轮 `5e3d713d` 证据保持历史归属。 | CI 不冒充正式发布或生产验收；增量 CodeRabbit 因限额跳过，已修复其首轮两项意见并经独立定向复审。真实生产验收尚未完成。 |
| [v0.20.0 验收](../implementation/v0.20.0-acceptance.md) | 最终 PR 候选 `ba90f37e` 的 [Check Code #40031018213](https://github.com/TomyJan/MoeURL/actions/runs/40031018213) 全部 9 项成功，含完整测试／覆盖率、Linux race、安全扫描、构建、完整 E2E 与 Compose smoke。已通过 PR #214 合并为 `2d23dcfd`；各阶段本地、用户名兼容、布局及 CI 探测修复的证据保留在验收。 | PR CI 不替代后续提交或生产验收；尚未正式发布，真实 DNS/TLS、外部 OIDC、恢复及回退演练仍需目标环境证据。 |
| 历史主分支 `5a1d9761` | [Check Code #39830070001](https://github.com/TomyJan/MoeURL/actions/runs/39830070001) 8 项成功，`Backend Security` 的 `Race tests` 步骤失败，整体结论为 failure。 | 尚无该主分支提交完整 CI 通过的证据；历史 `c4928a85` 的成功及后续 PR 的成功均不改写此次失败。 |
| PR #211 远端 `b28ecf27` | [Check Code #39919076100](https://github.com/TomyJan/MoeURL/actions/runs/39919076100) 的普通 Go、后端覆盖率及 Backend Security 已通过；前端测试和前端覆盖率因旧 race 命令字符串断言失败，其余 7 个 job 成功。历史 `6ca648f4` 的 Docker 探测失败和 `44f187cf` 的 CI 成功仍保留原归属。 | 随后仅删除这条脆弱文本断言；修复后远端目标 CI 待验证。PR 已合并为 `c08b67b2`，尚未发布，不用历史成功覆盖当前失败或替代生产验收。 |
| [v0.19.0 本地验收](../implementation/v0.19.0-acceptance.md) | 原候选 `c9f5a0b5` 已通过全仓 Go／100% 业务覆盖率、SQLC 零漂移、vet、完整 Linux race、1276 项前端测试／四项 100%、70 项 E2E、production smoke 及精确镜像扫描。`b02f3366` 修复后本地 1279 项前端测试／四项 100%、lint／类型／构建及 3 项定向 Compose 浏览器验证通过。`b28ecf27` 的 CI 修复已补跑完整 Linux Go／race、100% 业务覆盖率、vet 与 actionlint，独立复审无新问题；本轮删除脆弱部署断言后，完整前端测试与覆盖率均 1279 项通过、四项 100%，lint／类型检查通过。 | 合并前维护轮次未重跑完整 Playwright、production smoke 或安全扫描；合并提交 `c08b67b2` 的目标 CI 本轮未获取。真实外部 OIDC、生产恢复／升级回退仍需目标环境证据。 |
| [v0.8.0 验收](../implementation/v0.8.0-acceptance.md) | 合并提交 `f818a7e8` 对应 CI、Linux race、安全扫描、Playwright 与 Compose smoke 通过。 | 该历史提交的结果不能替代当前 master；真实 DNS/TLS、隔离恢复和发布验收仍缺。 |
| [v0.9.0 验收](../implementation/v0.9.0-acceptance.md) | 系统设置功能及指定提交的 Go、前端、生成物和配置验证已有记录。 | 保留该版本验收中的未勾选项，不用后续 UI 测试回填。 |
| [v0.10.0 验收](../implementation/v0.10.0-acceptance.md)、[v0.11.0 验收](../implementation/v0.11.0-acceptance.md) | 后端、前端、SQLC、权限 fixture 及本地数据库浏览器流程已有分阶段证据。 | 完整容器、当前提交的目标 CI／Linux race／安全扫描及生产升级恢复证据待补。 |
| [标准列表验收](../implementation/2026-10-15-standard-lists-acceptance.md) | 基线 `9dbca832` 后的工作树：919 项前端测试、四项覆盖率 100%、静态检查和构建；隔离数据库完整 E2E 42 项通过、1 项跳过。 | 跳过的是 Docker 双 Host 场景；本地结果不等同目标 CI 或外部真实 OIDC。 |
| [配色验收](../implementation/2026-10-15-color-refresh-acceptance.md) | 基线 `fafa6231` 后的工作树：919 项前端测试、四项覆盖率 100%、lint、类型检查与构建；16 项界面 E2E、88 组只读页面检查。 | 本轮未重跑 Go、完整业务 E2E、Docker 或目标 CI；界面 E2E 拦截 API，不作为业务集成证据。 |
| [v0.13.0 验收](../implementation/v0.13.0-acceptance.md) | 个人改密通过 PR #186 合并为 `a52733cc`。分支原始证据：Go 全仓与业务覆盖率 100%；1023 项前端测试、四项覆盖率 100%、静态检查与构建；代码候选 `77035e6` 全量 Playwright 47 项通过、1 项 Docker 场景跳过；独立审查完成，隔离资源已清理。 | 分支本地证据不能替代合并提交验证；PostgreSQL 16.3 本地回退不能替代 PostgreSQL 18、完整容器、目标 CI／Linux race／安全扫描或生产证据。 |
| [v0.14.0 验收](../implementation/v0.14.0-acceptance.md) | 已通过 PR #187 合并为 `c864ce3a`；原分支 Go 业务覆盖率 100%；1050 项前端测试、四项覆盖率 100%、静态检查与构建；代码候选 `2afdba14` 全量 Playwright 52 项通过、1 项 Docker 双 Host 跳过；隔离资源已清理，原始证据归档保留。 | 分支证据不能替代合并提交或发布验证；PostgreSQL 16.3／本机 Chrome 与 mock OIDC 不替代目标 CI、PostgreSQL 18、完整容器、Linux race、安全扫描或生产环境证据。 |
| [v0.15.0 验收](../implementation/v0.15.0-acceptance.md) | 已通过 PR #190 合并为 `2ec7eaa4`。原分支 Go 全仓包验证、业务覆盖率 100%；1098 项前端测试、四项覆盖率 100%、静态检查；代码候选 `14207888` 固定构建及完整 Playwright 55 项通过、1 项 Docker 双 Host 跳过；隔离资源已清理，证据已归档。 | 尚未正式发布；原分支分阶段本地门禁的提交和环境分别见验收，不能替代合并提交、目标 CI、PostgreSQL 18、完整容器、Linux race、安全扫描或生产环境证据。 |
| [v0.16.0 验收](../implementation/v0.16.0-acceptance.md) | 已通过 PR #191 合并为 `bd4c2625`。原分支 Go 全仓测试与业务覆盖率 100%，1154 项前端测试及四项覆盖率 100%；代码候选 `d3f9c68f` 完整 Playwright 59 项通过、1 项 Docker 双 Host 跳过；任务资源已清理，日常预览保留。 | 未正式发布；原分支证据不替代合并提交、目标 CI、PostgreSQL 18、Linux race、完整容器、安全扫描、外部互操作和生产验收。 |
| [v0.17.0 验收](../implementation/v0.17.0-acceptance.md) | 功能通过 PR #198 合并为 `3eda85de`。后续主分支 `c4928a85` 的 [Check Code #39772002003](https://github.com/TomyJan/MoeURL/actions/runs/39772002003) 全部 9 项成功，涵盖完整 Go／前端测试与覆盖率、静态检查、Linux race、govulncheck、SQLC 零漂移、容器构建／扫描、完整 E2E 及 PostgreSQL 18 Compose smoke。原分支分阶段本地结果与本次维护中的 1215 项前端测试／100% 覆盖率另行记录，不替代上述目标运行。 | 功能已合并且该提交目标 CI 通过，尚未正式发布；仍缺真实 DNS/TLS、外部 OIDC 互操作、备份恢复、升级回退及目标生产部署验收，不能用容器／mock 测试替代。 |

发布前仍须针对候选提交补齐：

- [x] 主分支 `c4928a85` 的 Go／前端门禁、Linux race、安全扫描和完整容器构建／Compose smoke，运行链接已记录；发布候选变化后需重新验证。
- [x] PR #211 的远端候选 `44f187cf` 完整目标 CI 9 项成功；该记录不替代主分支或后续文档提交的 CI。
- [x] PR #211 已合并为 `c08b67b2`；最终发布候选与对应验证仍待确认。
- [ ] 真实 DNS/TLS、Host 白名单和 SNI 校验；PostgreSQL 18.6 隔离容器环境的双 Host 浏览器场景已有本轮通过记录。
- [ ] 外部真实 OIDC Provider 互操作、代理回调及本地登录策略切换。
- [ ] 隔离备份恢复、OIDC 原始密钥恢复、升级失败回退和业务 readiness 演练。
- [ ] 目标部署发布验收；其他浏览器、实体移动设备及读屏验证按交付要求补齐。

## 后续开发方向

v0.25.0 操作审计 CSV 已通过 PR #222 合并为 `6933f94c`，最终 PR CI 9 项成功及实际审查完成；旧合并 CI 的手机 Toast 点击失败已由 PR #223 修复，新合并 `cafacf15` 的 CI #40421454231 实际 9 成功，尚未正式发布，详见[范围](scope-v0.25.0.md)和[验收](../implementation/v0.25.0-acceptance.md)。此前 v0.24.0 单链匿名记录 CSV 的 PR 与实际合并 CI 各 9 项成功保持历史归属；全站访问合并导出和审计归档仍未开发。

v0.23.0 批量标签整理已通过 PR #218 合并为 `5f6702d9`，最终 PR 与合并提交 CI 各 9 项成功，尚未正式发布，逐候选证据见[验收](../implementation/v0.23.0-acceptance.md)。v0.22.0 管理员批量短链归属转移已通过 PR #217 合并为 `ba2073cf`，修复候选与合并提交 CI 各 9 项成功，尚未正式发布：当前列表最多 100 条、完整精度版本、全量预检与整批原子审计，不改地址／配置／历史统计。详见[范围](scope-v0.22.0.md)、[设计](../specs/2026-10-25-v0.22.0-batch-ownership-design.md)和[验收](../implementation/v0.22.0-acceptance.md)。v0.21.0 清单导出已经通过 PR #216 合并，最终候选目标 CI 9 项成功，尚未正式发布。

v0.20.0 已通过 PR #214 合并为 `2d23dcfd`：管理员单条短链归属转移、当前授权与账号检查、完整精度版本、原地址和历史统计保留、旧所有者拒绝及事务审计。最终 PR CI 与各阶段本地证据分别见上表及 [验收](../implementation/v0.20.0-acceptance.md)，尚未正式发布。

v0.19.0 已实现管理员为其他非内置账号切换 user／admin，结合当前授权、完整精度并发检查、全部旧会话撤销和事务审计，已通过 PR #211 合并为 `c08b67b2`，尚未正式发布。自定义组、多用户组和批量迁移仍属于后续能力。设计与执行分别见 [规格](../specs/2026-10-23-v0.19.0-user-group-membership-design.md)、[计划](../implementation/v0.19.0-plan.md) 和 [验收](../implementation/v0.19.0-acceptance.md)。

原独立分支 `feat/v0.18.0-analytics-audit` 已通过 PR #208 合并并实现 [v0.18.0 范围](scope-v0.18.0.md) 定义的全站统计、匿名访问明细与事务审计。原分支最后实现候选为 `e476f87d`，包含权限集合审计修复，已通过修复后全仓 Go、100% 业务覆盖率和定向复审；原候选 `721206c` 的前端、浏览器与部署验证单独保留，不替代新候选尚未重跑的对应门禁，详见 [验收](../implementation/v0.18.0-acceptance.md)。功能已通过 PR #208 合并为 `0f01a2e5`，尚未正式发布。

[v0.16.0 聚合统计 CSV 导出](scope-v0.16.0.md) 和 [v0.17.0 短链批量管理](scope-v0.17.0.md) 均已合并，历史文档基线 `722b2ce0` 的目标 CI 已通过；当前主分支与 PR 结果见上表。后续扩展继续先设计查询权限、采集隐私与数据保留边界。单条归属转移与清单导出分别在 v0.20.0、v0.21.0 合并；批量转移在 v0.22.0 合并；v0.23.0 批量标签已合并、尚未正式发布，批量导入和跨页全选仍未开发。

原有规划尚未完成的产品能力集中列在 [路线图](roadmap.md) 的「待开发能力」中。[v0.12.0 自定义短码](scope-v0.12.0.md) 已通过 PR #185 合并为 `17e1f766`；阶段状态与证据见 [验收清单](../implementation/v0.12.0-acceptance.md)。[v0.13.0 个人密码修改](scope-v0.13.0.md) 已通过 PR #186 合并为 `a52733cc`。[v0.14.0 统计日期范围](scope-v0.14.0.md) 已通过 PR #187 合并为 `c864ce3a`，正式发布及目标环境缺口继续单独记录。

v0.12.0 的分支本地记录包含 Go 业务与前端覆盖率 100%、隔离数据库完整 Playwright 45 项通过、1 项 Docker 双 Host 跳过。该记录不替代合并提交的 CI 或生产证据。v0.13.0 的测试和审查分别记录于 [本版验收](../implementation/v0.13.0-acceptance.md)。

维护本页时同步更新总览和文档入口；新增功能先有 scope／spec，验证完成后将证据写入对应 acceptance，再更新本页摘要。功能完成、合并到主分支与正式发布分别记录。
