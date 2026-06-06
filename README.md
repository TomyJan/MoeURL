# MoeURL

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

当前项目处于 v0.0.1 工程开发阶段，优先目标是完成基础可用闭环：首次初始化、本地登录、权限判断、创建短链、管理短链和访问短链直接跳转。

## 当前实现状态

v0.0.1 基础闭环已进入验收收尾阶段。当前 feature 分支已经覆盖以下自动化路径：

- 首次初始化。
- 登录后识别当前用户，并支持退出登录。
- `guest` 首页无权限提示和禁用创建入口。
- 首页创建短链，并提供复制、打开和继续创建入口。
- 我的短链列表展示、复制、打开、禁用和删除基础操作。
- 管理员全站短链列表和基础管理操作。
- Docker Compose 下的端到端基础流程。

最终发布前仍需对照 [v0.0.1 验收清单](./docs/implementation/v0.0.1-acceptance.md) 完成逐项确认。

## 文档入口

- [文档总览](./docs/README.md)
- [产品总览](./docs/product/overview.md)
- [v0.0.1 范围](./docs/product/scope-v0.0.1.md)
- [v0.0.1 工程实施合同](./docs/implementation/v0.0.1-implementation-contract.md)
- [v0.0.1 任务级实施清单](./docs/implementation/v0.0.1-tasks.md)
- [v0.0.1 验收清单](./docs/implementation/v0.0.1-acceptance.md)

## v0.0.1 目标技术栈

- Go 版本：Go 1.25 或更高版本。
- 后端：Go 1.25+、Chi、SQLC、Goose、PostgreSQL。
- 前端：Vue 3、Vite、TypeScript、Vuetify 3。
- 前端包管理：pnpm。
- 状态：Pinia、TanStack Query for Vue。
- PWA：Web App Manifest、Service Worker。
- 测试：go test、testify、testcontainers-go、Vitest、Playwright。
- 部署：Docker、Docker Compose。

## 开发命令

后端测试：

```bash
go test ./...
```

前端测试和构建：

```bash
cd web && pnpm test
cd web && pnpm build
```

端到端测试：

```bash
cd web && pnpm test:e2e
```

本地 Docker Compose 部署：

```bash
docker compose up --build
```

启动后可以通过以下地址验证服务状态：

```text
http://localhost:8080/api/v1/health
```

## 环境变量

后端服务使用以下核心环境变量：

```text
MOEURL_ENV=development
MOEURL_HTTP_ADDR=:8080
MOEURL_DATABASE_URL=postgres://...
MOEURL_STATIC_DIR=web/dist
```

Docker Compose 会自动配置 PostgreSQL 连接和静态资源目录。
