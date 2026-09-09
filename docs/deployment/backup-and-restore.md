# PostgreSQL 备份与隔离恢复

## 1. 备份目标

MoeURL 使用 PostgreSQL 逻辑备份作为单机部署的可移植恢复基线。备份必须保存到 Compose 卷之外，并复制到与应用主机故障域不同的位置。仅有 Docker 命名卷不是备份。

本文使用 PostgreSQL 自定义格式（`pg_dump -Fc`），便于校验目录、选择性恢复和跨主机迁移。备份期间业务可以继续运行，但重大升级前应安排低流量窗口，并记录备份开始时间、应用提交和 PostgreSQL 版本。

## 2. 创建与校验备份

先把必填的 `MOEURL_DEPLOY_ROOT` 设置为绝对部署根目录，再固定 project、Compose 文件和环境文件。后续生产命令必须通过同一 helper 执行，不能依赖当前目录或 Compose 自动推断的 project：

```bash
: "${MOEURL_DEPLOY_ROOT:?set MOEURL_DEPLOY_ROOT to the absolute deployment root}"
case "$MOEURL_DEPLOY_ROOT" in
  /*) ;;
  *) echo 'MOEURL_DEPLOY_ROOT must be an absolute path' >&2; exit 1 ;;
esac
DEPLOY_ROOT="$(CDPATH= cd -- "$MOEURL_DEPLOY_ROOT" && pwd -P)" || exit 1
DEPLOY_PROJECT=moeurl
DEPLOY_COMPOSE="$DEPLOY_ROOT/docker-compose.yml"
DEPLOY_ENV="$DEPLOY_ROOT/.env"
test -d "$DEPLOY_ROOT"
test -r "$DEPLOY_COMPOSE"
test -r "$DEPLOY_ENV"
production_compose() {
  docker compose \
    --project-name "$DEPLOY_PROJECT" \
    --project-directory "$DEPLOY_ROOT" \
    --env-file "$DEPLOY_ENV" \
    -f "$DEPLOY_COMPOSE" \
    "$@"
}

docker compose ls
production_compose config >/dev/null
production_compose ps postgres
postgres_id="$(production_compose ps -q postgres)"
test -n "$postgres_id"
postgres_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$postgres_id")"
test "$postgres_project" = "$DEPLOY_PROJECT"
```

`DEPLOY_PROJECT` 必须与现有生产容器的 `com.docker.compose.project` 标签完全一致。标签校验失败时停止操作，先确认部署目录和 project；不得对名称相近的其他 Compose 环境执行备份。

创建宿主机备份目录并限制权限：

```bash
set -eu
umask 077
BACKUP_ROOT=/var/lib/moeurl/backups
install -d -m 700 "$BACKUP_ROOT"
backup_file="$BACKUP_ROOT/moeurl-$(date -u +%Y%m%dT%H%M%SZ).dump"
backup_temp="$(mktemp "$BACKUP_ROOT/.moeurl-backup.XXXXXX")"
cleanup_unpublished_backup() {
  test -z "${backup_temp:-}" || rm -f -- "$backup_temp"
}
trap cleanup_unpublished_backup EXIT
trap 'cleanup_unpublished_backup; exit 1' HUP INT TERM
if ! production_compose exec -T postgres \
  pg_dump -U moeurl -d moeurl -Fc > "$backup_temp"; then
  echo 'pg_dump failed; backup was not published' >&2
  exit 1
fi
test -s "$backup_temp"
chmod 600 "$backup_temp"
docker run --rm -v "$BACKUP_ROOT:/backup:ro" postgres:18-alpine \
  pg_restore --list "/backup/$(basename "$backup_temp")" >/dev/null
ln "$backup_temp" "$backup_file"
rm -f -- "$backup_temp"
backup_temp=
trap - EXIT HUP INT TERM
sha256sum "$backup_file" > "$backup_file.sha256"
sha256sum --check "$backup_file.sha256"
```

