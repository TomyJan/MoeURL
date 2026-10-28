# MoeURL

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

当前主分支的功能实现已推进到 v0.30.0：在短链、匿名统计、批量管理、事务审计、账号与用户组、OIDC、多域名和系统设置基础上，已合并单条／批量归属转移、清单与审计 CSV、批量标签、个人／组默认域名、域名排序、域名默认跳转方式和有界批量成员迁移。前端保留标准列表、操作反馈、构建版本署名和「鸢尾蓝 × 薄荷青」配色。合并不等于正式发布。

v0.12.0 自定义短码与 v0.13.0 个人改密已分别通过 PR #185、#186 合并。本地验证与独立审查分别见 [短码验收](./docs/implementation/v0.12.0-acceptance.md) 和 [改密验收](./docs/implementation/v0.13.0-acceptance.md)，不据此声称正式发布。[v0.14.0 统计日期范围](./docs/product/scope-v0.14.0.md) 已通过 PR #187 合并为 `c864ce3a`，支持近 7／30／90 天与有界自定义 UTC 区间，随后依赖更新后的主分支为 `ae464282`；原分支验证状态见 [本版验收](./docs/implementation/v0.14.0-acceptance.md)。

已实现、待开发和待验证事项统一见 [开发进度与能力清单](./docs/product/development-status.md)。功能实现与本地验证不等于正式发布；当前候选提交的目标 CI、容器、外部真实 OIDC、DNS/TLS 和恢复发布证据须分别补齐，历史验证保留各自的提交与环境范围。

[v0.15.0 账号语言与主题偏好](./docs/product/scope-v0.15.0.md) 已通过 PR #190 合并为 `2ec7eaa4`：支持账号保存与登录加载，同时保留浏览器即时选择。原分支验证环境和发布缺口见 [验收记录](./docs/implementation/v0.15.0-acceptance.md)。[v0.16.0 聚合统计 CSV 导出](./docs/product/scope-v0.16.0.md) 已通过 PR #191 合并为 `bd4c2625`，未正式发布；不扩展原始数据采集，状态见 [本版验收](./docs/implementation/v0.16.0-acceptance.md)。

[v0.17.0 短链批量管理](./docs/product/scope-v0.17.0.md)、[v0.18.0 全站统计、访问明细和操作审计](./docs/product/scope-v0.18.0.md) 与 [v0.19.0 用户组成员迁移](./docs/product/scope-v0.19.0.md) 已分别通过 PR #198、#208、#211 合并。最近 [v0.29.0](./docs/product/scope-v0.29.0.md) 由 PR #227 合并为 8af05d60，最终 PR CI #40629796924 与合并 master CI #40631422772 各九成功、真实审查闭环。各候选的本地门禁、目标 CI 和生产验收保持独立归属。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](./docs/implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

## 功能概览

[v0.31.0 OIDC 创建模板](./docs/product/scope-v0.31.0.md) 正在独立分支实现，仅提供 Google 与手动空白创建草稿。前端本地门禁已通过，浏览器、产品制品、独立审查和远端交付仍待执行，阶段见[验收](./docs/implementation/v0.31.0-acceptance.md)。

各项能力的版本边界与验证记录见 [文档中心](./docs/README.md)。

- 首次初始化站点和管理员账号。
- Cookie Session + 服务端会话存储。
- 多提供商 OIDC 登录、邮箱域名供应策略和管理员 Provider 管理，复用既有 Session。
- 内置 `guest`、`user`、`admin` 用户组和权限判断。
- 创建、查看、筛选、禁用和软删除短链。
- 当前列表多选，最多 100 条的原子批量启用、停用与软删除。
- 管理短链标题与标签，按关键词和精确标签筛选；元数据受权限控制，不进入公开预览或访问事件。
- 管理员全站短链管理、用户创建和用户维护入口。
- 内置用户组权限管理，支持 `restricted`、`basic`、`standard` 预设、受保护管理权限和并发冲突提示。
- 多域名管理：管理员授权域名和设置全局默认，用户创建时选择获授权域名，已发布短链的 URL 不随默认值切换。
- 控制台个人概览、最近短链和个人昵称设置。
- 个人页显式保存账号语言／主题，登录及刷新恢复；浏览器即时选择独立保存，退出恢复浏览器基线。
- 短链支持直接跳转、中间页和确认页三种模式，短码全系统唯一。
- 支持可选过期时间、访问配置编辑和浏览器即时生成二维码。
- 支持权限控制的最大访问次数；仅最终跳转领取额度，并发最后名额不会超发，额度用量独立于访问统计。
- 支持 Argon2id 访问密码、短链级数据库一致失败限流和 15 分钟短期访问授权。
- 确认页模式的创建和编辑受 `short_link:use_confirmation` 权限控制；该权限不控制访客在密码解锁后的继续访问，解锁后仍等待访问者主动继续。
- continue 路由会重新检查状态、软删除、过期、模式、密码授权和访问额度；无密码 direct 短链不允许通过 Continue 绕过规范入口，只有最终目标 `302` 成功写出后才计入访问量。
- 短链列表展示总访问量、今日访问量和最近访问时间。
- 按短链展示有界 UTC 区间趋势及来源、设备和地区聚合，可导出已应用区间的聚合 CSV。
- 管理员全站统计仪表盘、单短链匿名访问分页与浏览器／系统类别；不保存原始 IP、完整 User-Agent 或完整 Referer。
- 关键业务写入与白名单操作审计同事务提交，管理员只读查询，审计在线保留 180 天。
- Vue 3 + Vuetify 4 前端，支持主题、国际化和 PWA 基础能力。
- 系统设置：站点名称、默认语言／主题、纯文本页脚及带登录入口保护的本地登录开关；Powered by 版本署名固定展示。

