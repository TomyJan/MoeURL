# 技术基线

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
| 后端语言 | Go 1.25+ |
| HTTP 路由 | Chi |
| 数据库 | PostgreSQL |
| 数据访问 | SQLC |
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
| UI 组件 | Vuetify 3 |
| 国际化 | vue-i18n |
| 表单 | vee-validate + zod |
| PWA | Web App Manifest + Service Worker |
| 后端测试 | go test + testify + testcontainers-go |
| 前端测试 | Vitest + Vue Testing Library + Playwright |
| 部署 | Docker + Docker Compose（支持裸机运行） |

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
│  ├─ permission/
│  ├─ user/
│  ├─ domain/
│  ├─ shortlink/
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
├─ docker-compose.yml
├─ Dockerfile
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
- `internal/middleware/`：日志、恢复、会话、当前用户、权限等中间件。
- `internal/auth/`：登录、退出、会话、密码哈希。
- `internal/permission/`：权限常量、权限计算和权限判断。
- `internal/user/`：用户、用户组和用户资料相关业务。
- `internal/domain/`：系统访问域名和短链访问域名相关业务。
- `internal/shortlink/`：短链创建、状态、软删除和访问跳转。
- `internal/system/`：初始化流程、系统设置和站点配置。
- `internal/event/`：访问事件和操作记录扩展点。
- `migrations/`：Goose 数据库迁移文件。
- `queries/`：SQLC 查询定义。
- `web/`：Vue 前端应用。

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

### SQLC 查询层

职责：

- 承载 SQL 查询。
- 由 SQLC 生成类型安全 Go 方法。
- 不写业务判断。

## 5. API 约定

### 路径规范

API 使用 `/api/v1` 前缀：

```text
/api/v1/init/status
/api/v1/init/setup
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/auth/me
/api/v1/short-link/create
/api/v1/short-link/list
/api/v1/short-link/update
/api/v1/short-link/delete
/api/v1/admin/short-link/list
/api/v1/admin/short-link/update
/api/v1/admin/short-link/delete
```

短链访问路由不使用 API 前缀：

```text
/{slug}
```

固定前端路由和 API 路由必须优先于短码路由。

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
| `200000`-`299999` | 短链错误。 |
| `300000`-`399999` | 用户错误。 |
| `400000`-`499999` | 域名错误。 |
| `900000`-`999999` | 系统和初始化错误。 |

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

可以预留：

- `short_link_event`
- `operation_log`

预留表是否在 v0.0.1 实际创建，取决于工程计划；但相关字段和接口边界应保留。

### v0.0.1 最小 schema 摘要

v0.0.1 的字段级 schema 以 [v0.0.1 工程实施合同](./v0.0.1-implementation-contract.md#4-数据库-schema-合同) 为准。最小表结构必须覆盖：

- `system_setting`：保存站点名称、初始化状态、系统访问域名、默认短链访问域名、默认语言和默认主题。
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

### 短码规则

- v0.0.1 默认生成 6 位随机短码。
- 短码只允许小写字母和数字：`[a-z0-9]`。
- 系统生成、保存和展示的短码都使用小写。
- 后续如开放自定义短码，输入应先归一化为小写再校验和保存。
- 短码唯一性、保留路径校验和访问查找都基于归一化后的小写值。

### 迁移规则

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
admin:access
```

权限判断必须同时覆盖：

- 前端页面展示。
- 后端 API 操作。
- 管理入口访问。

前端隐藏或置灰只用于体验，后端权限判断才是安全边界。

### Cookie Session 安全规范

- Cookie 名称：`moeurl_session`。
- Cookie 必须设置 `HttpOnly`。
- Cookie `SameSite` 使用 `Lax`。
- 生产环境必须设置 `Secure`。
- Cookie Path 使用 `/`。
- 登录成功后生成新的加密随机 session ID。
- 退出登录必须撤销服务端 session 并清理 Cookie。
- 每次授权操作必须重新检查用户状态和权限。
- 用户被禁用后，不得继续执行授权操作。
- v0.0.1 不要求单独实现 CSRF Token；默认依赖 `SameSite=Lax` 和 JSON API 边界，后续如开放跨站嵌入或第三方表单再补充 CSRF 机制。

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

UI 使用 Vuetify 3，并建立 MoeURL 自定义主题。

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
go test ./internal/auth ./internal/db ./internal/http ./internal/permission ./internal/shortlink ./internal/system ./internal/user -coverprofile="$PWD/coverage.out"
node scripts/go-coverage-threshold.mjs "$PWD/coverage.out" 100
```

后端测试覆盖率必须达到 100%。未达到 100% 时，CI 应失败。

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

前端单元和组件测试覆盖率必须达到 100%。未达到 100% 时，CI 应失败。

### 质量检查工作流

GitHub Actions 使用单个 `Check Code` 工作流文件。该工作流包含 5 个互相独立的并行任务：

- `Lint`
- `Typecheck`
- `Test`
- `Test Coverage`
- `Build`

工作流支持手动触发，在提交到 `master` 和面向 `master` 的 PR 时触发。外部贡献者 PR 是否自动运行由仓库 Actions 安全策略控制，工作流本身不使用 `pull_request_target`。

## 13. 部署约定

生产部署优先使用 Docker Compose，同时支持裸机运行：

```text
moeurl-app
moeurl-postgres
```

Go 服务负责：

- 提供 `/api/v1/*` API。
- 托管前端静态资源。
- 处理前端 SPA fallback。
- 处理短链跳转。

前端构建产物应复制到 Go 服务镜像中。

标准本地部署命令：

```bash
docker compose up --build
```

该命令应启动应用服务和 PostgreSQL，并允许通过 `/api/v1/health` 验证服务状态。

裸机运行时应先完成以下步骤：

- 准备 PostgreSQL 数据库。
- 使用 Goose 执行 `migrations/` 下的数据库迁移。
- 使用 pnpm 构建 `web/dist`。
- 设置 `MOEURL_DATABASE_URL`、`MOEURL_HTTP_ADDR` 和 `MOEURL_STATIC_DIR`。
- 运行 `go run ./cmd/server` 或构建后的后端二进制。

## 14. 环境变量约定

建议环境变量：

```text
MOEURL_ENV
MOEURL_HTTP_ADDR
MOEURL_DATABASE_URL
MOEURL_SESSION_SECRET
MOEURL_PUBLIC_BASE_URL
MOEURL_DEFAULT_LANGUAGE
MOEURL_DEFAULT_THEME
```

敏感配置不得提交到仓库。

## 15. 文档同步规则

修改技术栈、目录结构、API 约定、数据库约定、权限约定或部署方式时，必须同步更新：

- [技术选型决策](technical-decision.md)
- [v0.0.1 工程实施计划](v0.0.1-engineering-plan.md)
- [v0.0.1 任务级实施清单](v0.0.1-tasks.md)
- [AGENTS.md](../../AGENTS.md)
