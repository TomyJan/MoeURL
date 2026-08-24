# AGENTS.md

## 项目定位

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

当前已完成到 v0.5.0 用户组权限管理闭环。后续新版本设计应从 `docs/product/roadmap.md` 重新收敛范围，并以 v0.5.0 文档和代码作为当前实现基线。

## 工作入口

开始任何产品、文档或实现工作前，优先阅读：

1. `docs/README.md`
2. `docs/product/overview.md`
3. `docs/product/scope-v0.5.0.md`
4. `docs/specs/2026-08-20-v0.5.0-user-group-permission-management-design.md`

如果任务涉及新版本设计、跨模块功能开发、生产化交付或要求 Agent 自主完成设计、文档、开发、测试和提交，必须继续阅读 `docs/implementation/agent-delivery-guidelines.md`。

如果任务涉及回溯 v0.0.1 范围、验收或兼容性，再阅读 `docs/product/scope-v0.0.1.md`。

如果任务涉及具体模块，再阅读 `docs/specs/` 下的对应规格文档。

如果任务涉及技术实现，必须继续阅读：

1. `docs/implementation/technical-decision.md`
2. `docs/implementation/technical-baseline.md`
3. `docs/implementation/v0.5.0-plan.md`
4. `docs/implementation/v0.5.0-detailed-plan.md`
5. `docs/implementation/v0.5.0-tasks.md`
6. `docs/implementation/v0.5.0-acceptance.md`
7. `docs/specs/2026-08-13-v0.4.0-confirmation-page-access-design.md`
8. `docs/implementation/v0.4.0-acceptance.md`
9. `docs/specs/2026-08-04-v0.3.0-protected-link-access-design.md`
10. `docs/implementation/v0.3.0-acceptance.md`

如果任务涉及 v0.2.0 中间页、过期时间、二维码、访问配置或继续访问路由，必须继续阅读：

1. `docs/specs/2026-08-02-v0.2.0-link-experience-design.md`
2. `docs/specs/short-links.md`
3. `docs/specs/redirect-modes.md`
4. `docs/specs/permissions.md`
5. `docs/specs/navigation-and-pages.md`

如果任务涉及 v0.1.1 控制台概览、个人短链聚合或最近短链，必须继续阅读：

1. `docs/superpowers/specs/2026-07-30-v0.1.1-console-overview-design.md`
2. `docs/product/scope-v0.1.1.md`
3. `docs/specs/navigation-and-pages.md`

如果任务涉及 v0.1.0 统计分析、短链访问事件、趋势、来源、设备或地区，必须继续阅读：

1. `docs/specs/statistics-and-events.md`
2. `docs/specs/short-links.md`
3. `docs/product/scope-v0.1.0.md`

如果任务涉及 v0.0.3 UI/UX 设计、主题、首页、控制台或短链生成入口，必须继续阅读：

1. `docs/superpowers/specs/2026-06-08-v0.0.3-ui-ux-redesign.md`
2. `docs/superpowers/specs/2026-06-30-v0.0.3-color-interaction-redesign.md`
3. `docs/product/scope-v0.0.3.md`

如果任务涉及 v0.0.2 已完成能力、既有 API、用户管理、短链筛选或验收口径，再继续阅读：

1. `docs/product/scope-v0.0.2.md`
2. `docs/implementation/v0.0.2-plan.md`
3. `docs/implementation/v0.0.2-tasks.md`
4. `docs/implementation/v0.0.2-acceptance.md`

如果任务涉及 v0.0.1 基础闭环、既有 API 或既有验收口径，再继续阅读：

1. `docs/implementation/v0.0.1-implementation-contract.md`
2. `docs/implementation/v0.0.1-engineering-plan.md`
3. `docs/implementation/v0.0.1-tasks.md`
4. `docs/implementation/v0.0.1-acceptance.md`

## 文档分层规则

