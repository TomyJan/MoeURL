# MoeURL

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

当前已完成到 v0.5.0 用户组权限管理闭环：在短链管理、统计分析和三种跳转模式基础上，管理员可以查看三个内置用户组，并通过稳定权限目录、三个预设和乐观并发安全编辑 `user`、`admin` 权限。v0.6.0 的生产就绪代码实现已完成，目标部署形态为单机 Docker Compose + 外部 TLS 反向代理；目标运行时、安全扫描、真实容器 smoke、隔离恢复和远程 CI 证据补齐前，版本仍处于生产验收阶段。

## 功能概览

- 首次初始化站点和管理员账号。
- Cookie Session + 服务端会话存储。
- 内置 `guest`、`user`、`admin` 用户组和权限判断。
- 创建、查看、筛选、禁用和软删除短链。
- 管理员全站短链管理、用户创建和用户维护入口。
- 内置用户组权限管理，支持 `restricted`、`basic`、`standard` 预设、受保护管理权限和并发冲突提示。
- 控制台个人概览、最近短链和个人昵称设置。
- 短链支持直接跳转、中间页和确认页三种模式，短码全系统唯一。
- 支持可选过期时间、访问配置编辑和浏览器即时生成二维码。
- 支持 Argon2id 访问密码、短链级数据库一致失败限流和 15 分钟短期访问授权。
- 确认页模式的创建和编辑受 `short_link:use_confirmation` 权限控制；该权限不控制访客在密码解锁后的继续访问，解锁后仍等待访问者主动继续。
- continue 路由会重新检查状态、软删除、过期、模式和密码授权；无密码 direct 短链不允许通过 Continue 绕过规范入口，只有最终目标 `302` 成功写出后才计入访问量。
- 短链列表展示总访问量、今日访问量和最近访问时间。
- 按短链展示近 7 天趋势、来源、设备和地区聚合，不保存原始 IP、完整 User-Agent 或完整 Referer。
- Vue 3 + Vuetify 4 前端，支持主题、国际化和 PWA 基础能力。

## 技术栈

- 后端：Go、Chi、SQLC、Goose、PostgreSQL。
- 前端：Vue 3、Vite、TypeScript、Vuetify 4。
- 状态：Pinia、TanStack Query for Vue。
- 包管理：pnpm。
- 测试：go test、Vitest、Playwright、testcontainers-go。
- 部署：生产支持单机 Docker Compose + 外部 TLS 反向代理；开发环境可裸机运行。

## 文档

- [文档总览](./docs/README.md)
- [产品总览](./docs/product/overview.md)
- [v0.6.0 范围](./docs/product/scope-v0.6.0.md)
- [v0.6.0 生产就绪设计](./docs/specs/2026-08-29-v0.6.0-production-readiness-design.md)
- [v0.6.0 实施计划](./docs/implementation/v0.6.0-plan.md)
- [v0.6.0 详细实现计划](./docs/implementation/v0.6.0-detailed-plan.md)
- [v0.6.0 任务级实施清单](./docs/implementation/v0.6.0-tasks.md)
- [v0.6.0 验收清单](./docs/implementation/v0.6.0-acceptance.md)
- [单机 Docker Compose 部署](./docs/deployment/single-host-compose.md)
- [PostgreSQL 备份与隔离恢复](./docs/deployment/backup-and-restore.md)
- [升级、回退与灾难恢复](./docs/deployment/upgrade-and-recovery.md)
- [v0.5.0 范围](./docs/product/scope-v0.5.0.md)
- [v0.5.0 用户组权限管理设计](./docs/specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)
- [v0.5.0 实施计划](./docs/implementation/v0.5.0-plan.md)
- [v0.5.0 任务级实施清单](./docs/implementation/v0.5.0-tasks.md)
- [v0.5.0 验收清单](./docs/implementation/v0.5.0-acceptance.md)
- [v0.4.0 范围](./docs/product/scope-v0.4.0.md)
- [v0.4.0 确认页访问设计](./docs/specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)
- [v0.4.0 实施计划](./docs/implementation/v0.4.0-plan.md)
- [v0.4.0 验收清单](./docs/implementation/v0.4.0-acceptance.md)
- [v0.3.0 范围](./docs/product/scope-v0.3.0.md)
- [v0.3.0 受保护短链访问设计](./docs/specs/2026-08-04-v0.3.0-protected-link-access-design.md)
- [短链规格](./docs/specs/short-links.md)
- [跳转模式规格](./docs/specs/redirect-modes.md)
- [统计与事件规格](./docs/specs/statistics-and-events.md)
- [技术选型决策](./docs/implementation/technical-decision.md)
- [技术基线](./docs/implementation/technical-baseline.md)

## 环境要求

- Go 1.25 或更高版本。
- Node.js 26.x。
- pnpm 11.5 或更高版本。
- PostgreSQL 18 或兼容版本。
- Docker 和 Docker Compose（用于容器运行、E2E 和集成测试）。

## Docker 运行

