# 技术基线

2026-10-29 最终交付补记：v0.33.0 已由 PR231 合并为811d6c57，最终34a的PR CI40852026042及master CI40858639758各九成功，真实审查／有效意见闭环、标准Task1–4及最终归档清理完成，三个Minor在该版延期。原运行时及候选保持[验收](v0.33.0-acceptance.md)归属。当前[v0.33.1补丁](v0.33.1-plan.md)处于设计计划，仅清旧成功反馈、区分本次挂载与后台读取、修正文档；无新API／数据库／依赖／全局query策略，尚未实现或验证。下节本地阶段表述保留历史归属，本段最终证据优先。

2026-10-29 终审修复补充：新增首页文案 update 必须先解析并要求 `Content-Type: application/json`，允许合法参数及类型大小写；拒绝简单媒体类型，保留 `900204`／HTTP 200、no-store 和旧 DTO。真实 App／Session／PostgreSQL 回归以有效 CAS、Cookie 与同站不同源 Origin 检查拒绝后内容／完整版本／审计不变，并保留正常 JSON 对照；不以 CAS 代替请求意图。唯一终审 Important 的真实 RED→GREEN、新后端全门禁及 clean `be7b304` 浏览器／产品均通过，2 项 Minor 延期；原 `7836087` 制品仍只属原候选。

## v0.33.0 本地已验证的首页文案增量

新增 `site.home_content` 单键与 `00029` 非破坏迁移、专用仅键名审计及独立三 API：公开 `system/home-content` 与管理读／update。80／200 Unicode 码点，控制字符先拒后 trim；当前账号／builtin admin 组及两权限重查，五秒事务与账号→组→配置锁序，完整精度 CAS 先于 no-op。旧 settings DTO／revision 不变，SQLC 1.30 完整 52 源／24 生成零漂移。Task1 完整 Go／race／vet、业务 100% 与符号安全检查及 Task2 的 2094 测试／四 100%、lint／types／隔离构建均已标准完成。新候选 `be7b304` 的 718 运行时选择器输入另行实核，定向 4 项／完整 113 项浏览器、五原图、18178 标准 smoke 与同镜像正常更新数据库后的 HIGH／CRITICAL 三目标均 0。原物理输入与后继运行时选择器不同；各 SHA、Go／Node、镜像和漏洞库身份分别保留，Task3 终审／归档／标准完成已通过，Task4 远端仍待完成，见[设计](../specs/2026-10-29-v0.33.0-homepage-copy-design.md)和[验收](v0.33.0-acceptance.md)。

## v0.32.0 已合并的前端增量

三个本地固定二维码深色／白底 PNG 预设，320／M／margin4，身份变化恢复黑白，全部异步状态受 generationId 保护。无新依赖、API、权限或 schema；已由 PR #230 合并为99f87709，最终28214ef与master各九 CI 成功、真实审查及全部意见闭环、标准 Task1–4 和完整最终归档完成。原单元／静态仅c671加当时dirty前端，4／110browser／七图／image仅clean7b7315b，主机中断及恢复运行独立留证；未正式发布，见[设计](../specs/2026-10-29-v0.32.0-qr-appearance-presets-design.md)与[验收](v0.32.0-acceptance.md)。

## v0.31.0 已合并前端增量

v0.31.0 已由 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 合并为 `c6712051`，最终候选 `e9c3025` 的 CI40741884841 与合并自身 CI40748005532 各九成功，真实最终 CodeRabbit 覆盖、有效意见闭环；标准 Task1–4 和最终完整 SDD 归档已完成。仅 Google／手动创建草稿，未正式发布或验收外部 Google 互通；原阶段、原失败及各候选制品保持验收记录中的执行归属。见[验收](v0.31.0-acceptance.md)。

## v0.30.0 已合并增量

独立 strict/no-store 批量改组 API、当前数据库授权、全批事务／Session 撤销／审计及前端冻结确认／身份隔离均保持既有设计，无 schema、依赖或新权限。v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

## 1. 目标

本文档定义 MoeURL 的工程技术基线。所有后续实现、重构和实施计划都应以本文档为准。

v0.0.1 具体 schema、API、默认数据、标准命令和验收映射以 [v0.0.1 工程实施合同](./v0.0.1-implementation-contract.md) 为主执行入口。

技术基线服务以下目标：

- 让项目结构清晰，便于长期维护。
- 让 Go 后端、Vue 前端、数据库和部署方式有统一约定。
- 让后续 AI Agent 或开发者可以按一致规则实现功能。
- 降低技术栈不熟悉带来的理解成本。

## 2. 技术栈总览

| 层级 | 技术 |
| --- | --- |
| 后端语言 | Go 1.26.8+ |
| HTTP 路由 | Chi |
| 数据库 | PostgreSQL |
| 数据访问 | SQLC 1.30.0 |
| 数据库迁移 | Goose |
| 后端日志 | `log/slog` |
| 后端配置 | `cleanenv` 或同类库 |
| 密码哈希 | argon2id |
| 会话 | Cookie Session + 服务端会话存储 |
| 前端框架 | Vue 3 |
| 前端构建 | Vite |
| 前端包管理 | pnpm |
| 前端语言 | TypeScript |
| 前端路由 | Vue Router |
| 客户端状态 | Pinia |
| 服务端状态 | TanStack Query for Vue |
| UI 组件 | Vuetify 4 |
| 国际化 | vue-i18n |
| 表单 | vee-validate + zod |
| PWA | Web App Manifest + Service Worker |
| 后端测试 | go test + testify + testcontainers-go |
| 前端测试 | Vitest + Vue Testing Library + Playwright |
| 部署 | Docker + Docker Compose（支持裸机运行） |

当前以 Go 1.26.8+ 为最低语言版本，`go.mod` 声明为 Go 1.26.8。`Dockerfile` 的前端和后端构建阶段统一使用稳定镜像 `golang:1.27.3`，后端安全门禁使用 Go 1.26.10，修复标准库证书校验漏洞 [GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809)；自行构建也须使用对应 Go 分支的安全修复版本。构建和扫描工具链版本不提高项目的最低语言版本。生产镜像中的 Goose 固定为 v3.28.0，并在独立构建模块中将 `golang.org/x/net` 固定为 v0.60.0，避免迁移工具携带已修复的网络库漏洞。

Docker 前端构建从 Node 官方固定版本地址下载运行时，使用 HTTP/1.1、20 秒连接超时、单次 120 秒总超时和最多 2 次重试；保留 HTTPS 证书校验，不改版本、源站或基础镜像。该有界传输用于避免构建下载链路的 HTTP/2 停滞，不改变应用运行协议。

前端开发依赖安全维护同步 Vitest／coverage-v8 补丁，当前维护候选解析为 5.0.3；`@vitest/mocker` 不得保留低于 5.0.3 的受影响副本，source-map-js 至少 1.2.2、ini 至少 1.3.6。完整依赖路径、兼容子树更新及实际验收见[维护规格](../specs/2026-10-27-frontend-security-dependencies.md)和[维护验收](2026-10-27-frontend-security-dependencies-acceptance.md)。开发依赖公告与生产可达漏洞分开，registry 缺少 audit endpoint 是验证错误，不能当作零漏洞；必要时仅命令级指定官方 audit registry，不改全局配置。

`MOEURL_BUILD_COMMIT`／`MOEURL_BUILD_TAG` 的 ARG／ENV 只在复制前端源码之后、实际 `pnpm build` 之前声明，版本注入不使 Node 下载及锁文件依赖安装层随每次提交失效。构建与浏览器仍须验证实际 footer 和完整源码 URL，缓存复用不替代制品归属。

## 3. 仓库目录结构

建议采用单仓库结构：

```text
.
├─ cmd/
│  └─ server/
│     └─ main.go
├─ internal/
│  ├─ app/
│  ├─ config/
│  ├─ db/
│  ├─ http/
│  ├─ middleware/
│  ├─ auth/
│  ├─ oidc/
│  ├─ permission/
│  ├─ user/
│  ├─ usergroup/
│  ├─ domain/
│  ├─ shortlink/
│  ├─ insights/
│  ├─ system/
│  └─ event/
├─ migrations/
├─ queries/
├─ web/
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts
│  └─ src/
│     ├─ app/
│     ├─ pages/
│     ├─ widgets/
│     ├─ features/
│     ├─ entities/
│     └─ shared/
├─ docs/
│  └─ deployment/
├─ docker-compose.yml
├─ docker-compose.dev.yml
├─ Dockerfile
├─ scripts/
├─ go.mod
├─ go.sum
└─ sqlc.yaml
```

目录职责：