- 产品方向、版本边界和路线图写入 `docs/product/`。
- 功能规格写入 `docs/specs/`。
- 技术决策、技术基线、实施计划、阶段任务和验收记录写入 `docs/implementation/`。
- 修改版本范围时，同步更新 `docs/README.md` 和相关产品文档。
- 修改技术栈、目录结构、API、数据库、测试或部署约定时，同步更新 `docs/implementation/technical-decision.md` 和 `docs/implementation/technical-baseline.md`。
- 不要把远期设想混入当前版本的必须实现范围。

## 技术栈规则

MoeURL 当前技术栈固定为：

- 后端： Go 1.25+、Chi、SQLC、Goose、PostgreSQL。
- 前端： Vue 3、Vite、TypeScript、Vuetify 4。
- 前端包管理： pnpm。
- 状态：Pinia、TanStack Query for Vue。
- 国际化：vue-i18n。
- 表单校验：vee-validate、zod。
- PWA：Web App Manifest、Service Worker。
- 测试：go test、testify、testcontainers-go、Vitest、Playwright。
- 部署：Docker、Docker Compose。

实现时遵循以下约束：

- 后端 API 使用 `/api/v1` 前缀。
- 后端 API 使用语义化路径，业务动作只使用 `GET` 和 `POST`，不使用 `PUT`、`PATCH`、`DELETE` 表达业务动作。
- API 业务成功和业务失败默认返回 HTTP `200`，通过统一数字 `code` 表达结果；`guest` 权限不足属于业务无权限，返回 `200` 和业务错误码；只有登录态无效、已登录用户基础访问控制失败和基础设施级错误使用 `401`、`403` 和 `500`。
- 短链访问路由使用 `/{slug}`，且优先级低于固定路由和 API 路由。
- 后端使用 Cookie Session + 服务端会话存储，不使用 JWT 作为主登录会话。
- 数据库 schema 变更必须通过 Goose migration。
- 数据库表名使用单数蛇形命名，用户表使用 `app_user`。
- 数据访问优先通过 SQLC 查询，不引入 GORM。
- 前端 UI 使用 Vuetify 4，并从初始化阶段建立 MoeURL 自定义主题，默认主题采用 Material Design 3 风格。
- 前端从 v0.0.1 开始支持 PWA 基础能力，但不缓存登录态 API、短链业务数据和权限相关响应。
- 前端服务端状态使用 TanStack Query，不长期塞入 Pinia。
- 不引入 Ant Design 系 UI。

## v0.0.3 UI 实施规则

- v0.0.3 只做 UI/UX 精细化重设计，不新增统计、访问密码、过期时间、中间页跳转、确认页跳转和二维码能力。
- v0.0.3 当前主题采用「雾蓝石墨」方向：浅色使用冷白、雾蓝和石墨文字，深色使用蓝黑、钢蓝表面和冰蓝主操作；少量铜橙只用于提醒、规划中标识和当前位置 rail。
- 主题 token 应集中接入 Vuetify 4 主题系统，并保留跟随系统、浅色模式和深色模式切换能力。
- 首页顶部导航视觉融入背景，不做独立背景的传统导航栏。
- 首页首屏以短链快速生成为视觉中心，下翻内容只做轻量产品介绍。
- 短链生成必须抽成可复用组件，首页 inline 展示，控制台桌面端 modal 展示，移动端 bottom-sheet 展示。
- 控制台桌面端采用左侧导航，移动端采用汉堡菜单和抽屉导航。
- 桌面端账号入口放在左侧导航底部；主内容区右上角只放页面级动作。
- 控制台导航可展示规划中占位入口，但页面必须明确标记能力边界，不展示假数据，不开放未实现表单或业务动作。
- 我的短链、全站短链、用户管理和创建用户页面应迁移到统一控制台 Shell。
- UI 精细化不得破坏 v0.0.2 已完成的权限、筛选、搜索、用户管理和 E2E 主流程。

## v0.1.0 统计实施规则