临时文件必须创建在最终备份目录中，使 `ln` 在同一文件系统内以不可覆盖方式原子发布目录项。`pg_dump`、非空检查或目录校验失败时，trap 只清理未发布的临时文件；同名最终文件已存在时 `ln` 失败，不会覆盖既有备份。

将 `.dump` 和 `.sha256` 一起复制到受访问控制的远端或离线存储。建议至少保留多代日、周、月备份，并定期抽取不同代际执行恢复演练。清理旧备份前先输出候选列表并由运维人员复核；不要把自动 `find -delete` 作为未经确认的默认命令。

数据库备份不包含 `.env`。应通过独立秘密管理流程备份生产配置；不要把明文 `.env` 与数据库备份放在同一公开位置。

## 3. 隔离恢复演练

恢复测试不得指向生产 project 或生产数据库。以下示例使用固定隔离 project `moeurl-restore-drill` 和独立宿主端口。所有备份和恢复临时文件都放在仓库外的受保护运维目录，避免进入 Git 或 Docker 构建上下文。先创建权限为 `600` 的恢复环境文件，使用新生成的数据库密码与至少 32 字符的初始化 Token：

先显式选择并校验要恢复的备份；不要依赖创建备份章节遗留的 Shell 变量：

```bash
BACKUP_ROOT=/var/lib/moeurl/backups
backup_file="$BACKUP_ROOT/moeurl-<UTC-timestamp>.dump"
test -s "$backup_file" || {
  echo 'restore backup file is missing or empty' >&2
  exit 1
}
sha256sum --check "$backup_file.sha256" || {
  echo 'restore backup checksum verification failed' >&2
  exit 1
}
```

```bash
set +x
umask 077
RESTORE_STATE=/var/lib/moeurl/restore-drill
install -d -m 700 "$RESTORE_STATE"
restore_database_password="$(openssl rand -hex 32)"
{
  printf 'MOEURL_ENV=production\n'
  printf 'MOEURL_HTTP_HOST=127.0.0.1\n'
  printf 'MOEURL_HTTP_PORT=18082\n'
  printf 'MOEURL_POSTGRES_PASSWORD=%s\n' "$restore_database_password"
  printf 'MOEURL_DATABASE_URL=postgres://moeurl:%s@postgres:5432/moeurl?sslmode=disable\n' "$restore_database_password"
  printf 'MOEURL_SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)"
} > "$RESTORE_STATE/restore.env"
unset restore_database_password
chmod 600 "$RESTORE_STATE/restore.env"
```

确认没有同名隔离资源；若存在，先人工判断是否为正在进行的演练，不要直接删除：

```bash
RESTORE_PROJECT=moeurl-restore-drill
: "${MOEURL_DEPLOY_ROOT:?set MOEURL_DEPLOY_ROOT to the absolute deployment root}"
case "$MOEURL_DEPLOY_ROOT" in
  /*) ;;
  *) echo 'MOEURL_DEPLOY_ROOT must be an absolute path' >&2; exit 1 ;;
esac
RESTORE_ROOT="$(CDPATH= cd -- "$MOEURL_DEPLOY_ROOT" && pwd -P)" || exit 1
RESTORE_COMPOSE="$RESTORE_ROOT/docker-compose.yml"
RESTORE_ENV="$RESTORE_STATE/restore.env"
test -d "$RESTORE_ROOT"
test -r "$RESTORE_COMPOSE"
test -r "$RESTORE_ENV"
restore_compose() {
  docker compose \
    --project-name "$RESTORE_PROJECT" \
    --project-directory "$RESTORE_ROOT" \
    --env-file "$RESTORE_ENV" \
    -f "$RESTORE_COMPOSE" \
    "$@"
}
restore_container_ids="$(docker ps -aq --filter "label=com.docker.compose.project=$RESTORE_PROJECT")" || exit 1
restore_volume_names="$(docker volume ls -q --filter "label=com.docker.compose.project=$RESTORE_PROJECT")" || exit 1
restore_network_ids="$(docker network ls -q --filter "label=com.docker.compose.project=$RESTORE_PROJECT")" || exit 1
if ! test -z "$restore_container_ids" ||
   ! test -z "$restore_volume_names" ||
   ! test -z "$restore_network_ids"; then
  echo 'restore project resources already exist' >&2
  exit 1
fi
```