- `cmd/server/`：应用入口，只负责组装配置、依赖和启动服务。
- `internal/app/`：应用组装、依赖注入和生命周期管理。
- `internal/config/`：配置结构和环境变量读取。
- `internal/db/`：数据库连接、事务和 SQLC 生成代码承载位置。
- `internal/http/`：HTTP 路由注册、请求响应工具和错误映射。
- `internal/middleware/`：承载请求日志、请求 ID、panic 恢复、安全响应头和请求体限制。当前用户解析位于 `internal/auth/`，权限解析位于 `internal/permission/`。
- `internal/auth/`：登录、退出、会话、密码哈希。
- `internal/loginpolicy/`：读取和事务锁定本地登录策略，校验至少保留一个可用 OIDC 登录入口。
- `internal/oidc/`：OIDC provider 管理、Discovery、登录协议、外部身份供应、敏感值加密和登录尝试清理。
- `internal/permission/`：权限常量、权限计算和权限判断。
- `internal/user/`：用户账号、用户资料和管理员用户维护业务。
- `internal/usergroup/`：内置用户组权限目录、预设、并发更新和管理 API 业务。
- `internal/domain/`：v0.8.0 短链域名规范化、组授权、管理事务及 API；系统访问域名仍只由初始化配置。
- `internal/shortlink/`：短链创建、状态、软删除和访问跳转。
- `internal/insights/`：按当前数据库权限读取全站快照、匿名访问和审计，管理有界审计保留清理；业务写入的事务审计上下文位于 `internal/db/`。
- `internal/system/`：初始化流程、系统设置和站点配置。
- `internal/event/`：访问事件和操作记录扩展点。
- `migrations/`：Goose 数据库迁移文件。
- `queries/`：SQLC 查询定义。
- `web/`：Vue 前端应用。
- `docs/deployment/`：单机 Compose 部署、备份恢复、升级和灾难演练手册。
- `scripts/compose-smoke.sh`：隔离验证 production Compose 配置、初始化和重启保留边界。

## 4. 后端分层规则

每个业务模块建议按以下结构组织：

```text
internal/<module>/
├─ handler.go
├─ service.go
├─ model.go
├─ errors.go
└─ service_test.go
```

如模块变复杂，可以拆分为：

```text
internal/<module>/
├─ handler/
├─ service/
├─ model/
└─ test/
```

v0.0.1 优先使用简单结构，不为远期复杂度提前拆过细。

### Handler 层

职责：

- 解析 HTTP 请求。
- 调用 Service。
- 返回 JSON 或重定向响应。
- 将业务结果映射为统一响应体。

不应负责：

- 直接写数据库。
- 直接计算复杂权限。
- 直接实现业务流程。

### Service 层

职责：

- 执行业务规则。
- 调用 SQLC 查询。
- 执行权限判断。
- 管理事务边界。
- 返回明确业务错误。

短链、用户和用户组管理 Service 的生产权限解析共享数据库中的 `user_group.permissions`。每次需要授权的业务调用按当前用户 `GroupKey` 读取一次并形成权限快照，调用内的权限判断必须使用同一快照；不允许用编译期内置权限替代生产校验，不允许在权限读取失败时放行，也不允许用跨请求缓存延迟数据库撤权生效。静态权限解析器仅用于隔离测试；任一 Service 缺少权限 Resolver 时必须返回错误并拒绝授权，不得降级为静态权限，短链服务同时通过注入的 logger 记录装配错误。

### SQLC 查询层

职责：

- 承载 SQL 查询。
- 由 SQLC 生成类型安全 Go 方法。
- 不写业务判断。

## 5. API 约定

### v0.29.0 域名默认模式（已合并，尚未发布）

[设计](../specs/2026-10-28-v0.29.0-domain-default-redirect-mode-design.md)定义新独立 GET /api/v1/admin/domain/redirect-default?id=...、POST /api/v1/admin/domain/set-redirect-default 和 GET /api/v1/domain/redirect-defaults，均 no-store。模式三值、domain 共享完整版本、当前 DB 身份／双管理权限、锁后授权及事务审计；本人投影按当前创建／域名／模式权限过滤。旧 available／managed／create DTO 及省略 redirectMode=direct 不变。前端独立 coordinator 与三草稿互锁、身份 epoch、自动快照及手动优先已实现。PR #227 已合并为 8af05d60，最终 PR CI #40629796924 与合并 CI #40631422772 各九成功、实际最新审查闭环；尚未正式发布。E2E override 的 127.0.0.2／3 只为真实第二域名提供同一 owned app port 的 loopback 访问，不扩生产 Compose 或外网绑定。唯一终审、root 修复、本地逐候选门禁及原失败见[计划](v0.29.0-plan.md)和[验收](v0.29.0-acceptance.md)，不将原 image 归于后继文档或 merge。

### v0.28.0 用户组默认域名（已合并，未发布）

`00027` 为 builtin user／admin 增加可空 `user_group.default_domain_id`，共享组 `updated_at`；SQLC1.30 标准生成完整模型，旧严格组 DTO／权限请求不增加字段。新增 GET `/api/v1/admin/user-group/domain-default?groupKey=...`、POST `/api/v1/admin/user-group/set-domain-default` 及 GET `/api/v1/domain/group-default`，均 `no-store`。新管理检查当前 DB actor 的双管理权限及目标组候选交集，本人不可用 UUID 必须为 null。默认写先完整精度版本比较，再当前同值 no-op；旧权限同集合仍推进版本。

新旧组写采用 5 秒 domain 共享→当前账号共享→当前 builtin admin 排他→目标组排他，锁后重新授权；删除域名在原事务中 admin 优先清个人／组引用、推进版本和独立默认字段审计。前端双草稿共享版本，身份 epoch 隔离与安全 me 发布；手动／个人／组／全局／有序候选只影响面板初选，旧省略 `domainId` 仍全局。具体严格字段、错误码、事务／HTTP 编码失败差异、测试及交付状态见[设计](../specs/2026-10-27-v0.28.0-group-default-domain-design.md)和[验收](v0.28.0-acceptance.md)。技术栈、原覆盖率阈值和排除不变，无新增权限或依赖。

### v0.27.0 域名排序（已合并，未发布）

v0.27.0 [域名排序设计](../specs/2026-10-27-v0.27.0-domain-order-design.md)／[计划](v0.27.0-plan.md) 的前后端、事务授权修复及完整本地门禁已完成，PR #225 合并为 `8c024b5035226285ea76571c8b6a50ceb2d19440`；最终 `64751e5` 的 PR CI #40486914108 与新合并 CI #40493457478 各九成功，实际 CodeRabbit 覆盖最终且有效意见闭环。各阶段源码、运行时与制品保持独立归属，详见[验收](v0.27.0-acceptance.md)，未正式发布。

### v0.26.0 个人默认域名（已合并，未发布）

本人 GET /api/v1/user/domain-preference 与 POST /api/v1/user/domain-preference/update 使用独立表／版本，Cookie 本人归属及当前数据库授权交集；域名删除同事务清偏好／推进版本，前端身份 epoch 与明确选择优先，保留旧语言主题与创建省略语义。本地独立终审及有效修复、最终 PR #224 与新合并 60b36fec 的九项 CI、真实 CodeRabbit 均已闭环；各阶段制品和运行时独立，未正式发布。完整契约见[设计](../specs/2026-10-27-v0.26.0-personal-default-domain-design.md)，证据见[验收](v0.26.0-acceptance.md)。

### v0.25.0 操作审计导出

新增 `GET /api/v1/admin/audit/export`，仅接受 days 或成对 startDate／endDate 及 actorId／resourceType／action；拒绝分页、未知、重复和空参数，日期沿用最长 90 天 UTC。`AuditExportPort` 独立于列表端口，复用 insightService；5 秒只读 repeatable-read 内重查有效账号、`admin:access`、`audit:read`、`audit:export` 和数据库时间／180 天保留截止。MATERIALIZED 候选先校验 1000 行及原文 8 MiB（完整 changed_fields JSON 计入），通过后才回读；最终编码另限精确 UTF-8 8 MiB，不 count 全表或返回部分文件。

成功 `{fileName,contentType,content}`，文件名 `moeurl-audit-{startDate}-{endDate}.csv`、MIME `text/csv;charset=utf-8`，BOM／CRLF、固定 11 列、完整十进制 bigint、UTC RFC3339Nano、JSON 数组与公式中和。业务码 100001／120001／100002，基础设施 500／900000，响应 no-store。共享 `csv_export.go` 保持 visits 的 200120。`00024_audit_export_permission.sql` 仅补 builtin admin 缺失授权、已有权限不改 updated_at；Down 只撤销本次追加且未被独立编辑部分，不跟踪 INSERT 或删除业务／审计数据。

审计页使用已加载日期和已应用三筛选，第二页仍导出全量；三种草稿、刷新／失败禁用。身份、同步 cache 授权、父级 contextRevision 和卸载抑制旧结果；120001／401／403 复用全局授权恢复，100002 提示缩小范围。双语和原生 URL／节点清理复用既有工具。详细字段及验证状态见[设计](../specs/2026-10-27-v0.25.0-audit-export-design.md)与[验收](v0.25.0-acceptance.md)。

### v0.24.0 匿名访问记录导出

新增 `GET /api/v1/short-link/visits/export` 和 `GET /api/v1/admin/short-link/visits/export`。仅 id、days 或成对起止日期、deviceType、countryCode；规范非零 UUID、最多 90 个 UTC 日、拒绝分页及重复／未知／显式空值。独立 `short_link:export_visits` 与 read_visits、个人 read_own／owner 或 admin:access／read_all 取交集；同一 5 秒只读 repeatable-read 快照重新检查数据库有效账号、组授权、时间和未删除短链。

最多 1000 行，MATERIALIZED 候选至多 1001 条 ID／排序／bigint 文本长度；原始可变长文本与最终 UTF-8 CSV 分别限 8 MiB，超预算只返回哨兵，不拉取完整文本或返回部分文件。成功 `{fileName,contentType,content}`、固定 `text/csv;charset=utf-8` 与 `moeurl-visits-{id}-{startDate}-{endDate}.csv`；BOM／CRLF、固定 11 列机器字段、UTC RFC3339Nano、空单元格及公式中和。业务码 100001／120001／200104／200120，基础设施 500／900000，响应 no-store，日志仅安全类别／类型和 request_id。无目标、账号、原始 IP／UA／完整 Referer 或秘密。完整字段见[设计](../specs/2026-10-26-v0.24.0-visit-record-export-design.md)。