默认 Compose 面向单机生产拓扑：PostgreSQL 不映射宿主机端口，App 默认只绑定 `127.0.0.1:8080`，由外部 TLS 反向代理提供公网 HTTPS、HSTS 和来源级限流。生产使用前请完整阅读 [单机 Docker Compose 部署](./docs/deployment/single-host-compose.md)。

先创建权限受限的 `.env`，并为数据库密码和初始化 Token 生成独立的至少 32 字符随机值。`.env.example` 只提供变量入口，不提供可用的默认秘密：

```bash
set +x
umask 077
{
  printf 'MOEURL_ENV=production\n'
  printf 'MOEURL_HTTP_HOST=127.0.0.1\n'
  printf 'MOEURL_HTTP_PORT=8080\n'
  printf 'MOEURL_POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
  printf 'MOEURL_SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)"
} > .env
chmod 600 .env
```

```bash
docker compose --env-file .env config >/dev/null
docker compose --env-file .env up --build -d
docker compose --env-file .env ps
```

启动后在宿主机检查 readiness：

```bash
curl --fail http://127.0.0.1:8080/api/v1/health/ready
```

通过外部 HTTPS 入口访问 `/setup`，使用 `.env` 中的初始化 Token 完成首次配置。初始化后仍需保留 `MOEURL_SETUP_TOKEN`，production 启动会继续校验它。

停止容器但保留数据库数据：

```bash
docker compose --env-file .env down
```

本地开发确需直连 PostgreSQL 时，显式叠加开发覆盖文件；数据库仍只绑定本机回环地址：

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml up --build
```

普通 `down` 和再次启动会保留 `/var/lib/postgresql` 上的命名卷。`docker compose down -v` 会永久删除目标 project 的管理员、短链和全部数据库内容；只有在核对 project、验证卷外备份并明确需要销毁数据时才能执行。备份与恢复步骤见 [PostgreSQL 备份与隔离恢复](./docs/deployment/backup-and-restore.md)，升级步骤见 [升级、回退与灾难恢复](./docs/deployment/upgrade-and-recovery.md)。

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
go install github.com/pressly/goose/v3/cmd/goose@v3.27.3
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

前端开发服务器默认监听 `5173`，并将 `/api` 请求以及 `/go/{slug}/preview`、`/go/{slug}/unlock`、`/go/{slug}/continue` 数据路由代理到 `http://127.0.0.1:8080`。`/go/{slug}` 页面本身仍由 Vite App Shell 提供。

## 质量检查

当前阶段合并前应至少运行本节全部命令。首次运行 Docker 或 E2E 时可能需要较长时间，必须等待命令明确完成后再记录结果。

后端检查：

```powershell
gofmt -l .
go vet ./...
go test ./...
$coverageProfile = Join-Path (Get-Location) "coverage.out"
node --test scripts/go-coverage-threshold.test.mjs
go test -p=1 -count=1 "-coverprofile=$coverageProfile" ./internal/auth ./internal/db ./internal/event ./internal/http ./internal/middleware ./internal/permission ./internal/shortlink ./internal/system ./internal/user ./internal/usergroup
node scripts/go-coverage-threshold.mjs $coverageProfile 100 --include-from=scripts/go-coverage-targets.txt --exclude-blocks-from=scripts/go-coverage-excluded-blocks.txt
```

Linux/macOS：

```bash
node --test scripts/go-coverage-threshold.test.mjs
go test -p=1 -count=1 -coverprofile="$PWD/coverage.out" ./internal/auth ./internal/db ./internal/event ./internal/http ./internal/middleware ./internal/permission ./internal/shortlink ./internal/system ./internal/user ./internal/usergroup
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

E2E 会使用独立的 Compose project name、独立应用宿主端口和本次运行专用数据库密码，并显式以 `MOEURL_ENV=development` 运行测试应用，避免本地 HTTP 测试受 Secure Cookie 影响。PostgreSQL 不映射宿主机端口。E2E 只清理该测试 project 的数据卷，不会删除日常生产或开发数据库卷。如需指定测试 project 名，可设置 `MOEURL_E2E_COMPOSE_PROJECT`；最终名称必须使用带非空后缀的 `moeurl-e2e-` 保留前缀，日常开发和生产 project 不得使用该命名空间。

项目要求后端和前端测试覆盖率均达到 100%。当前 CI 已配置覆盖率门禁，未达到 100% 时会失败。

Docker Compose 验证：

```bash
docker compose --env-file .env config >/dev/null
bash scripts/compose-smoke.sh --config-only
bash scripts/compose-smoke.sh
```

启动后访问：

```text
http://localhost:8080/api/v1/health
http://localhost:8080/setup
```

如果通过 `MOEURL_HTTP_PORT` 指定了应用宿主端口，请使用对应端口访问。例如 `MOEURL_HTTP_PORT=18080` 时访问 `http://localhost:18080/api/v1/health` 和 `http://localhost:18080/setup`。生产 Compose 不提供 PostgreSQL 宿主端口；本地直连必须显式叠加 `docker-compose.dev.yml`。

`/api/v1/health` 应返回 `code` 为 `0` 且 `status` 为 `ok` 的响应。未初始化环境访问 `/setup` 应进入首次初始化流程。
