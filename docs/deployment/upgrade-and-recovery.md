# 升级、回退与灾难恢复

## 1. 升级原则

MoeURL App 启动前会自动运行 Goose migration。数据库迁移可能先于新进程监听端口，因此每次升级都必须先创建并校验卷外逻辑备份。不要把容器镜像回退等同于数据库回退；只有确认旧代码与新 schema 兼容，或明确执行了经过测试的 migration Down，才能完成整体回退。

生产升级应安排维护窗口，记录当前 Git 提交、镜像 ID、Compose 解析结果、数据库 migration 版本和备份校验和。升级前还必须保存当前加固 Compose 的原始模板；不能保存 `docker compose config` 的渲染输出，因为其中包含数据库密码和初始化 Token。

## 2. 升级前检查

目标版本的 Compose 要求 `.env` 同时包含原始 `MOEURL_POSTGRES_PASSWORD` 和完整、已编码的 `MOEURL_DATABASE_URL`。从旧版升级时，应在切换目标提交前补齐 URL；此前按文档生成的十六进制密码可以直接放入密码段，自定义密码中的 URI 保留字符必须先做百分号编码。两项必须对应同一个 PostgreSQL 角色密码，且不得把包含秘密的渲染后 Compose 配置保存到部署状态目录。

先在受保护的部署状态目录保存升级前 SHA、当前未渲染的加固 Compose 和正在运行的 App 镜像。以下变量需要在同一维护 Shell 中保留；重新登录后应从相同目录和值恢复：

```bash
: "${MOEURL_DEPLOY_ROOT:?set MOEURL_DEPLOY_ROOT to the absolute deployment root}"
: "${MOEURL_PUBLIC_BASE_URL:?set MOEURL_PUBLIC_BASE_URL from protected deployment configuration}"
case "$MOEURL_DEPLOY_ROOT" in
  /*) ;;
  *) echo 'MOEURL_DEPLOY_ROOT must be an absolute path' >&2; exit 1 ;;
esac
PUBLIC_BASE_URL="${MOEURL_PUBLIC_BASE_URL%/}"
case "$PUBLIC_BASE_URL" in
  https://?*) ;;
  *) echo 'MOEURL_PUBLIC_BASE_URL must use https' >&2; exit 1 ;;
esac
test -d "$MOEURL_DEPLOY_ROOT" || { echo 'deployment root does not exist' >&2; exit 1; }
DEPLOY_ROOT="$(CDPATH= cd -- "$MOEURL_DEPLOY_ROOT" && pwd -P)" || exit 1
DEPLOY_PROJECT=moeurl
DEPLOY_STATE=/var/lib/moeurl/deployment-state
DEPLOY_COMPOSE="$DEPLOY_ROOT/docker-compose.yml"
DEPLOY_ENV="$DEPLOY_ROOT/.env"
test -f "$DEPLOY_COMPOSE" && test -r "$DEPLOY_COMPOSE" || { echo 'deployment docker-compose.yml is missing or unreadable' >&2; exit 1; }
test -f "$DEPLOY_ENV" && test -r "$DEPLOY_ENV" || { echo 'deployment .env is missing or unreadable' >&2; exit 1; }
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "$DEPLOY_STATE"
ROLLBACK_COMPOSE="$DEPLOY_STATE/docker-compose.rollback.yml"
install -m 600 "$DEPLOY_COMPOSE" "$ROLLBACK_COMPOSE"
git -C "$DEPLOY_ROOT" rev-parse HEAD > "$DEPLOY_STATE/upgrade-from-commit"
printf '%s\n' "$DEPLOY_PROJECT" > "$DEPLOY_STATE/project-name"
chmod 600 "$DEPLOY_STATE/upgrade-from-commit"
chmod 600 "$DEPLOY_STATE/project-name"
grep -F '${MOEURL_POSTGRES_PASSWORD:?required}' "$ROLLBACK_COMPOSE" >/dev/null
grep -F '${MOEURL_DATABASE_URL:?required}' "$ROLLBACK_COMPOSE" >/dev/null

production_compose() {
  docker compose \
    --project-name "$DEPLOY_PROJECT" \
    --project-directory "$DEPLOY_ROOT" \
    --env-file "$DEPLOY_ENV" \
    -f "$DEPLOY_COMPOSE" \
    "$@"
}
production_compose config >/dev/null
app_container_id="$(production_compose ps -q app)"
test -n "$app_container_id"
app_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$app_container_id")"
test "$app_project" = "$DEPLOY_PROJECT"

service_image_ref="$(docker inspect -f '{{.Config.Image}}' "$app_container_id")"
running_image_id="$(docker inspect -f '{{.Image}}' "$app_container_id")"
test -n "$service_image_ref"
test -n "$running_image_id"
rollback_suffix="$(printf '%s' "$running_image_id" | sed 's/^sha256://' | cut -c1-12)"
rollback_image_tag="moeurl-rollback:${DEPLOY_PROJECT}-$(date -u +%Y%m%dT%H%M%SZ)-$rollback_suffix"
docker image tag "$running_image_id" "$rollback_image_tag"
test "$(docker image inspect -f '{{.Id}}' "$rollback_image_tag")" = "$running_image_id"

printf '%s\n' "$rollback_image_tag" > "$DEPLOY_STATE/rollback-image-tag"
printf '%s\n' "$running_image_id" > "$DEPLOY_STATE/rollback-image-id"
printf '%s\n' "$service_image_ref" > "$DEPLOY_STATE/service-image-ref"
chmod 600 \
  "$DEPLOY_STATE/rollback-image-tag" \
  "$DEPLOY_STATE/rollback-image-id" \
  "$DEPLOY_STATE/service-image-ref"
```