启动空 PostgreSQL，轮询健康状态后恢复：

```bash
restore_compose up -d postgres
postgres_id="$(restore_compose ps -q postgres)"
test -n "$postgres_id"
deadline=$(( $(date +%s) + 120 ))
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$postgres_id")" = healthy ]; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'postgres health timeout' >&2; exit 1; }
  sleep 1
done
```

> **数据覆盖警告：** 下列 `pg_restore --clean` 会删除并重建目标数据库中的现有对象。执行前必须确认 `RESTORE_PROJECT=moeurl-restore-drill`、容器带有相同 Compose project 标签，且目标是本次演练新建的隔离数据库；严禁指向生产 project。

```bash
test "$RESTORE_PROJECT" = moeurl-restore-drill || {
  echo 'restore project must be moeurl-restore-drill before pg_restore --clean' >&2
  exit 1
}
restore_compose exec -T postgres \
  pg_restore -U moeurl -d moeurl --clean --if-exists --exit-on-error < "$backup_file"
```

启动 App。入口脚本会把较旧备份迁移到当前 schema：

```bash
restore_compose up --build -d app
deadline=$(( $(date +%s) + 120 ))
until curl --fail --silent http://127.0.0.1:18082/api/v1/health/ready >/dev/null; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'app readiness timeout' >&2; exit 1; }
  sleep 1
done
```

## 4. 恢复验收

目标 v0.6.0 必须完成以下检查，不能只以容器健康代替数据验证。

验证 migration 版本为 `11`：

```bash
restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -Atc \
  "select max(version_id) from goose_db_version where is_applied"
```

验证 `guest`、`user`、`admin` 三个内置组：

```bash
restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -Atc \
  "select key from user_group where builtin order by key"
```

使用恢复出的管理员账号向 `http://127.0.0.1:18082/api/v1/auth/login` 发起登录请求，断言 HTTP `200` 且业务 `code=0`。密码只通过权限为 `600` 的临时 JSON 文件传入，不放在命令行或 Shell 历史中。

选择备份前已记录的样例短码，验证短链和访问配置：

```bash
restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -P pager=off -c \
  "select slug, status, redirect_mode, intermediate_delay_seconds, expires_at, password_hash is not null as password_enabled from short_link where slug = '<sample-slug>' and deleted_at is null"
```

随后通过隔离 App 访问该短码，按其 direct、intermediate 或 confirmation 模式验证公开流程。若短链受密码保护，还应验证错误密码被拒绝、正确密码授权和最终跳转。记录备份校验和、恢复开始/结束时间、镜像版本、migration 版本、样例短码和每项结果。

## 5. 清理演练环境

先再次确认 project 标签和本次演练记录：

```bash
docker compose ls
docker ps -a --filter "label=com.docker.compose.project=$RESTORE_PROJECT"
docker volume ls --filter "label=com.docker.compose.project=$RESTORE_PROJECT"
```

> **数据破坏警告：** 下列命令永久删除 `moeurl-restore-drill` 的恢复数据库卷。它只能用于已经完成验收的隔离演练，绝不能把 `RESTORE_PROJECT` 改成生产 project。

```bash
test "$RESTORE_PROJECT" = moeurl-restore-drill || {
  echo 'restore project must be moeurl-restore-drill before down -v' >&2
  exit 1
}
restore_compose down -v --remove-orphans
rm -f "$RESTORE_STATE/restore.env"
rmdir "$RESTORE_STATE"
```

最后确认同 project 标签的容器、网络和卷均为空。备份文件及校验文件应按保留策略继续保存，不能随演练环境删除。
