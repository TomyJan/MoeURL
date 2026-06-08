# MoeURL

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

## 功能概览

- 首次初始化站点和管理员账号。
- Cookie Session + 服务端会话存储。
- 内置 `guest`、`user`、`admin` 用户组和权限判断。
- 创建、查看、筛选、禁用和软删除短链。
- 管理员全站短链管理、用户创建和用户维护入口。
- 短链直接跳转，短码全系统唯一。
- Vue 3 + Vuetify 3 前端，支持主题、国际化和 PWA 基础能力。

## 技术栈

- 后端：Go、Chi、SQLC、Goose、PostgreSQL。
- 前端：Vue 3、Vite、TypeScript、Vuetify 3。
- 状态：Pinia、TanStack Query for Vue。
- 包管理：pnpm。
- 测试：go test、Vitest、Playwright、testcontainers-go。
- 部署：Docker、Docker Compose，也支持裸机运行。

## 文档

- [文档总览](./docs/README.md)
- [产品总览](./docs/product/overview.md)
- [v0.0.2 范围](./docs/product/scope-v0.0.2.md)
- [技术选型决策](./docs/implementation/technical-decision.md)
- [技术基线](./docs/implementation/technical-baseline.md)
- [v0.0.2 验收清单](./docs/implementation/v0.0.2-acceptance.md)

## 环境要求

- Go 1.25 或更高版本。
- Node.js 26.x。
- pnpm 11.5 或更高版本。
- PostgreSQL 18 或兼容版本。
- Docker 和 Docker Compose（用于容器运行、E2E 和集成测试）。

## Docker 运行

```bash
docker compose up --build
```

如果宿主机 `8080` 已被占用，可以临时指定宿主端口：

```bash
$env:MOEURL_HTTP_PORT="18080"
docker compose up --build
```

启动后访问：

```text
http://localhost:8080
http://localhost:8080/api/v1/health
```

如果设置了 `MOEURL_HTTP_PORT`，请把示例中的宿主端口替换为该变量的值。例如 `MOEURL_HTTP_PORT=18080` 时访问：

```text
http://localhost:18080
http://localhost:18080/api/v1/health
```

停止并清理本地数据卷：

```bash
docker compose down -v
```

当前 Compose 使用 PostgreSQL 18，数据卷挂载在 `/var/lib/postgresql`。如果从旧的本地测试卷升级后启动失败，可先确认不需要保留本地测试数据，再执行 `docker compose down -v` 清理卷后重试。

## 裸机运行

先准备 PostgreSQL，并创建数据库：

```bash
createdb moeurl
```

构建前端静态资源：

```bash
cd web
pnpm install --frozen-lockfile
pnpm build
cd ..
```

执行数据库迁移：

```bash
go install github.com/pressly/goose/v3/cmd/goose@v3.26.0
goose -dir migrations postgres "postgres://moeurl:moeurl@127.0.0.1:5432/moeurl?sslmode=disable" up
```

启动后端服务：

```bash
$env:MOEURL_ENV="development"
$env:MOEURL_HTTP_ADDR=":8080"
$env:MOEURL_STATIC_DIR="web/dist"
$env:MOEURL_DATABASE_URL="postgres://moeurl:moeurl@127.0.0.1:5432/moeurl?sslmode=disable"
go run ./cmd/server
```

Linux/macOS 使用同名环境变量即可：

```bash
MOEURL_ENV=development \
MOEURL_HTTP_ADDR=:8080 \
MOEURL_STATIC_DIR=web/dist \
MOEURL_DATABASE_URL='postgres://moeurl:moeurl@127.0.0.1:5432/moeurl?sslmode=disable' \
go run ./cmd/server
```

## 开发调试

后端开发服务：

```bash
go run ./cmd/server
```

前端开发服务：

```bash
cd web
pnpm dev
```

前端开发服务器默认监听 `5173`，并将 `/api` 请求代理到 `http://127.0.0.1:8080`。

## 质量检查

v0.0.2 发布前应至少运行本节全部命令。首次运行 Docker 或 E2E 时可能需要较长时间，必须等待命令明确完成后再记录结果。

后端检查：

```bash
gofmt -l .
go vet ./...
go test ./...
$coverageProfile = Join-Path (Get-Location) "coverage.out"
go test ./internal/auth ./internal/db ./internal/http ./internal/permission ./internal/shortlink ./internal/system ./internal/user "-coverprofile=$coverageProfile"
node scripts/go-coverage-threshold.mjs $coverageProfile 100 --include-from=scripts/go-coverage-targets.txt --exclude-blocks-from=scripts/go-coverage-excluded-blocks.txt
```

Linux/macOS：

```bash
go test ./internal/auth ./internal/db ./internal/http ./internal/permission ./internal/shortlink ./internal/system ./internal/user -coverprofile="$PWD/coverage.out"
node scripts/go-coverage-threshold.mjs "$PWD/coverage.out" 100 --include-from=scripts/go-coverage-targets.txt --exclude-blocks-from=scripts/go-coverage-excluded-blocks.txt
```

后端覆盖率门禁覆盖 `scripts/go-coverage-targets.txt` 中列出的业务源码文件，并通过 `scripts/go-coverage-excluded-blocks.txt` 精确排除少量不可稳定触发的基础设施、防御性和事务中途失败代码块；门禁口径内必须达到 100%。

前端检查：

```bash
cd web
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

端到端测试：

```bash
cd web
pnpm test:e2e
```

如果宿主机 `8080` 已被其他服务占用，可使用临时端口：

```bash
cd web
$env:MOEURL_E2E_PORT="18080"
pnpm test:e2e
```

项目要求后端和前端测试覆盖率均达到 100%。当前 CI 已配置覆盖率门禁，未达到 100% 时会失败。

Docker Compose 验证：

```bash
docker compose up --build
```

启动后访问：

```text
http://localhost:8080/api/v1/health
http://localhost:8080/setup
```

如果通过 `MOEURL_HTTP_PORT` 指定了宿主端口，请使用对应端口访问。例如 `MOEURL_HTTP_PORT=18080` 时访问 `http://localhost:18080/api/v1/health` 和 `http://localhost:18080/setup`。

`/api/v1/health` 应返回 `code` 为 `0` 且 `status` 为 `ok` 的响应。未初始化环境访问 `/setup` 应进入首次初始化流程。