`DEPLOY_PROJECT` 必须与 `docker compose ls` 显示的现有生产 project 及 App 容器标签完全一致；不是 `moeurl` 时先替换示例值。`ROLLBACK_COMPOSE` 只复制仓库中的插值模板，不执行重定向到文件的 `docker compose config`，因此不会把 `.env` 中的秘密落盘。唯一的 `rollback_image_tag` 绑定升级前实际运行的 image ID，应视为本次维护窗口的不可变资产，不得覆盖或复用。维护、回退验收和备份确认全部结束前，不得执行 `docker image prune`、系统自动镜像清理或删除该 tag。

`MOEURL_DEPLOY_ROOT` 必须由部署者设置为包含当前生产 `docker-compose.yml` 和 `.env` 的绝对目录。`MOEURL_PUBLIC_BASE_URL` 必须从受保护的部署配置注入为实际公网 HTTPS 基础地址，例如 `https://go.example.com`，不得把占位域名用于生产检查。脚本在执行任何 Compose 命令前解析并校验部署目录与公网地址；不得依赖维护 Shell 的当前工作目录推断生产部署位置。

这些文件只保存非秘密的部署身份和镜像身份，但仍放在权限为 `700` 的状态目录中，防止被非部署账号篡改。前向升级必须使用目标提交自己的 `docker-compose.yml`，以便目标版本新增的配置和镜像约定生效。

升级前使用当前提交的 Compose 检查同一 project：

```bash
git -C "$DEPLOY_ROOT" rev-parse HEAD
production_compose images
production_compose ps
production_compose config >/dev/null
production_compose config --volumes | grep -Fx postgres-data >/dev/null
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "$PUBLIC_BASE_URL/api/v1/health/ready"
```

按照 [备份与隔离恢复](backup-and-restore.md) 创建自定义格式备份，至少完成 `test -s`、`pg_restore --list` 和 SHA-256 校验。高风险升级应先用候选代码在隔离 project 恢复该备份并跑完恢复验收。

## 3. 构建、迁移和切换

检出已经审核的目标提交后，使用目标提交的 Compose 离线解析与构建，不停止当前服务：