`00023_visit_export_permission.sql` 仅补内置 user／admin 缺失授权，已有权限不改 updated_at；按 UPDATE 修订跟踪，Down 保留既有、迁移后新增组和移除再重授予的权限，不删除事件。默认及 standard 包含，guest／basic／restricted 不包含。SQLC 1.30.0 与权限 fixture 仍只经标准入口生成，保持原业务与前端四项 100% 阈值。记录区域仅导出已加载实际范围／已应用筛选；分页不限制文件，未应用草稿、刷新、失败或迟到上下文禁止下载。

### v0.23.0 批量标签整理

`POST /api/v1/short-link/batch-tags` 与 `POST /api/v1/admin/short-link/batch-tags` 只接受严格单一 JSON：`items:[{id,expectedUpdatedAt}]`、`operation:add|remove|replace`、显式 `tags` 数组。1–100 条互异规范非零 UUID，版本为完整非零 RFC3339Nano。add／remove 输入 1–10 个，replace 0–10 个；裁剪后的每个标签 1–32 个 Unicode 字符，无重复、控制字符或无效 UTF-8，结果任一超过 10 个则整批拒绝。成功 `{changedCount,unchangedCount}` 合计请求数。

入口与 5 秒 `WithAuditTx` 内重查当前账号和数据库权限；个人要求 update_own + set_metadata + owner，后台要求 admin:access + update_all + set_metadata。锁序为用户共享锁 → 当前组共享锁 → UUID 排序短链更新锁，全量预检后只写 tags 与严格递增 updated_at；no-op 不写版本或审计。非法输入 100001、无权 120001、缺失／归属 200104、版本 200116、结果超量 200119，基础设施 HTTP 500／900000；响应 no-store，日志仅安全类别／类型和 request_id。

个人私有列表增加完整 `updatedAt`，不得经 JavaScript Date 截断后提交；公开 Preview 不返回版本，其他个人 DTO 未赋值时省略。前端共享 Vuetify 确认框，冻结快照、清空警示、草稿与确认、账号轮次、成功失效五类缓存，冲突后必须成功读到新列表才能重开；无新依赖、migration 或权限。新服务／Handler 与前端逻辑纳入原 100% 门禁；独立 Compose 浏览器覆盖个人与后台、跨用户拒绝、筛选和 390 像素实际滚动。契约及分阶段证据见[设计](../specs/2026-10-26-v0.23.0-batch-tags-design.md)与[验收](v0.23.0-acceptance.md)。

### v0.22.0 批量短链归属转移

`POST /api/v1/admin/short-link/batch-transfer` 使用严格单一 JSON：`items:[{id,expectedUpdatedAt}]` 和 `newOwnerUsername`，1–100 条不同规范非零 UUID 及非零 RFC3339Nano 版本。复用 `admin:access`、`short_link:update_all` 和 5 秒 `WithAuditTx`，用户 UUID → 当前组 → 短链 UUID 的锁序，全量数量及版本预检通过后才写入。任一冲突／缺失／审计故障整批回滚；同 owner 不写版本或审计。仅改变 owner_id 和单调 updated_at，无 migration／新权限。成功 `{transferredCount,unchangedCount}` 合计请求数，错误码沿用单条转移；严格媒体类型、no-store、安全诊断，详见[设计](../specs/2026-10-25-v0.22.0-batch-ownership-design.md)与[实际验收](v0.22.0-acceptance.md)。

### v0.21.0 短链清单导出

新增 `GET /api/v1/short-link/export` 与 `GET /api/v1/admin/short-link/export`，只接受 `status`、`q`、`tag`。叠加 `short_link:export` 及对应读取权限，同条 SELECT 快照重查账号／组授权与 owner_id，不逐页拼接或聚合访问事件。5 秒期限；MATERIALIZED 候选集最多保留 1001 条 ID／排序／原始文本字节数元数据，同语句先检查超过 1000 条或累计原始可变长文本超过 8 MiB，超限只返回空的 limit 哨兵，通过后才读取完整字段。读取预算覆盖原域名、短码、目标 URL、标题、tag 元素、状态、模式及所属用户名，求和前转 bigint；最终 CSV 另有精确 UTF-8 8 MiB 预算，任一超限整体返回 `200118`。少数经规范化缩小的集合也可能被读取预算拒绝，不改变既有 URL 写入限制。成功为固定文件名和 MIME 的 JSON 下载描述，BOM／CRLF／CSV 转义／公式中和；包含原域名短链 URL、目标及管理配置，不包含秘密和原始事件，详见 [设计](../specs/2026-10-24-v0.21.0-link-list-export-design.md)。

### v0.20.0 短链归属转移

新增 `POST /api/v1/admin/short-link/transfer`，严格请求字段为 `id`、`newOwnerUsername` 和 `expectedUpdatedAt`，成功返回 `{id, ownerId, updatedAt}`。管理列表新增完整精度 `updatedAt`。要求 `admin:access` 与 `short_link:update_all`，5 秒事务中按 UUID 锁定 actor／接收用户，再锁操作者组并重查数据库授权，最后锁短链校验版本。只更新 owner_id 和单调版本，与既有审计原子提交；同 owner no-op。200116 为版本冲突，200117 为接收账号不可用；缺失沿用 200104，参数与权限沿用 100001／120001。无新表／migration／权限，详细契约见 [设计](../specs/2026-10-23-v0.20.0-link-ownership-design.md)。

### v0.19.0 用户组成员迁移

新增 `POST /api/v1/admin/user/change-group`，请求为 `id`、`groupKey`（user／admin）及 `expectedUpdatedAt`，成功返回 `data.user`。沿用管理权限边界，事务内锁定并重查当前操作者和目标；保护 builtin／自身，同组 no-op，真实改组撤销目标全部旧会话并与 group_id 审计原子提交。用户列表／修改结果时间改为 RFC3339Nano，保留数据库版本精度。300105 表示用户版本冲突，300106 表示不允许改自己的组；300104 仍为账号偏好冲突。只接受单个 JSON 对象及已知字段，不新增表、migration 或依赖，具体见 [设计](../specs/2026-10-23-v0.19.0-user-group-membership-design.md)。

### 路径规范

API 使用 `/api/v1` 前缀：

```text
/api/v1/init/status
/api/v1/init/setup
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/auth/me
/api/v1/auth/password/status
/api/v1/auth/password/change
/api/v1/auth/methods
/api/v1/auth/oidc/{providerKey}/start
/api/v1/auth/oidc/{providerKey}/callback
/api/v1/system/public-config
/api/v1/short-link/create
/api/v1/short-link/overview
/api/v1/short-link/list
/api/v1/short-link/export
/api/v1/short-link/update
/api/v1/short-link/delete
/api/v1/short-link/batch
/api/v1/short-link/statistics
/api/v1/short-link/statistics/export
/api/v1/user/preferences
/api/v1/user/preferences/update
/api/v1/admin/short-link/list
/api/v1/admin/short-link/export
/api/v1/admin/short-link/update
/api/v1/admin/short-link/delete
/api/v1/admin/short-link/batch
/api/v1/admin/short-link/transfer
/api/v1/admin/short-link/batch-transfer
/api/v1/short-link/batch-tags
/api/v1/admin/short-link/batch-tags
/api/v1/admin/short-link/statistics
/api/v1/admin/short-link/statistics/export
/api/v1/admin/user-group/list
/api/v1/admin/user-group/update-permissions
/api/v1/admin/oidc/provider/list
/api/v1/admin/oidc/provider/create
/api/v1/admin/oidc/provider/update
/api/v1/admin/oidc/provider/delete
/api/v1/admin/system/settings
/api/v1/admin/system/settings/update
```

公开预览的规范入口为 `/go/{slug}/preview`；旧的 `/api/v1/public/short-link/preview` 仅保留为兼容入口并已弃用。

`GET /api/v1/short-link/overview` 返回当前用户拥有且未软删除短链的总数、启用数、总访问量和今日访问量。该接口使用 `short_link:read_own`，管理员调用时同样只返回个人数据；全站概览应使用后续独立的管理员接口。

短链访问路由不使用 API 前缀：

```text
/{slug}
/go/{slug}
/go/{slug}/preview
/go/{slug}/unlock
/go/{slug}/continue
```

固定前端路由、公开解锁与继续路由和 API 路由必须优先于短码路由。`/go/{slug}` 用于中间页、密码页和确认页 App Shell，`/go/{slug}/unlock` 用密码换取路径作用域授权，`/go/{slug}/continue` 在重新检查短链状态、过期时间、跳转模式和短期授权后写出最终目标跳转。Continue 的未知基础设施错误重定向到 `/go/{slug}?reason=continue-failed`，页面重新读取最小预览并等待手动重试；Open 和 Preview 的基础设施错误仍按原约定返回 HTTP 500。Vite 开发服务器只将 `/go/{slug}/preview`、`/go/{slug}/unlock` 和 `/go/{slug}/continue` 代理到后端，不能代理 `/go/{slug}` App Shell。

### API 风格

后端 API 使用语义化路径，业务动作通过路径表达，只使用 `GET` 和 `POST` 方法：

- `GET` 用于读取状态和列表。
- `POST` 用于创建、更新、删除、登录、退出和初始化等动作。
- 不使用 `PUT`、`PATCH`、`DELETE` 表达业务动作。

### JSON 响应格式

成功响应：

```json
{
  "code": 0,
  "message": "OK",
  "data": {},
  "meta": {}
}
```

业务失败响应：

