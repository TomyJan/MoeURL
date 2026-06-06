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
| 后端语言 | Go |
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
| 前端语言 | TypeScript |
| 前端路由 | Vue Router |
| 客户端状态 | Pinia |
| 服务端状态 | TanStack Query for Vue |
| UI 组件 | Vuetify 3 |
| 国际化 | vue-i18n |
| 表单 | vee-validate + zod |
| 后端测试 | go test + testify + testcontainers-go |
| 前端测试 | Vitest + Vue Testing Library + Playwright |
| 部署 | Docker + Docker Compose |

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
- 将业务错误映射为 HTTP 状态码。

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
/api/v1/short-links
/api/v1/short-links/{id}
/api/v1/admin/short-links
```

短链访问路由不使用 API 前缀：

```text
/{slug}
```

固定前端路由和 API 路由必须优先于短码路由。

### JSON 响应格式

成功响应建议：

```json
{
  "data": {},
  "meta": {}
}
```

错误响应建议：

```json
{
  "error": {
    "code": "short_link.not_found",
    "message": "短链不存在"
  }
}
```

`message` 可以根据当前语言返回本地化文案。`code` 必须稳定，供前端判断。

### HTTP 状态码

- `200 OK`：查询或操作成功。
- `201 Created`：资源创建成功。
- `204 No Content`：删除、退出登录等无响应体操作成功。
- `400 Bad Request`：请求格式或参数错误。
- `401 Unauthorized`：未登录或会话失效。
- `403 Forbidden`：已登录但无权限。
- `404 Not Found`：资源不存在。
- `409 Conflict`：短码冲突、初始化重复等状态冲突。
- `422 Unprocessable Entity`：业务校验失败。
- `500 Internal Server Error`：未预期服务器错误。

## 6. 数据库约定

### 命名规则

- 表名使用复数蛇形命名，例如 `users`、`short_links`。
- 字段使用蛇形命名，例如 `created_at`、`deleted_at`。
- 主键统一使用 `id`。
- 时间字段统一使用 `timestamptz`。
- 软删除字段统一使用 `deleted_at`。

### 推荐核心表

v0.0.1 至少包含：

- `users`
- `user_groups`
- `domains`
- `short_links`
- `system_settings`
- `sessions`

可以预留：

- `short_link_events`
- `operation_logs`

预留表是否在 v0.0.1 实际创建，取决于工程计划；但相关字段和接口边界应保留。

### v0.0.1 最小 schema 摘要

v0.0.1 的字段级 schema 以 [v0.0.1 工程实施合同](./v0.0.1-implementation-contract.md#4-数据库-schema-合同) 为准。最小表结构必须覆盖：

- `system_settings`：保存站点名称、初始化状态、系统访问域名、默认短链访问域名、默认语言和默认主题。
- `user_groups`：保存 `guest`、`user`、`admin` 用户组及其权限数组。
- `users`：保存本地用户、内置 `guest` 用户、主用户组、账号状态和密码哈希。
- `sessions`：保存服务端会话、过期时间、最近访问时间和撤销时间。
- `domains`：保存系统访问域名、短链访问域名、用途、启用状态和全局默认标记。
- `short_links`：保存创建者、域名、全系统唯一短码、目标 URL、状态和软删除时间。

关键约束：

- `user_groups.key` 唯一。
- `users.username` 唯一。
- `domains.host` 唯一。
- `short_links.slug` 全系统唯一。
- `short_links.deleted_at` 用于软删除。
- 软删除后短码仍不释放。

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
- 登录成功后生成新的 session ID。
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

## 11. 测试约定

### 后端测试

后端测试分为：

- 单元测试：纯业务函数，例如 URL 校验、短码生成、权限判断。
- 集成测试：数据库迁移、SQLC 查询、初始化流程、短链创建和访问。

推荐命令：

```bash
go test ./...
```

### 前端测试

前端测试分为：

- 单元测试：工具函数、表单校验、状态处理。
- 组件测试：登录表单、短链创建表单、列表操作。
- E2E 测试：初始化、登录、创建短链、访问短链、禁用短链。

推荐命令：

```bash
cd web && npm run test
cd web && npm run build
cd web && npm run test:e2e
```

## 12. 部署约定

生产部署优先使用 Docker Compose：

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

## 13. 环境变量约定

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

## 14. 文档同步规则

修改技术栈、目录结构、API 约定、数据库约定、权限约定或部署方式时，必须同步更新：

- [技术选型决策](technical-decision.md)
- [v0.0.1 工程实施计划](v0.0.1-engineering-plan.md)
- [v0.0.1 任务级实施清单](v0.0.1-tasks.md)
- [AGENTS.md](../../AGENTS.md)