## 技术栈

- 后端：Go、Chi、SQLC、Goose、PostgreSQL。
- 前端：Vue 3、Vite、TypeScript、Vuetify 4。
- 状态：Pinia、TanStack Query for Vue。
- 包管理：pnpm。
- 测试：go test、Vitest、Playwright、testcontainers-go。
- 部署：生产支持单机 Docker Compose + 外部 TLS 反向代理；开发环境可裸机运行。

## 文档

- [开发进度：已实现、待开发与待验证](./docs/product/development-status.md)
- [路线图](./docs/product/roadmap.md)
- [v0.11.0 标题与标签范围](./docs/product/scope-v0.11.0.md)
- [v0.11.0 验收清单](./docs/implementation/v0.11.0-acceptance.md)
- [v0.12.0 自定义短码范围](./docs/product/scope-v0.12.0.md)
- [v0.12.0 验收清单](./docs/implementation/v0.12.0-acceptance.md)
- [文档总览](./docs/README.md)
- [v0.10.0 最大访问次数范围](./docs/product/scope-v0.10.0.md)
- [v0.10.0 验收清单](./docs/implementation/v0.10.0-acceptance.md)
- [v0.8.0 多域名范围](./docs/product/scope-v0.8.0.md)
- [域名规格](./docs/specs/domains.md)
- [v0.8.0 验收清单](./docs/implementation/v0.8.0-acceptance.md)
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

- Go 1.26.8 或更高版本。
- Node.js 26.x。
- pnpm 11.5 或更高版本。
- PostgreSQL 18 或兼容版本。
- Docker 和 Docker Compose（用于容器运行、E2E 和集成测试）。

## Docker 运行

默认 Compose 面向单机生产拓扑：PostgreSQL 不映射宿主机端口，App 默认只绑定 `127.0.0.1:8080`，由外部 TLS 反向代理提供公网 HTTPS、HSTS 和来源级限流。生产使用前请完整阅读 [单机 Docker Compose 部署](./docs/deployment/single-host-compose.md)。

先创建权限受限的 `.env`，并为数据库密码和初始化 Token 生成独立的至少 32 字符随机值。App 接收完整、已编码的 `MOEURL_DATABASE_URL`，避免 Compose 把原始密码拼入 URI。`.env.example` 只提供变量入口，不提供可用的默认秘密：

```bash
test ! -e .env || {
  echo '.env already exists; preserve it or move it explicitly before creating a new file' >&2
  exit 1
}
set +x
umask 077
database_password="$(openssl rand -hex 32)"
oidc_encryption_key="$(openssl rand -base64 32)"
{
  printf 'MOEURL_ENV=production\n'
  printf 'MOEURL_HTTP_HOST=127.0.0.1\n'
  printf 'MOEURL_HTTP_PORT=8080\n'
  printf 'MOEURL_POSTGRES_PASSWORD=%s\n' "$database_password"
  printf 'MOEURL_DATABASE_URL=postgres://moeurl:%s@postgres:5432/moeurl?sslmode=disable\n' "$database_password"
  printf 'MOEURL_SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)"
  printf 'MOEURL_PUBLIC_BASE_URL=https://go.example.com\n'
  printf 'MOEURL_OIDC_ENCRYPTION_KEY=%s\n' "$oidc_encryption_key"
} > .env
unset database_password oidc_encryption_key
chmod 600 .env
```

若自行设置含 `/`、`?`、`#`、`%` 或 `$` 等 URI 保留字符的密码，`.env` 中 `MOEURL_POSTGRES_PASSWORD` 的完整值使用单引号包裹，避免 Compose 将 `$VAR` 或 `${VAR}` 解释为变量插值；`MOEURL_DATABASE_URL` 中的密码部分必须百分号编码，其中 `$` 编码为 `%24`。默认 `sslmode=disable` 仅用于受信的单机私有 Compose 网络；数据库链路经过不受信网络时应改用 `sslmode=verify-full` 并配置可验证的服务端证书和 CA。