```json
{
  "code": 200104,
  "message": "短链不存在",
  "data": null,
  "meta": {}
}
```

`message` 可以根据当前语言返回本地化文案。`code` 必须是稳定数字码，供前端判断。

### HTTP 状态码

- `200 OK`：应用层正常处理的业务成功和业务失败。
- `200 OK + code=120001`：`guest` 或登录用户在应用层权限判断中权限不足。
- `401 Unauthorized`：需要有效登录态但未提供、Cookie 无效或会话失效，用于前端自动跳转登录。
- `403 Forbidden`：已登录用户登录态有效，但基础访问控制失败。
- `500 Internal Server Error`：未进入应用层或未预期服务器错误。

除 `401`、`403` 和基础设施级 `500` 外，不通过 HTTP 状态码表达业务错误。

未登录访问者默认映射为内置 `guest` 身份。允许匿名进入应用层的接口应完成 `guest` 权限判断，并通过统一数字 `code` 表达权限不足。

### 错误码范围

| 范围 | 含义 |
| --- | --- |
| `0` | 成功。 |
| `100000`-`109999` | 通用请求、参数和校验错误。 |
| `110000`-`119999` | 认证和会话错误。 |
| `120000`-`129999` | 权限错误。 |
| `200000`-`299999` | 短链错误；域名管理业务错误仅使用 `210101`-`210105`。 |
| `300000`-`399999` | 用户错误。 |
| `900000`-`999999` | 系统和初始化错误。 |

v0.10.0 扩展既有短链 create、own/admin update、list 和 statistics 契约，不新增路由。创建接受可选 `maxVisits`，更新接受可选 `visitLimit`（`limited` + 整数或 `unlimited`）。管理响应统一返回 `maxVisits`、`visitsUsed`、`visitsRemaining`、`exhausted`，前端共享严格 Schema 校验其一致性。公开 Preview 不返回额度字段，Preview/Unlock 耗尽返回 HTTP `200` + `200115`，公开跳转使用 `reason=exhausted`。非法额度输入沿用 `100001`，缺少能力沿用 `120001`。

v0.14.0 的个人／管理员 statistics 支持 `days=7|30|90`（省略默认 7），或成对的 `startDate`、`endDate`。日期严格为 `YYYY-MM-DD`，按 UTC 包含首尾两天，最多 90 天且不包含未来日期；混用、缺项、重复参数和显式空值返回 `100001`。响应新增实际 `range` 与 `stats.rangeVisitCount`，趋势和来源／设备／国家维度使用该范围；全生命周期总量、今日量和最近访问时间仍保持概览含义。今日量按 UTC 日历计算。默认维度由全生命周期变为近 7 天，调用方应读取实际范围；既有列表和概览接口未改动。完整契约见 [日期范围设计](../specs/2026-10-15-v0.14.0-analytics-date-range-design.md)。

v0.15.0 增加 `user_preference`，按当前 Cookie 身份读取和更新语言／主题。读取未保存用户返回三个 null 字段；更新必须完整提供 `language`、`theme` 和 `expectedUpdatedAt`，字段可空，拒绝缺项、未知字段和尾随 JSON。`expectedUpdatedAt=null` 仅首次创建，其余版本精确比较；冲突返回 `300104`，输入／无权／基础设施沿用 `100001`／`120001`／`900000`，两端点 no-store。不存在管理员代改接口或新增权限，具体见 [账号偏好设计](../specs/2026-10-16-v0.15.0-account-preferences-design.md)。

v0.16.0 的 own／admin statistics/export 复用严格日期与统计读取逻辑，再叠加 `short_link:export_statistics`。成功返回 JSON 下载描述 `{fileName, contentType, content}`，MIME 固定 `text/csv;charset=utf-8`；失败仍用既有业务 envelope，响应 no-store。CSV 使用 BOM、CRLF、固定四列及公式注入保护，只有现有匿名聚合和公开短链 URL，不导出目标地址或原始事件。具体契约见 [导出设计](../specs/2026-10-16-v0.16.0-analytics-export-design.md)。

v0.17.0 批量管理新增个人／后台 `POST short-link/batch`，要求 `application/json` 媒体类型（允许合法参数），严格接受 1–100 个不同的非零 UUID 和 `enable`／`disable`／`delete` 动作，成功返回 `affectedCount`。缺失、错误或非 JSON 媒体类型在调用业务服务前返回 `100001`，防止同站跨源简单请求借登录 Cookie 执行批量写入。沿用现有写权限，单条 SQL 重查账号与数据库授权、按 UUID 锁定全部目标后检查数量，只有全部可操作才写入；无 schema 或权限迁移。状态赋值与软删除不改变其他访问条件、额度或元数据，详细契约见 [批量管理设计](../specs/2026-10-16-v0.17.0-bulk-link-management-design.md)。

v0.18.0 的只读 API 为 `GET /api/v1/admin/dashboard`、`GET /api/v1/{admin/}short-link/visits`、`GET /api/v1/admin/audit/list`。日期沿用上述 UTC 契约，分页默认 25、范围 1–100，cursor 最大 512 字节；拒绝未知、重复和显式空值，排序唯一且有界。仪表盘／审计分别要求 `admin:access` 加 `statistics:read_all`／`audit:read`；访问明细再叠加 `short_link:read_visits` 与原归属权限。审计 bigint ID 使用十进制字符串，UTC 时间不损失精度。所有响应 no-store，具体 DTO 见 [设计](../specs/2026-10-22-v0.18.0-analytics-audit-design.md)。

## 6. 数据库约定

### 命名规则

- 表名使用单数蛇形命名，例如 `app_user`、`short_link`。
- 字段使用蛇形命名，例如 `created_at`、`deleted_at`。
- 主键统一使用 `id`。
- 时间字段统一使用 `timestamptz`。
- 软删除字段统一使用 `deleted_at`。

### 推荐核心表

v0.0.1 至少包含：

- `app_user`
- `user_group`
- `domain`
- `short_link`
- `system_setting`
- `session`

后续版本可以预留：

- `operation_log`

后续预留表不属于 v0.0.1 必须创建的最小 schema；是否实际创建，取决于对应版本的工程计划。

v0.0.4 创建 `short_link_event` 表，用于持久化已成功写出跳转响应的短链事件，并支撑列表级基础统计。

### v0.0.1 最小 schema 摘要