- v0.1.0 只做统计分析闭环，不实现访问明细、导出、访问密码、过期时间、中间页跳转、确认页跳转和二维码能力。
- v0.1.0 访问量只统计成功返回跳转响应的 `redirect_response_sent` 事件。
- 短链不存在、软删除、禁用或被访问条件拦截时，不计入访问量。
- `short_link_event` 保留 v0.0.4 的事件标识、短链 ID、事件类型和时间字段；v0.1.0 仅追加来源主机名、归类后的设备类型和可选国家代码等匿名分析维度，不保存原始 IP、完整 User-Agent 或完整 Referer。
- 分析页展示总访问量、今日访问量、最近访问时间、近 7 天趋势和三类维度聚合。
- 统计展示必须沿用既有权限边界：普通用户只能看到自己的短链统计，管理员可查看全站短链统计。
- 访问事件记录失败不得阻断短链跳转。

## v0.2.0 访问体验实施规则

- v0.2.0 只实现中间页跳转、可选过期时间、二维码和访问配置编辑，不实现访问密码、确认页、最大访问次数、二维码样式或模板管理。
- 跳转模式只允许 `direct` 和 `intermediate`；中间页倒计时范围为 3 至 10 秒，既有短链默认保持直接跳转和 5 秒默认值。
- `expires_at` 使用 `timestamptz`，为空表示无固定过期时间；服务端和数据库时间是创建、编辑与访问判断的权威来源。
- 中间页和过期时间分别受 `short_link:use_intermediate` 与 `short_link:set_expiration` 权限控制，前端省略无权字段，后端执行最终校验。
- 公开预览只返回短码、目标主机名、倒计时和可选过期时间，不返回完整目标 URL。
- 直接模式的 `/{slug}` 在成功写出目标 `302` 跳转响应后记录 `redirect_response_sent`；中间页入口不记录；`/go/{slug}/continue` 仅在成功写出目标跳转响应后记录。
- 二维码只编码公开短链 URL，在浏览器即时生成，不保存到数据库，也不包含目标 URL 或账号信息。
- `/go/{slug}` 和 `/go/{slug}/continue` 是固定路由，优先级必须高于 `/{slug}`，`go` 必须保留为不可生成短码。
- E2E 必须从真实 `/{slug}` 入口验证中间页和访问量，覆盖桌面与移动端的中间页、访问设置和二维码布局。生产构建允许既有基线的大分块警告，但禁止新增警告、扩大受影响分块范围或提高既有阈值；如采用等效规则，须经双方共同确认。

## v0.3.0 受保护短链实施规则

- v0.3.0 只实现访问密码、数据库一致失败限流和短期访问授权，不实现确认页、最大访问次数、标签、OIDC 或权限预设。
- 密码只保存 Argon2id 哈希；`password_hash`、原始密码和授权令牌不得出现在公开 API、日志、统计事件或前端状态中。
- 访问密码由 `short_link:set_password` 权限控制；创建和编辑请求省略密码字段时保留现有值，显式 `never` 才清除。
- 同一短链 15 分钟内连续 5 次失败后限流 15 分钟，失败窗口由数据库行锁保护，不能依赖进程内状态或未经验证的代理 IP 头。
- 解锁成功授权有效 15 分钟，令牌哈希存储于数据库，Cookie 必须 `HttpOnly`、`SameSite=Lax`，生产环境启用 `Secure`，Path 限定为 `/go/{slug}`。
- `Open`、`Preview`、`Continue` 都必须重新检查密码访问条件；浏览器页面通过同源 `/go/{slug}/preview` 读取路径作用域授权，密码修改通过 `password_updated_at` 使旧授权立即失效。
- 访问量仍只统计最终成功写出目标跳转响应的 `redirect_response_sent`；密码失败、限流和授权检查不得计入成功访问量，事件写入失败不得阻断访问流程。

## v0.4.0 确认页访问实施规则