```bash
git -C "$DEPLOY_ROOT" checkout --detach '<target-commit-sha>'
TARGET_COMPOSE="$DEPLOY_ROOT/docker-compose.yml"
target_compose() {
  docker compose \
    --project-name "$DEPLOY_PROJECT" \
    --project-directory "$DEPLOY_ROOT" \
    --env-file "$DEPLOY_ROOT/.env" \
    -f "$TARGET_COMPOSE" \
    "$@"
}
target_compose config >/dev/null
target_compose config --volumes | grep -Fx postgres-data >/dev/null
target_compose build --pull app
```

执行目标 migration 前，必须结合目标 migration、旧 App 的 SQL 及写入行为，确认旧 App 能在目标 schema 上继续安全运行。优先在隔离恢复环境中用升级前镜像与目标 migration 验证该兼容性；不能提供兼容性证据时，不得在旧 App 仍接收流量时迁移。应先从反向代理摘除旧 App，等待在途请求排空，再停止 App：

```bash
target_compose stop app || {
  echo 'target app failed to stop; migration was not started' >&2
  exit 1
}
```

此路径属于维护窗口，会产生短暂不可用；停止完成后再执行下述 migration，并仅在 migration 成功后启动目标 App。

确认 PostgreSQL 健康，再用一次性 App 容器显式执行 migration：

```bash
target_compose up -d postgres || {
  echo 'target postgres container failed to start' >&2
  exit 1
}
postgres_id="$(target_compose ps -q postgres)"
test -n "$postgres_id"
deadline=$(( $(date +%s) + 120 ))
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$postgres_id")" = healthy ]; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'postgres health timeout' >&2; exit 1; }
  sleep 1
done
if ! target_compose run --rm --no-deps \
  --entrypoint /bin/sh app -c \
  'exec /app/goose -dir /app/migrations postgres "$MOEURL_DATABASE_URL" up'; then
  echo 'target migration failed; target app was not started' >&2
  exit 1
fi
```

该命令成功后切换 App：

```bash
target_compose up -d --no-deps app || {
  echo 'target app failed to start' >&2
  exit 1
}
```

使用有界轮询等待 readiness，并检查日志：

```bash
app_port_mapping="$(target_compose port app 8080)" || {
  echo 'target app port mapping could not be resolved' >&2
  exit 1
}
app_host_port="${app_port_mapping##*:}"
case "$app_host_port" in
  ''|*[!0-9]*) echo 'target app host port is invalid' >&2; exit 1 ;;
esac
deadline=$(( $(date +%s) + 120 ))
until curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "http://127.0.0.1:$app_host_port/api/v1/health/ready" >/dev/null; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'readiness timeout' >&2; exit 1; }
  sleep 1
done
target_compose logs --since 10m app
```

最后通过公网 HTTPS 验证管理员登录、短链创建/列表、样例 direct、intermediate、confirmation 跳转及统计。确认代理仍发送 HSTS，登录、初始化和公开解锁限流仍生效。

## 4. 失败处理与回退

若构建失败，或在摘流并执行 `target_compose stop app` 之前中止且 migration 尚未执行，旧容器仍可运行，修复后重试即可。若旧 App 已停止，而 PostgreSQL 启动失败或健康检查超时，则旧服务已经不可用；按下述首选回退路径恢复升级前镜像并确认 readiness，再重新开始升级。若 migration 成功但新 App 未就绪：

1. 保存 App 日志、容器状态和 readiness 响应。
2. 查阅目标 migration 的 Down 数据影响。
3. 优先使用与新 schema 兼容的旧镜像临时恢复服务。
4. 仅在确认必须回退 schema 时，停止 App、再次备份当前失败状态，然后执行精确 migration Down。

v0.6.0 的 `00011` Down 会删除登录失败临时状态并解除相应临时阻断，但不修改用户、Session 或短链数据。其他历史 migration 可能有不可逆规范化，不能批量执行未知数量的 Down。