v0.0.1 的字段级 schema 以 [v0.0.1 工程实施合同](./v0.0.1-implementation-contract.md#4-数据库-schema-合同) 为准。最小表结构必须覆盖：

- `system_setting`：保存站点名称、初始化状态、系统访问域名、默认短链访问域名、默认语言、默认主题、纯文本页脚、Powered by 兼容字段、本地登录策略和统一设置修订行。
- `user_group`：保存 `guest`、`user`、`admin` 用户组及其权限数组。
- `app_user`：保存本地用户、内置 `guest` 用户、主用户组、账号状态和密码哈希。
- `session`：保存加密随机会话 ID、过期时间、最近访问时间和撤销时间。
- `domain`：保存系统访问域名、短链访问域名、用途、启用状态和全局默认标记。
- `short_link`：保存创建者、域名、全系统唯一短码、目标 URL、状态和软删除时间。

关键约束：

- `user_group.key` 唯一。
- `app_user.username` 唯一。
- `domain.host` 唯一。
- `short_link.slug` 全系统唯一。
- `short_link.deleted_at` 用于软删除。
- 软删除后短码仍不释放。

### v0.0.4 schema 扩展摘要

v0.0.4 在 v0.0.1 最小 schema 之外新增：

- `short_link_event`：保存短链访问事件 ID、短链 ID、事件类型和创建时间。v0.0.4 只持久化用于基础统计的成功响应事件，不保存 IP、User-Agent、Referer 或地区信息。

v0.1.0 在 `short_link_event` 追加 `referrer_host`、`device_type` 和 `country_code`。这些字段只保存已规范化的聚合维度；原始 IP、完整 User-Agent 和完整 Referer 不进入数据库。`country_code` 仅在 `MOEURL_ANALYTICS_COUNTRY_HEADER` 配置后读取，部署者必须确保请求头来自可信反向代理。

v0.14.0 复用现有事件表和短链／时间索引，不新增 migration。统计范围转换为 UTC 半开时间区间，SQL 以原始 `created_at` 与类型化边界比较；每日序列最多 90 点并补零，不受数据库 Session 时区影响。区间访问量从每日计数求和，维度在同一日期范围内执行 top 10 与其他桶归并；仍只统计成功跳转事件。

### v0.2.0 schema 扩展摘要

v0.2.0 在 `short_link` 追加：

- `redirect_mode`：`direct` 或 `intermediate`，默认 `direct`。
- `intermediate_delay_seconds`：中间页倒计时，范围 3 至 10 秒，默认 5 秒。
- `expires_at`：可选 `timestamptz`，为空表示不设置固定过期时间。

过期是访问时根据数据库时间判断的动态状态，不复用 `disabled`，也不修改持久化状态。migration 同步为既有内置 `user`、`admin` 用户组追加 v0.2.0 权限，并在回滚时删除这些权限。

### v0.3.0 schema 扩展摘要

v0.3.0 在 `short_link` 追加 `password_hash`、`password_failed_attempts`、`password_window_started_at`、`password_blocked_until` 和 `password_updated_at`；新增 `short_link_access_grant` 保存短期授权令牌哈希。密码原文、密码哈希和授权令牌不得进入公开 API、日志、统计事件或前端状态，授权查询同时检查令牌过期时间和密码更新时间。解锁授权 Cookie 有效期为 15 分钟，必须设置 `HttpOnly` 和 `SameSite=Lax`，生产环境启用 `Secure`，并将 `Path` 限定为 `/go/{slug}`。过期授权清理由 `expires_at` 索引支撑，并由应用后台任务每分钟独立清理，每批最多删除 500 条；`short_link_id` 索引用于短链删除时的级联行定位，清理错误不影响解锁请求。`00006` 以 `NOT VALID` 添加密码失败次数约束，`00007` 在独立 migration 中验证历史数据，避免字段迁移事务扫描全部既有短链。migration 同步为既有内置 `user`、`admin` 用户组追加 `short_link:set_password`，`guest` 保持无权限。

### v0.4.0 schema 扩展摘要

v0.4.0 不新增数据列，只将 `short_link.redirect_mode` 的约束扩展为 `direct`、`intermediate`、`confirmation`。`00008 Up` 使用 `NOT VALID` 替换旧约束，并为内置 `user`、`admin` 用户组追加 `short_link:use_confirmation`；`00009 Up` 是兼容性重试步骤，正常 v8 路径已经由 `00008 Up` 完成约束替换，因此会跳过替换，只有检测到旧约束残留时才补做替换；`00010 Up` 在独立事务中验证新约束。正常回滚由 `00009 Down` 恢复 v8 状态的 `NOT VALID` 约束但不改写数据，随后由 `00008 Down` 将 confirmation 记录降级为 direct、清理 migration 实际新增的权限并恢复、验证旧约束。停在 v9 时可由 `00010 Up` 安全重试验证；停在 v8 时可安全重试 `00009 Up`（正常状态下跳过已完成的替换），再由 `00010 Up` 完成验证。权限跟踪表只移除 migration 实际新增且未被人工修改的权限。

### v0.5.0 权限管理数据约定

v0.5.0 复用 `user_group.permissions` 和 `user_group.updated_at`，不新增 schema 或 Goose migration。SQLC 增加三个内置用户组的稳定列表查询，以及按 `key`、`builtin = true`、`updated_at` 条件更新权限的查询。成功更新产生严格递增的 `updated_at`，并发请求使用旧值时返回零行，由 Service 映射为业务冲突，不能静默覆盖。

权限数组由服务端目录校验并按固定顺序编码。未知项、重复项、非内置用户组和受保护权限归属变化都不得写入数据库。更新查询只允许 `user` 和 `admin`；`guest` 在访客资源归属实现前固定为空权限并保持只读。权限预设不持久化为字段，只用于生成最终权限数组。

### v0.7.0 OIDC schema 扩展摘要

v0.7.0 新增 `oidc_provider`、`external_identity` 和 `oidc_login_attempt`。provider 保存经 Discovery 校验的端点、加密 Client Secret、精确邮箱域名白名单、启用状态、软删除时间和乐观并发时间戳；外部身份以 `(provider_id, subject)` 唯一绑定本地用户；登录尝试只保存 state/nonce 摘要、发起浏览器关联令牌的 `browser_binding_hash` 摘要、加密 PKCE verifier、受控站内返回路径和五分钟过期时间。callback 原子消费登录尝试，仅在一次性浏览器关联校验通过后继续，拒绝跨浏览器回调。

登录尝试通过 `DELETE ... RETURNING` 原子消费，过期记录每分钟执行至多 4 个 500 行批次并在短批次提前结束。首次身份供应在事务内使用 provider 与 subject 派生的 advisory lock，固定创建内置 `user` 组账号，不按邮箱自动连接既有用户。`00012 Down` 仅在不存在 external identity 时删除 OIDC schema；存在绑定时安全失败，避免不可逆丢失登录归属。

### v0.8.0 短链域名扩展摘要

`00013` 新增 `domain_user_group` 关系，并为已有默认短链域名及新初始化域名写入内置 `user`、`admin` 授权；`guest` 不获授权。升级只向原本拥有 `domain:use_default` 的组追加 `domain:use_assigned`，`domain:manage` 固定属于 `admin`。权限撤回跟踪只覆盖迁移实际新增且未被管理员后续改动的权限，Down 保留原有域名及短链。`domain.is_default` 是单一启用全局默认域名的权威来源，`system_setting` 中的地址镜像在相同事务内更新。

管理接口为 `GET /api/v1/admin/domain/list`、`POST /api/v1/admin/domain/{create,update,set-default,delete}`，登录用户的授权候选接口为 `GET /api/v1/domain/available`。创建短链可传 `domainId`；默认和显式选择分别需要对应权限与域名组授权。管理写入用 `expectedUpdatedAt` 进行乐观并发，引用过的域名不能改地址或删除，默认域名不能停用。已有短链的列表、更新和统计 URL 始终来自其保存的域名，不随默认值切换。

短链公开 `/{slug}`、公开预览、路径作用域预览、解锁和继续访问都比较请求的真实 `Host` authority 与关联域名并检查 `enabled`。错误 Host 或域名停用按短链不存在处理，恢复启用后原链接重新生效。代理必须保留外部 Host（含非默认端口），不信任 `X-Forwarded-Host`。该版本不自动管理 DNS、TLS 或现有短链迁移。

### v0.9.0 系统设置扩展摘要

`00014` 在既有 `system_setting` 中补齐 `site.footer_text`、`site.show_powered_by`、`auth.local_login_enabled` 和 `site.settings_revision` 默认值，并把受保护权限 `system:manage` 加入内置 `admin`。设置值继续使用 JSONB；`site.settings_revision.updated_at` 是管理页面完整草稿的统一乐观并发版本，单次更新在同一事务内写入全部可编辑键并推进统一时间戳。Down 保留设置键和管理员选择，只撤回 migration 实际新增且未被后续修改的权限；旧 App 不会消费保留的本地登录策略，回退必须按运维手册单独验收登录入口。v0.11.0 起页脚品牌署名固定展示，旧 `site.show_powered_by` 存储及 JSON 字段保留兼容，但服务端读取和写入都规范为 `true`，前端管理页不再提供关闭入口。

公开接口 `GET /api/v1/system/public-config` 只返回站点名称、默认语言、默认主题、页脚文本和固定为 `true` 的 Powered by 兼容字段。管理接口 `GET /api/v1/admin/system/settings` 与 `POST /api/v1/admin/system/settings/update` 同时要求 `admin:access` 和 `system:manage`；更新本地登录策略时先锁定策略行，并与 OIDC Provider 更新、停用和删除共享最终登录入口检查。本地登录关闭不撤销已有 Session，也不删除本地账号或密码；`GET /api/v1/auth/methods` 返回持久化后的真实状态。密码登录先受全局并发槽位和统一操作超时保护，再读取本地登录策略；策略关闭时在创建事务和执行 Argon2id 校验前拒绝。

### v0.11.0 标题与标签

`00016_short_link_metadata.sql` 为短链增加有界纯文本 `title` 和 `text[] tags`，默认空。标签用 GIN 索引支持精确包含过滤；不引入全局标签实体。create、own/admin update 接受可选 `metadata: {title, tags}`，省略保留、对象整体替换；管理响应返回顶层 `title`、`tags`，公开 Preview 和访问事件不返回。写入同时要求现有操作权限和 `short_link:set_metadata`。

own/admin list 的 `q` 匹配短码、目标地址、标题和标签的文字子串（最多 200 个 Unicode 字符），`tag` 区分大小写精确匹配一个标签（最多 32 个字符），与状态取交集；列表和计数共享相同条件。完整边界见 [设计](../specs/2026-10-13-v0.11.0-link-metadata-design.md)。Down 删除标题与标签，权限仅撤销本次迁移追加且未独立修改的授权；必须先备份。

### v0.10.0 访问次数额度

`00015_short_link_max_visits.sql` 添加 nullable `max_visits bigint` 与非空 `visits_used bigint default 0`。数据库约束限定 32 位正整数上限和非负用量，无限额用量必须为 0。允许降低上限后用量大于上限，剩余量派生为 `max(0, max_visits - visits_used)`；耗尽不修改 `status`。更新已有有限额保留用量，清除或重新启用重建周期；既有短链无限额且历史事件不回填。

有限额最终跳转使用最多 5 秒的事务，锁定短链行和共享锁域名行后通过第二条查询重读，重新验证 Host、状态、过期、模式和密码授权，再条件领取并提交。领取不推进 `updated_at`，也不退款；`302` 响应头可能在正文错误之前送达。默认无限额保持原只读路径和访问快照语义。异步 `redirect_response_sent` 统计仍独立且允许丢失。Down 删除额度数据，回滚影响必须由运维先确认。

### 短码规则

- v0.0.1 默认生成 6 位随机短码。
- 短码只允许小写字母和数字：`[a-z0-9]`。
- 系统生成、保存和展示的短码都使用小写。
- v0.12.0 创建接受可选 `customSlug`；省略或 `null` 保持随机生成，显式空字符串非法。先校验原始值为 3–32 位 ASCII 字母数字，再转小写，不去空格、不接受 Unicode 相似字。
- 短码唯一性、保留路径校验和访问查找都基于归一化后的小写值。

指定短码要求 `short_link:custom_slug`，创建事务在用户组共享锁下重查权限，和域名授权使用同一查询。指定值仅插入一次，slug 唯一约束冲突为 `200101`，保留路径为 `200102`，格式错误为 `100001`，缺权限为 `120001`；其他数据库错误不能伪装成占用或触发随机重试。短码跨域名唯一，软删除仍占用；不提供可用性探测、改码或复用。固定入口保留集合与完整契约见 [设计](../specs/2026-10-15-v0.12.0-custom-slugs-design.md)。

`00017_custom_slug_permission.sql` 只补权限及回滚追踪，不修改 `short_link.slug` 类型或约束。Down 仅撤销 migration 追加且之后未独立变更的授权，保留后来新增组的授权与全部短链数据；旧 App 可继续解析已保存的自定义短码。

### v0.15.0 账号偏好

`00018_user_preference.sql` 新增 `user_preference` 表，以 `user_id` 为外键主键、删除级联；`language`、`theme` 使用可空枚举约束，`updated_at` 为严格递增的并发版本。migration `00018` 不回填旧用户、不改动其资料修订时间；Down 删除账号偏好表，用户与会话不受影响，已保存偏好会丢失。

### v0.16.0 统计导出权限

`00019_analytics_export_permission.sql` 仅为内置 `user`／`admin` 追加缺失的 `short_link:export_statistics`，沿用 UPDATE 编辑追踪和修订号保护；Down 只撤销本次迁移追加且未再独立编辑的授权，不删除统计或短链数据。CSV 复用现有有界聚合查询，不新增统计表、索引或采集字段。

### 迁移规则

`00025_user_domain_preference.sql` 新增独立 `user_domain_preference`（账号主键级联删除、可空受保护域名引用及单调版本），无旧账号回填。域名删除在原事务先清偏好／推进版本再删除，保存共享同一域名锁并重查当前用户主组授权；独立本人 API 不修改 `user_preference` 或旧创建省略语义。Down 仅删除新表，个人域名偏好会丢失；镜像回退可以保留新表，但旧应用不会清理偏好外键，会拒绝删除被偏好引用的域名；不能当作完全兼容，恢复核查见[备份与恢复](../deployment/backup-and-restore.md)及[升级与回退](../deployment/upgrade-and-recovery.md)。

v0.18.0 的 `00020_insights.sql` 增加可空 browser／OS 类别、全局成功事件时间与未删除链接创建索引，以及三项真实权限和 UPDATE 编辑追踪；不回填虚构类别、不删除历史事件。`00021_audit.sql` 增加无业务级联外键的 `audit_log`、keyset／保留索引和审计白名单触发器。应用写入必须显式启用事务局部 actor 上下文，任何审计写入错误使业务一起回滚；no-op、访问额度领取、失败计数和偏好不产生审计噪音。

审计读取应用滚动 180 天截止时间，每小时清理最多 4×500 条，周期 10 秒且退出可取消。`00021 Down` 先阻止并发审计写入，再检查日志；非空时安全失败，空表可回滚／再次 Up。支持的应用回退保留兼容 schema，不提供在线清空审计的绕过步骤；备份保护和部署验收见 [升级与回退](../deployment/upgrade-and-recovery.md)。

- 每个 schema 变更都必须通过 Goose migration。
- migration 文件放在 `migrations/`。
- 查询 SQL 放在 `queries/`。
- 不允许手工修改线上数据库结构而不补 migration。

## 7. 权限约定

权限标识使用稳定字符串：

```text
short_link:create
short_link:read_own
short_link:update_own
short_link:delete_own
short_link:read_all
short_link:update_all
short_link:delete_all
domain:use_default
domain:use_assigned
domain:manage
system:manage
short_link:use_intermediate
short_link:use_confirmation
short_link:set_expiration
short_link:set_password
short_link:set_max_visits
short_link:set_metadata
short_link:custom_slug
short_link:export
short_link:export_visits
admin:access
```

权限判断必须同时覆盖：

- 前端页面展示。
- 后端 API 操作。
- 管理入口访问。

前端隐藏或置灰只用于体验，后端权限判断才是安全边界。

v0.5.0 将 `admin:access`、`short_link:read_all`、`short_link:update_all`、`short_link:delete_all` 设为权限配置写入的受保护集合；v0.8.0 增加 `domain:manage`，v0.9.0 增加 `system:manage`。这些权限必须属于 `admin`，`guest` 和 `user` 必须不拥有。该保护不替代业务授权；后台操作仍必须解析当前数据库权限快照并检查所需权限。

用户组权限管理写入必须使用乐观并发。权限更新成功后，前端刷新用户组查询和 `auth/me`；后端 Service 对后续业务请求直接读取数据库，不以刷新前端缓存作为安全保障。

### Cookie Session 安全规范

v0.13.0 新增 `GET /api/v1/auth/password/status`（`canChangePassword`）和 `POST /api/v1/auth/password/change`（当前密码、新密码，成功 `changed=true`）。接口只能作用于有效 Session 所属的启用非 guest 账号，纯 OIDC 账号不建立本地密码。两接口位于独立 no-store API 路由组，由服务直接验证 Cookie，不重复经过 CurrentUserMiddleware。修改成功在单事务中更新哈希、清除共享失败状态和撤销全部旧 Session；清除 Cookie 后重新登录。当前密码错误沿用 `110101`，限流 `110103`，无可修改凭据 `110105`；无效会话 HTTP 401，其余预期错误 HTTP 200。新密码为 8–128 个 Unicode 字符，原值处理；媒体类型、未知字段及额外 JSON 值均校验。锁序、并发和敏感数据边界见 [设计](../specs/2026-10-15-v0.13.0-password-change-design.md)。

- Cookie 名称：`moeurl_session`。
- Cookie 必须设置 `HttpOnly`。
- Cookie `SameSite` 使用 `Lax`。
- 生产环境必须设置 `Secure`。
- Cookie Path 使用 `/`。
- 登录成功后生成新的加密随机 session ID。
- 单个 Auth Service 使用容量为 8 的进程内登录事务准入槽位，并使用独立的容量为 2 的密码验证槽位；事务准入满额时不打开数据库事务，密码验证满额时不调用 Argon2id 校验器，两者均立即返回登录限流错误。
- 退出登录必须撤销服务端 session 并清理 Cookie。
- 每次授权操作必须重新检查用户状态和权限。
- 用户被禁用后，不得继续执行授权操作。
- v0.0.1 不要求单独实现 CSRF Token；默认依赖 `SameSite=Lax` 和 JSON API 边界，后续如开放跨站嵌入或第三方表单再补充 CSRF 机制。

OIDC start 和 callback 分别使用独立的进程内有界并发槽位。state、nonce 和 PKCE verifier 使用密码学安全随机源；state 仅以 SHA-256 摘要持久化且单次消费，nonce 在已验证 ID Token 后常量时间比较。外部身份登录成功后复用同一 `moeurl_session` Cookie、用户禁用检查和数据库权限解析。

本地登录策略由 `auth.local_login_enabled` 持久化。关闭本地登录要求事务内至少存在一个未删除、已启用、运行配置完整且 Client Secret 可用原始部署密钥解密的 OIDC Provider；不在持锁事务中执行 Discovery 网络请求。Provider 变更与设置更新使用同一策略行锁，防止并发移除最后登录入口；应用启动时再次校验该不变量。关闭开关只影响后续本地密码登录，不撤销现有 Session，不影响 Setup、Me、Logout 或 OIDC 登录。

## 8. 前端结构约定

前端使用轻量 Feature-Sliced Design 思路：

```text
web/src/
├─ app/
├─ pages/
├─ widgets/
├─ features/
├─ entities/
└─ shared/
```

目录职责：

- `app/`：应用启动、路由、全局 Provider、Vuetify、i18n 和 Query Client。
- `pages/`：路由页面，例如首页、登录页、我的短链页、管理页。
- `widgets/`：页面级组合组件，例如顶部导航、短链创建面板、短链列表。
- `features/`：用户操作能力，例如登录、创建短链、切换主题、切换语言。
- `entities/`：领域实体 UI 和类型，例如用户、短链、域名。
- `shared/`：通用 API 客户端、工具函数、基础组件和样式。

## 9. 前端数据约定

### API 客户端

前端应有统一 API 客户端，负责：

- 请求基础路径。
- JSON 编解码。
- 错误格式解析。
- 会话 Cookie 携带。

### 状态划分

- Pinia 保存当前用户、权限、语言、主题等客户端状态。
- TanStack Query 保存服务端查询结果和缓存。
- 表单局部状态留在组件或 vee-validate 中。

## 10. UI 和主题约定

UI 使用 Vuetify 4，并建立 MoeURL 自定义主题。

2026-10-14 视觉更新以 `app/vuetify.ts` 的浅深色 token 和 `app/theme.css` 的公共样式统一页面、控件与动效。应用只保留一个参与页面弹性布局的页脚；控制台固定侧栏不占用工作区页脚宽度。浏览器回归覆盖双语、深浅色、长站名和页脚、窄屏大数指标、导航上部创建入口、Escape 焦点恢复及减少动态效果，详见 [视觉规范](../specs/2026-10-14-ui-refresh-design.md) 和 [本地验收](2026-10-14-ui-refresh-acceptance.md)。

2026-10-15 列表调整使用 Vuetify `v-table` 展示短链、用户和最近短链，`v-list` 展示域名与 OIDC 提供商选择器，行操作使用 `v-menu`。表格保留服务端筛选与分页，窄屏只在表格容器内横向滚动，不增加当前页排序或重复分页。页脚仅 `V` 开头的构建版本文字链接到源码，`Powered by MoeURL` 保持普通文字。范围与验证见 [实施计划](2026-10-15-standard-lists-plan.md)。

当前配色以 [鸢尾蓝与薄荷青](../specs/2026-10-15-color-refresh-design.md) 为准，替代此前雾蓝石墨的色值；布局与动效保持既有规范。主色、辅助色、装饰色与语义色集中定义于 Vuetify，浅深色分别验证文字与操作对比度，PWA 默认色同步更新。验证见 [本地验收](2026-10-15-color-refresh-acceptance.md)。

应用级操作反馈由 `vue-sonner` 的单一 Toast 容器承载，可堆叠、自动消失且可单独关闭；成功、失败、冲突和表单校验摘要使用同一入口。字段错误与持久加载／重试状态保留在页面。显示文案按稳定业务码本地化，未知错误使用友好回退，不直接渲染 schema 或网络异常详情，详见 [主题与多语言](../specs/themes-and-i18n.md#操作反馈)。

主题方向：

- 接近 Material Design 3。
- 圆角柔和。
- 支持浅色和深色。
- 首页和状态页更有产品感。
- 管理页保持清晰，不做传统后台模板感。

v0.0.1 应至少定义：

- 主色。
- 辅助色。
- 背景色。
- 错误色。
- 浅色主题。
- 深色主题。
- 跟随系统模式。

默认主题应采用 Material Design 3 风格。v0.0.1 可以先写死 MoeURL 默认主题，不要求提供后台主题配置。

可验证要求：

- Vuetify 初始化配置中存在 MoeURL 自定义主题，不直接裸用 Vuetify 默认主题。
- 浅色和深色主题都定义主色、辅助色、背景色和错误色。
- 主题模式切换覆盖跟随系统、浅色模式和深色模式。
- 首页、登录页、我的短链页和短链状态页在浅色和深色模式下保持可读。

## 11. PWA 约定

前端从 v0.0.1 开始支持 PWA 基础能力。

阶段要求：

- 前端工程初始化阶段建立 `manifest`、图标、主题色和基础注册入口。
- UI 收尾阶段验证安装体验、移动端启动显示和静态资源缓存。

缓存策略：

- v0.0.1 只缓存 App Shell 和静态资源。
- 不缓存登录态 API、短链业务数据和权限相关响应。
- `/api/v1` 下经过身份解析的业务响应统一设置 `Cache-Control: no-store`；静态页面和资源不继承该响应头。
- Service Worker 更新后应能让用户获得新版本资源。

可验证要求：

- 浏览器可以识别 Web App Manifest。
- Manifest 包含应用名称、图标、启动 URL、显示模式和主题色。
- Service Worker 注册成功。
- Service Worker 不缓存 `/api/v1/*` 响应和短链跳转业务响应。
- 构建产物中的 App Shell 和静态资源可以按策略缓存。

## 12. 测试约定

### 后端测试

后端测试分为：

- 单元测试：纯业务函数，例如 URL 校验、短码生成、权限判断。
- 集成测试：数据库迁移、SQLC 查询、初始化流程、短链创建和访问。

推荐命令：

```bash
go test ./...
```

覆盖率门禁：

```bash
node --test scripts/go-coverage-threshold.test.mjs
go test -p=1 -count=1 -coverprofile="$PWD/coverage.out" ./internal/auth ./internal/db ./internal/domain ./internal/event ./internal/http ./internal/insights ./internal/loginpolicy ./internal/middleware ./internal/oidc ./internal/permission ./internal/shortlink ./internal/system ./internal/user ./internal/usergroup
node scripts/go-coverage-threshold.mjs "$PWD/coverage.out" 100 --include-from=scripts/go-coverage-targets.txt --exclude-blocks-from=scripts/go-coverage-excluded-blocks.txt
```

后端覆盖率门禁覆盖 `scripts/go-coverage-targets.txt` 中列出的业务源码文件，必须达到 100%。`scripts/go-coverage-excluded-blocks.txt` 只允许精确列出不可稳定触发或由数据模型保证不可达的代码块，例如事务中途基础设施失败、静态类型值的 JSON 编码失败。随机数失败、短码冲突重试和耗尽已有受控测试，不再排除。门禁必须拒绝未匹配的排除项，以及命中已执行代码块的排除项，避免旧坐标或多余豁免掩盖测试回退。数据库集成、进程入口和框架胶水仍通过 `go test ./...` 验证，但不作为业务源码覆盖率分母。

数据库集成测试优先使用 Testcontainers，并在同一 Go 测试进程内复用一个 PostgreSQL 容器。每个测试必须创建并在清理阶段删除独立数据库，不能复用业务数据。当前本机 Docker 不可用时，测试基础设施允许回退到本地 PostgreSQL 管理库，默认地址为 `postgres://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable`；也可通过 `MOEURL_TEST_POSTGRES_ADMIN_URL` 覆盖。需要强制验证 Docker 路径时设置 `MOEURL_TEST_REQUIRE_DOCKER=1`，Docker daemon 不可用必须直接使测试失败，不得回退。

CI 必须设置 `MOEURL_TEST_REQUIRE_DOCKER=1`。全仓普通测试执行 `go test -p=2 -count=1 ./...`，race 执行 `go test -race -p=2 -count=1 ./...`，覆盖率保持上述 `-p=1`；限制的是包级并行度，不跳过包、用例或并发行为断言，避免同时启动过多容器导致有界 Docker 探测超时。

数据库测试使用 `docker version --format '{{.Server.Version}}'` 探测服务端，避免依赖较重的 `info` 接口及其格式化输出的失败退出行为；探测使用独立的 30 秒超时，容器启动仍为 60 秒。探测失败在要求 Docker 的 CI 中必须直接失败，不能跳过测试或回退本地数据库。

SQLC 生成文件必须使用文件头声明的版本重新生成，并保持零手工漂移。当前版本使用 SQLC `1.30.0`，可通过以下命令验证：

```bash
docker run --rm -v "$PWD:/src" -w /src sqlc/sqlc:1.30.0 generate
git diff --exit-code -- internal/db/sqlc
test -z "$(git ls-files --others --exclude-standard -- internal/db/sqlc)"
```

### 前端测试

前端测试分为：

- 单元测试：工具函数、表单校验、状态处理。
- 组件测试：登录表单、短链创建表单、列表操作。
- E2E 测试：初始化、登录、创建短链、访问短链、禁用短链。

推荐命令：

```bash
cd web && pnpm test
cd web && pnpm test:coverage
cd web && pnpm build
cd web && pnpm test:e2e
```

前端单元和组件测试覆盖率门禁针对 `vitest.config.ts` 中 `coverage.include` 覆盖的应用配置、实体 API、页面组件和共享工具代码执行，必须达到 100%。`main.ts` 启动入口、类型声明和纯类型模型由构建、类型检查和 E2E 覆盖，不计入单元覆盖率门禁。

v0.2.0 将新增的短链创建、访问配置和二维码组件纳入覆盖率门禁。v0.3.0 还将密码设置、公开解锁和密码页纳入覆盖率门禁；v0.4.0 继续将确认模式权限矩阵、公开预览契约和确认页状态纳入门禁。v0.5.0 已将权限目录、预设、独立草稿、保护规则、冲突恢复和用户组管理页面纳入门禁。测试必须验证敏感数据不泄露、错误/限流/成功状态、授权失效、确认页不自动跳转和权限更新即时生效，不允许只断言 mock 调用次数。

Playwright E2E 默认通过 `web/playwright.config.ts` 启动 Docker Compose 测试环境。E2E 必须使用独立的 Compose project name，默认名称由 `MOEURL_E2E_PORT` 和每次配置加载时生成的随机后缀组成，也可通过 `MOEURL_E2E_COMPOSE_PROJECT` 显式指定；最终名称必须使用带非空后缀的 `moeurl-e2e-` 保留前缀，生产和日常开发 project 不得使用该命名空间。E2E 通过 `MOEURL_E2E_PORT` 隔离应用宿主端口，并为内部 PostgreSQL 生成本次运行专用密码；默认 Compose 不再映射 PostgreSQL 宿主端口。E2E 显式以 `MOEURL_ENV=development` 运行测试应用，避免本地 HTTP 流程受 Secure Cookie 影响。全局 teardown 只接受该保留前缀并对本次 project 执行 `down -v --remove-orphans`；不得清理日常生产或开发数据库卷。

初始化 UI 流程由 `web/e2e/initialize.setup.ts` 的 Playwright `setup` project 先执行；业务 spec 依赖该 project 后可并行运行，受保护访问 spec 仍在文件内显式串行。

当 Docker Desktop 不可用，或隔离 Compose 环境因外部镜像仓库不可用而无法拉取、构建或启动时，可先记录原始失败命令和错误，再用干净数据库、当前 Go 实现和当前 `web/dist` 启动本机服务，设置 `MOEURL_E2E_SKIP_DOCKER=1` 和对应的 `MOEURL_E2E_PORT` 执行 `pnpm test:e2e`。该回退不得用于绕过应用构建、迁移或启动错误，只跳过 Playwright 的环境拉起步骤，不跳过任何浏览器断言；执行者必须确保数据库从未初始化状态开始，并在验收记录中写明 Docker 状态、端口、环境变量和完整命令。

v0.2.0 访问体验 E2E 必须覆盖真实 `/{slug}` 入口、进入中间页前访问量为 0、继续路由目标 `302`、真实 UI 继续访问后访问量为 1，以及过期访问不增加访问量。v0.3.0 还必须覆盖真实密码页、错误密码、有效授权、密码变更吊销旧授权和访问量口径。v0.4.0 还必须覆盖无密码与受密码保护确认页、主动继续、二次访问条件检查和最终访问量。v0.5.0 还必须覆盖真实用户组页面、权限保存前后差异、后端动态撤权、基线恢复和双视口布局。v0.7.0 还必须使用本地签名测试 IdP 覆盖 provider 创建、首次与重复登录、域名拒绝、停用和本地登录回归。中间页、密码页、确认页、访问设置、二维码对话框和管理页面必须同时在 `1280 x 720` 与 `390 x 800` 视口验证控件顺序、操作区几何和横向溢出；异步流程使用条件等待，不允许使用固定 `waitForTimeout`。

v0.8.0 多域名 E2E 使用隔离 Compose 数据库和两个 loopback authority，验证授权、创建选择、错误 Host、切换默认后旧 URL 保持、停用及重新启用。只要存在短链引用（包括软删除和未产生访问记录的短链），所属域名就不能删除；全局 teardown 只清理本次独立 project。目标公网 DNS/TLS 的可达性和代理 Host 保真必须在真实部署环境另行验证。

v0.9.0 系统设置 E2E 在单个隔离场景中创建并清理专用 OIDC Provider，验证品牌、页面标题、页脚、默认语言和默认主题、本地登录关闭、最后 Provider 保护、现有 Session 保留、OIDC 首次与重复登录，以及本地登录恢复。测试不得依赖其他 spec 创建的 Provider、用户或设置状态；清理失败不得覆盖场景原始错误。公开配置解析、偏好优先级、设置草稿与冲突、权限守卫和登录方式错误状态继续纳入前端单元覆盖率门禁。

v0.12.0 自定义短码 E2E 在桌面与手机视口验证真实创建、小写预览、公开大写入口跳转、占用和保留字错误、失败草稿保留、清空后随机创建；独立撤权场景验证后端拒绝、页面隐藏与随机路径保留，并恢复原用户组权限。Compose smoke 另检查指定短码规范化、重复创建拒绝和重启后地址持久化；脚本配置通过不代表完整容器场景已执行。

### 质量检查工作流

v0.24.0 真实下载验收使用隔离 Compose 账号、链接及公开 302 写出的匿名事件，不 mock 产品 API。Playwright 的 Docker-enabled webServer 环境固定 `MOEURL_ANALYTICS_COUNTRY_HEADER=X-MoeURL-E2E-Country`，仅本 runner 的公开 fixture 请求发送该头以验证已知国家；其他请求仍未知，生产 Compose 默认值不变。定向／完整运行无需手工设置国家头环境变量。完整 E2E／runner 配置与 bundle／后端／部署输入分别冻结，构建 HEAD／tag 注入和精确 image ID 另行记录，源文件相同不证明不同提交注入的制品字节相同。

GitHub Actions 使用单个 `Check Code` 工作流文件。该工作流包含 9 个互相独立的并行任务：

- `Lint`
- `Typecheck`
- `Test`
- `Test Coverage`
- `Backend Security`
- `E2E`
- `Build`
- `Image Security`
- `Compose Smoke`

工作流支持手动触发，在提交到 `master` 和面向 `master` 的 PR 时触发。外部贡献者 PR 是否自动运行由仓库 Actions 安全策略控制，工作流本身不使用 `pull_request_target`。

## 13. 部署约定

v0.6.0 的首个生产支持边界为单机 Docker Compose + 外部 TLS 反向代理，详细步骤见 [单机 Docker Compose 部署](../deployment/single-host-compose.md)。该边界不包含内置代理、高可用、Kubernetes 或跨主机故障转移。

部署结构为：

```text
moeurl-app
moeurl-postgres
```

Go 服务负责：

- 提供 `/api/v1/*` API。
- 托管前端静态资源。
- 处理前端 SPA fallback。
- 处理短链跳转。
- 处理 `/go/{slug}` 中间页 App Shell 和 `/go/{slug}/continue` 最终跳转。

前端构建产物应复制到 Go 服务镜像中。

标准部署命令必须先按 [单机 Docker Compose 部署](../deployment/single-host-compose.md) 校验绝对 `DEPLOY_ROOT`，并初始化固定 Compose 文件、环境文件和 project 的 `production_compose` helper：

```bash
production_compose config >/dev/null
production_compose up --build -d
```

默认 Compose 要求显式提供原始 `MOEURL_POSTGRES_PASSWORD` 和完整、已编码的 `MOEURL_DATABASE_URL`，不得在 Compose 中把原始密码拼接进 URI。PostgreSQL 不映射宿主机端口；App 默认仅绑定 `127.0.0.1:8080`，以 UID/GID `10001:10001` 运行，并启用只读根文件系统、`/tmp` tmpfs、init、readiness healthcheck 和 `unless-stopped` 重启策略。App 的 `stop_grace_period` 固定为 20 秒，必须长于应用内部 15 秒统一关闭期限。production 还由应用启动校验强制要求 `MOEURL_SETUP_TOKEN`。外部 TLS 代理负责公网 HTTPS、HSTS、可信转发头和登录、初始化、公开解锁端点的来源级限流。

单机私有 Compose 网络只允许受信容器加入，默认数据库连接明确接受 `sslmode=disable`。数据库链路经过不受信网络时必须在 `MOEURL_DATABASE_URL` 中选择 `sslmode=verify-full`，并为 App 提供可验证的服务端证书信任链；默认 Compose 不管理 PostgreSQL 证书或 CA 生命周期。

默认 Compose 项目的 PostgreSQL 数据保存在命名卷 `postgres-data` 中，挂载点保持为 `/var/lib/postgresql`。普通 `up`、`down` 和再次启动不得重置数据库、管理员账号或短链数据；`down -v` 会永久删除目标 project 的数据库，执行前必须确认 project 并验证卷外备份。本地确需直连数据库时显式叠加 `docker-compose.dev.yml`，该覆盖只把 PostgreSQL 绑定到宿主机回环地址。

逻辑备份使用 PostgreSQL 自定义格式并保存到卷外；恢复必须先在隔离数据库或隔离 Compose project 验证 migration 版本、内置组、管理员登录、样例短链和访问配置。详细流程见 [备份与隔离恢复](../deployment/backup-and-restore.md) 和 [升级、回退与灾难恢复](../deployment/upgrade-and-recovery.md)。

v0.9.0 部署验收还必须核对公开品牌配置、管理设置、本地登录状态和 OIDC Provider 集合。数据库备份已包含 `system_setting` 和 provider 配置，但不包含 `.env` 中的原始 OIDC 加密密钥；恢复启用了 OIDC 或关闭本地登录的数据库时，必须同步恢复原始密钥并确认至少一个 Provider 可用，否则 App 会拒绝启动。回退到不理解 `auth.local_login_enabled` 的旧镜像前必须单独评估登录策略：旧版本可能重新开放本地密码入口，也可能无法维持 v0.9.0 的最后 Provider 保护，不能把镜像回退视为策略等价。

裸机运行时应先完成以下步骤：

- 准备 PostgreSQL 数据库。
- 使用 Goose 执行 `migrations/` 下的数据库迁移。
- 使用 pnpm 构建 `web/dist`。
- 设置 `MOEURL_ENV`（`development` 或 `production`）、`MOEURL_DATABASE_URL`、`MOEURL_HTTP_ADDR` 和 `MOEURL_STATIC_DIR`。
- 运行 `go run ./cmd/server` 或构建后的后端二进制。

## 14. 环境变量约定

当前应用实际读取的环境变量：

```text
MOEURL_ENV
MOEURL_HTTP_ADDR
MOEURL_DATABASE_URL
MOEURL_STATIC_DIR
MOEURL_ANALYTICS_COUNTRY_HEADER
MOEURL_SETUP_TOKEN
MOEURL_PUBLIC_BASE_URL
MOEURL_OIDC_ENCRYPTION_KEY
```

Compose 还读取 `MOEURL_HTTP_HOST`、`MOEURL_HTTP_PORT` 和 `MOEURL_POSTGRES_PASSWORD`，并把必填的 `MOEURL_DATABASE_URL` 原样注入 App；只有叠加开发覆盖文件时才读取 `MOEURL_POSTGRES_HOST` 与 `MOEURL_POSTGRES_PORT`。其中数据库密码是 PostgreSQL 容器初始化值，数据库 URL 是 Go 应用的完整连接配置，两者不得混为自动拼接关系。production 的 `MOEURL_SETUP_TOKEN` 至少为 32 个字符，初始化完成后仍必须保留用于后续启动校验。

OIDC 运行时配置成对出现：`MOEURL_PUBLIC_BASE_URL` 是无用户信息、路径、查询和片段的公网 HTTPS Origin，development 仅允许回环 HTTP；`MOEURL_OIDC_ENCRYPTION_KEY` 是 Base64 编码的 32 字节长期部署密钥。未使用 OIDC 时两项可同时留空；一旦数据库存在启用的 provider，缺少任一项都会使应用启动失败。加密密钥必须随生产秘密独立备份，不能只备份 PostgreSQL。

敏感配置不得提交到仓库。

## 15. 文档同步规则

修改技术栈、目录结构、API 约定、数据库约定、权限约定或部署方式时，必须同步更新：

- [技术选型决策](technical-decision.md)
- [v0.0.1 工程实施计划](v0.0.1-engineering-plan.md)
- [v0.0.1 任务级实施清单](v0.0.1-tasks.md)
- [AGENTS.md](../../AGENTS.md)

## 16. Agent 自主交付约定

当任务涉及新版本设计、跨模块功能开发、生产化交付，或用户要求 Agent 独立完成设计、文档、开发、测试和提交时，必须遵循 [Agent 自主交付规范](agent-delivery-guidelines.md)。

该规范是通用工程工作法，不承载具体版本需求。具体版本的产品范围、功能规格、实施计划、任务清单和验收记录仍按本文档的文档分层规则分别维护。