- v0.4.0 只实现 `confirmation` 跳转模式和确认页访问闭环，不实现最大访问次数、风险审核、确认令牌、模板或权限预设。
- 确认页模式由 `short_link:use_confirmation` 权限控制；内置 `user`、`admin` 默认拥有，`guest` 不拥有。
- `redirect_mode` 允许 `direct`、`intermediate`、`confirmation`；既有短链保持原值，回滚时 confirmation 降级为 direct。
- 公开预览必须显式返回 `redirectMode`，只返回短码、目标主机名、模式、可选倒计时和过期时间，不返回完整目标 URL、密码状态或授权状态。
- 确认页复用 `/go/{slug}`，不自动跳转；密码解锁后按实际模式进入直接跳转、中间页倒计时或确认页。
- `/go/{slug}/continue` 必须重新检查状态、软删除、过期、模式和密码授权；无密码 direct 不得借 continue 绕过规范入口。
- `confirmation_clicked` 是非统计事件，进入或点击确认页不增加访问量；只有最终目标 `302` 成功写出后记录 `redirect_response_sent`。
- E2E 必须从真实 `/{slug}` 入口覆盖无密码和受密码保护确认页、主动继续、二次访问条件检查、访问量及桌面/移动布局。

## v0.5.0 用户组权限管理实施规则

- v0.5.0 展示 `guest`、`user`、`admin` 三个内置用户组，只编辑 `user` 和 `admin`；`guest` 在访客资源归属和滥用防护实现前固定为空权限并保持只读。
- v0.5.0 不实现自定义用户组、成员迁移、多用户组、域名授权、配额或审计日志。
- 权限目录必须覆盖当前全部权限常量；未知权限、重复权限和客户端声明的保护状态不得写入数据库。
- `admin:access`、`short_link:read_all`、`short_link:update_all`、`short_link:delete_all` 固定属于 `admin`，不得移除或授予其他内置组；业务逻辑仍必须逐项检查权限。
- `restricted`、`basic`、`standard` 预设只生成可配置权限集合，不成为新的授权层或数据库字段，套用后必须由管理员主动保存。
- 权限更新必须按 `key`、`builtin` 和 `updated_at` 执行乐观并发；冲突不得静默覆盖或自动重试写入。
- 权限保存成功后前端刷新用户组和 `auth/me`，后端后续请求继续直接从 `user_group.permissions` 解析，不增加跨请求缓存。
- `/admin/user/group` 必须替换为真实页面，覆盖加载、空数据、失败、冲突、成功和桌面/移动布局，不保留规划中标识或假操作。

## 实施原则

- 实施前先确认对应产品范围、功能规格和技术基线。
- 当前已完成版本以 `docs/product/overview.md` 和最新 `docs/product/scope-v*.md` 为准。
- 新版本、跨模块和生产化任务必须遵循 `docs/implementation/agent-delivery-guidelines.md`。
- 每个版本只实现对应范围文档中列入必须实现的内容。
- 远期能力只做必要的模型、接口或扩展点预留，不做完整 UI 和完整流程。
- 保持 YAGNI，避免为了远期能力提前引入过重抽象。
- 每个阶段都应有明确可验证的完成标准。
- 每个功能完成前应运行对应测试或手工验证。
- 涉及前端行为、重构或 UI 状态变化时，优先先写或更新测试，再实现代码。

## 核心产品约束

- 权限系统是核心边界，功能开放应通过权限表达。
- `admin` 用户组默认拥有最高权限，但业务逻辑仍应走权限判断。
- `guest` 是内置系统身份，不允许直接登录，不作为普通账号处理。
- 未登录访问者默认继承 `guest` 用户组权限。
- v0.0.1 默认不开放 `guest` 创建短链。
- 短码全系统唯一，不随短链访问域名重复。
- 短码只生成、保存和展示小写字母数字，访问查找按小写归一化值处理。
- 系统固定路由优先于短链短码路由。
- 短链删除采用软删除，短码不自动复用。
- v0.0.1 只要求实现直接跳转。

## 中文文档规范

- 中文语境使用全角标点。
- 中英文之间留空格。
- 中文与数字之间留空格。
- 技术名词、命令、代码和权限标识使用半角英文或代码格式。
- Markdown 标题层级不要跳级。
- 文档应直接服务产品理解和实施，不写无意义的兼容说明。

## Git 规则

- 本地提交是默认行为；`push`、合并及其他 Git 或远程集成操作需用户明确授权。
- 删除、重命名或大规模改写文档前，确认新结构已经能覆盖原有有效内容。
- 汇报变更时说明新增、修改和删除的文件，以及下一步建议。