首选回退路径直接恢复升级前保存的镜像，不依赖源码 checkout、依赖下载或再次构建。保存的加固 Compose 继续提供当前数据库密码、私有 PostgreSQL 网络和回环 App 绑定：

```bash
UPGRADE_FROM_COMMIT="$(cat "$DEPLOY_STATE/upgrade-from-commit")"
DEPLOY_PROJECT="$(cat "$DEPLOY_STATE/project-name")"
rollback_image_tag="$(cat "$DEPLOY_STATE/rollback-image-tag")"
running_image_id="$(cat "$DEPLOY_STATE/rollback-image-id")"
service_image_ref="$(cat "$DEPLOY_STATE/service-image-ref")"
rollback_compose() {
  docker compose \
    --project-name "$DEPLOY_PROJECT" \
    --project-directory "$DEPLOY_ROOT" \
    --env-file "$DEPLOY_ROOT/.env" \
    -f "$ROLLBACK_COMPOSE" \
    "$@"
}
rollback_compose config >/dev/null
rollback_compose config --volumes | grep -Fx postgres-data >/dev/null
test "$(docker image inspect -f '{{.Id}}' "$rollback_image_tag")" = "$running_image_id"
docker image tag "$rollback_image_tag" "$service_image_ref"
test "$(docker image inspect -f '{{.Id}}' "$service_image_ref")" = "$running_image_id"
rollback_compose up --detach --no-build --force-recreate --no-deps app
```

只有当保存的 tag 和 image ID 已无法从本机镜像存储恢复时，才使用 `UPGRADE_FROM_COMMIT` 检出升级前提交并通过 `rollback_compose build app` 重建；该路径依赖源码、构建依赖和外部下载，不是首选回退方式。不能依赖浮动分支名，也不得改用旧提交中的 `docker-compose.yml`，否则会重新引入旧部署默认值。重建完成后仍应记录新 image ID，再使用 `--force-recreate --no-deps` 只替换 App。

前向和回退命令使用相同的 `--project-name`、`--project-directory`，并在切换前验证相同的 `postgres-data` 逻辑卷键，因此继续操作同一 Compose project 与数据库命名卷。回退 App 后重复 readiness 和业务验收。若需要恢复升级前备份：

> **数据破坏警告：** 用备份覆盖生产数据库会丢失备份创建之后的全部写入。执行前必须停止 App、确认 Compose project、保存当前失败数据库的独立备份，并由负责人确认恢复点目标。

先在隔离 project 证明备份可恢复，再按维护窗口的恢复方案重建生产数据库。不得在仍接收流量的数据库上直接使用 `pg_restore --clean`。

## 5. 灾难恢复演练

至少定期模拟以下场景：

- 应用容器丢失，但 PostgreSQL 卷仍在：重建 App，验证 migration、readiness 和数据保留。
- 整台主机丢失：在另一台干净主机准备 Docker、Compose、受保护的 `.env` 和卷外备份。
- PostgreSQL 卷不可用：按 [备份与隔离恢复](backup-and-restore.md) 在新卷恢复，不复用损坏卷。

主机丢失演练的验收项：

1. `goose_db_version` 的最大已应用版本为 `11`。
2. `guest`、`user`、`admin` 三个内置组存在。
3. 恢复出的管理员可以登录。
4. 预先登记的样例短链、跳转模式、倒计时、过期时间和密码启用状态一致。
5. 外部 HTTPS、HSTS、可信转发头和三个敏感端点的来源级限流有效。
6. 演练结束后只清理隔离 project，生产容器、网络和卷不受影响。

每次演练记录恢复点目标（RPO）、实际恢复耗时（RTO）、备份校验和、软件版本、失败步骤和改进项。v0.6.0 不承诺自动故障转移，实际 RPO/RTO 由备份频率、备份传输和人工恢复流程决定。