将示例中的 `https://go.example.com` 替换为实际公网 HTTPS Origin，不得包含路径、查询或片段。应用会将根路径末尾的 `/` 规范化移除；按 `PUBLIC_BASE_URL="${MOEURL_PUBLIC_BASE_URL%/}"` 取得规范化值后，每个提供商登记的回调地址为 `${PUBLIC_BASE_URL}/api/v1/auth/oidc/<provider-key>/callback`，因此会保留公共地址中配置的 HTTPS 端口。`MOEURL_OIDC_ENCRYPTION_KEY` 必须作为长期部署秘密保存并独立备份；丢失或更换该值会使已保存的 Client Secret 和未完成的登录尝试无法解密。未使用 OIDC 时可将公共地址与加密密钥同时留空。

v0.8.0 启用多个短链域名前，逐一为域名配置 DNS、有效 HTTPS 证书及到同一 App 的代理路由。代理必须保留原始 Host 和非默认端口，不能把所有入口改写为主站 Host；短链只能在其保存的启用域名访问。升级前核对已发布短链实际使用的别名，具体流程见 [多域名上线检查](./docs/deployment/single-host-compose.md#55-v080-多短链域名上线检查)。

执行生产 Compose 命令前，先按 [单机 Docker Compose 部署](./docs/deployment/single-host-compose.md)校验绝对部署根目录、生产 Compose 文件、`.env` 和 project name，并在同一 Shell 会话中初始化 `production_compose` helper：

```bash
production_compose config >/dev/null
production_compose up --build -d
production_compose ps
```

启动后在宿主机检查 readiness：

```bash
curl --fail http://127.0.0.1:8080/api/v1/health/ready
```

通过外部 HTTPS 入口访问 `/setup`，使用 `.env` 中的初始化 Token 完成首次配置。初始化后仍需保留 `MOEURL_SETUP_TOKEN`，production 启动会继续校验它。

停止容器但保留数据库数据：

```bash
production_compose down
```

本地开发确需直连 PostgreSQL 时，显式叠加开发覆盖文件；数据库仍只绑定本机回环地址：

```bash
export MOEURL_BUILD_COMMIT="$(git rev-parse --verify HEAD^{commit})"
export MOEURL_BUILD_TAG="$(git tag --points-at HEAD --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }')"
docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml up --build
```

容器构建不包含 `.git`，因此 Compose 构建必须显式提供源提交；本地脚本和 CI 会自动注入。缺少完整提交时构建会失败，不会生成无法追溯的默认版本。

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
go install github.com/pressly/goose/v3/cmd/goose@v3.28.0
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
go test -p=1 -count=1 "-coverprofile=$coverageProfile" ./internal/auth ./internal/db ./internal/domain ./internal/event ./internal/http ./internal/loginpolicy ./internal/middleware ./internal/oidc ./internal/permission ./internal/shortlink ./internal/system ./internal/user ./internal/usergroup
node scripts/go-coverage-threshold.mjs $coverageProfile 100 --include-from=scripts/go-coverage-targets.txt --exclude-blocks-from=scripts/go-coverage-excluded-blocks.txt
```

Linux/macOS：

```bash
node --test scripts/go-coverage-threshold.test.mjs
go test -p=1 -count=1 -coverprofile="$PWD/coverage.out" ./internal/auth ./internal/db ./internal/domain ./internal/event ./internal/http ./internal/loginpolicy ./internal/middleware ./internal/oidc ./internal/permission ./internal/shortlink ./internal/system ./internal/user ./internal/usergroup
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

Docker Compose 验证；生产配置检查仍需在已初始化 `production_compose` 的部署 Shell 中执行：

```bash
production_compose config >/dev/null
bash scripts/compose-smoke.sh --config-only
bash scripts/compose-smoke.sh
```

启动后访问：

```text
http://127.0.0.1:8080/api/v1/health
http://127.0.0.1:8080/setup
```

如果通过 `MOEURL_HTTP_PORT` 指定了应用宿主端口，请使用对应端口访问。例如 `MOEURL_HTTP_PORT=18080` 时访问 `http://127.0.0.1:18080/api/v1/health` 和 `http://127.0.0.1:18080/setup`。生产 Compose 不提供 PostgreSQL 宿主端口；本地直连必须显式叠加 `docker-compose.dev.yml`。

`/api/v1/health` 应返回 `code` 为 `0` 且 `status` 为 `ok` 的响应。未初始化环境访问 `/setup` 应进入首次初始化流程。
