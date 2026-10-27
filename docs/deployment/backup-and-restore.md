# PostgreSQL 备份与隔离恢复

v0.18.0 的完整数据库备份还包含 `audit_log`：操作者、资源和敏感操作的存在本身需要保护，即使不保存字段值。沿用受限权限、加密与卷外独立保存策略，恢复演练需核对样例审计的 ID、actor、动作和字段名。应用只承诺新审计在线滚动保留 180 天，旧访问事件继续长期统计；这不决定离线备份保留期、RPO 或合规删除策略。备份留存与到期销毁应由部署者独立制定，不因在线清理自动删除备份，也不能为降版本在线清空审计。

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
  MOEURL_BUILD_COMMIT="$(git -C "$DEPLOY_ROOT" rev-parse --verify HEAD^{commit})" \
  MOEURL_BUILD_TAG="$(git -C "$DEPLOY_ROOT" tag --points-at HEAD --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }')" \
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
test -n "$postgres_id" || {
  echo 'production postgres container was not found' >&2
  exit 1
}
postgres_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$postgres_id")"
test "$postgres_project" = "$DEPLOY_PROJECT" || {
  echo 'production postgres container project does not match DEPLOY_PROJECT' >&2
  exit 1
}
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

数据库备份不包含 `.env`。应通过独立秘密管理流程备份生产配置；不要把明文 `.env` 与数据库备份放在同一公开位置。启用 OIDC 的部署必须保留原 `MOEURL_OIDC_ENCRYPTION_KEY` 和 `MOEURL_PUBLIC_BASE_URL`：数据库中的 provider Client Secret 使用该密钥加密，恢复数据库却缺少原密钥时，已配置 provider 无法登录。恢复演练应从受保护配置备份向 `restore.env` 注入同一 OIDC 加密密钥；公共地址则改为演练环境可达的 HTTPS Origin，并在身份提供商允许的回调地址范围内验证。未使用 OIDC 的备份可同时省略两项配置。

## 3. 隔离恢复演练

恢复测试不得指向生产 project 或生产数据库。以下示例使用固定隔离 project `moeurl-restore-drill` 和独立宿主端口。所有备份和恢复临时文件都放在仓库外的受保护运维目录，避免进入 Git 或 Docker 构建上下文。若备份包含 OIDC 配置，先从受保护配置备份导出原始 OIDC 加密密钥，并把演练公共地址设置为身份提供商已允许回调的、演练环境可达的 HTTPS Origin；随后创建权限为 `600` 的恢复环境文件，使用新生成的数据库密码与至少 32 字符的初始化 Token：

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
RESTORE_OIDC_CONFIGURED=0
if [ -n "${MOEURL_RESTORE_OIDC_ENCRYPTION_KEY+x}" ] || [ -n "${MOEURL_RESTORE_PUBLIC_BASE_URL+x}" ]; then
  : "${MOEURL_RESTORE_OIDC_ENCRYPTION_KEY:?restore the original OIDC encryption key from protected backup}"
  : "${MOEURL_RESTORE_PUBLIC_BASE_URL:?set the drill environment reachable HTTPS origin}"
  RESTORE_PUBLIC_BASE_URL="${MOEURL_RESTORE_PUBLIC_BASE_URL%/}"
  case "$RESTORE_PUBLIC_BASE_URL" in
    https://*) ;;
    *) echo 'MOEURL_RESTORE_PUBLIC_BASE_URL must be an HTTPS origin allowed by the identity provider' >&2; exit 1 ;;
  esac
  RESTORE_PUBLIC_BASE_URL_AUTHORITY="${RESTORE_PUBLIC_BASE_URL#https://}"
  case "$RESTORE_PUBLIC_BASE_URL_AUTHORITY" in
    ''|':'*|*'/'*|*'?'*|*'#'*|*'@'*|*[[:space:]]*)
      echo 'MOEURL_RESTORE_PUBLIC_BASE_URL must contain only an HTTPS scheme, host, and optional port' >&2
      exit 1
      ;;
  esac
  RESTORE_OIDC_CONFIGURED=1
fi
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
  if [ "$RESTORE_OIDC_CONFIGURED" = 1 ]; then
    printf 'MOEURL_PUBLIC_BASE_URL=%s\n' "$RESTORE_PUBLIC_BASE_URL"
    printf 'MOEURL_OIDC_ENCRYPTION_KEY=%s\n' "$MOEURL_RESTORE_OIDC_ENCRYPTION_KEY"
  fi
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
  MOEURL_BUILD_COMMIT="$(git -C "$RESTORE_ROOT" rev-parse --verify HEAD^{commit})" \
  MOEURL_BUILD_TAG="$(git -C "$RESTORE_ROOT" tag --points-at HEAD --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ { print; exit }')" \
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
restore_compose up -d postgres || {
  echo 'restore postgres container failed to start' >&2
  exit 1
}
postgres_id="$(restore_compose ps -q postgres)"
test -n "$postgres_id" || {
  echo 'restore postgres container was not found' >&2
  exit 1
}
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
if ! restore_compose exec -T postgres \
  pg_restore -U moeurl -d moeurl --clean --if-exists --exit-on-error < "$backup_file"; then
  echo 'pg_restore failed; restored app was not started' >&2
  exit 1
fi
```

启动 App。入口脚本会把较旧备份迁移到当前 schema：

```bash
restore_compose up --build -d app || {
  echo 'restored app failed to start' >&2
  exit 1
}
deadline=$(( $(date +%s) + 120 ))
until curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:18082/api/v1/health/ready >/dev/null; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'app readiness timeout' >&2; exit 1; }
  sleep 1
done
```

## 4. 恢复验收

目标 v0.12.0 必须完成以下检查，不能只以容器健康代替数据验证。除既有访问配置与额度外，还须逐项比对样例短链的标题、标签、原始短码，以及 `short_link:set_metadata`、`short_link:custom_slug` 授权；恢复后的个人与全站列表应保持相同的关键词、标签筛选结果，公开预览仍不返回管理元数据。使用备份中的自定义短码验证原地址仍可访问，跨域名或软删除的占用仍拒绝重复创建，恢复不能重新分配短码。

v0.15.0 恢复还须比对样例用户的 `user_preference.language`、`theme` 与版本，并从新浏览器会话重新登录验证账号设置恢复。尚未保存的用户应继续无记录，不得从演练浏览器回填偏好。该表包含在正常数据库备份中，不需要新增部署密钥；直接执行 `00018 Down` 会删除这些设置。

v0.16.0 恢复还须核验 `short_link:export_statistics` 授权，并以样例短链的已应用 UTC 区间下载 CSV，与页面聚合数值对照。导出不新增采集数据或文件存储，不需要额外备份密钥；回退 `00019` 不删除访问事件，授权仅按迁移追踪撤销。

v0.21.0 恢复还须核验独立 `short_link:export` 授权，以个人和管理员账号按同一组筛选下载清单，核对原短链域名、目标、元数据和所属账号。清单导出不替代数据库备份；`00022` 的权限追加追踪表随正常数据库备份保留，回退仅撤销该迁移追加且未被独立修改的授权，不删除短链或审计。

v0.24.0 恢复还须核验独立 `short_link:export_visits` 与 `short_link:read_visits` 的权限交集，按样例短链已应用 UTC 日期和设备／国家筛选下载匿名记录，核对事件 ID、完整 UTC 时间、机器分类和空值。`00023` 的权限追加／修订追踪随正常整库备份保留；不新增文件存储或部署密钥，CSV 不替代数据库备份。默认 user／admin 拥有、guest 不拥有；恢复已有实例应以备份前记录的人工授权为准，不把默认值强制覆盖到自定义权限。

v0.25.0 恢复还须核验 admin 的 `audit:export`、`audit:read` 与 `admin:access` 交集，user／guest 不应得到受保护审计权限；已有实例以备份前人工授权和迁移修订为准。按真实业务产生的样例审计，在已应用 UTC／操作者／资源／动作筛选下下载 CSV，核对完整 bigint、UTC 微秒、固定动作及变更字段数组，禁止包含字段值和秘密。`00024` 的追加／UPDATE 修订追踪随整库备份保留，不新增文件存储或密钥，CSV 不替代数据库备份。

从当前 `migrations/` 目录计算最大 migration 版本，并确认恢复数据库一致：

```bash
expected_migration_version="$(find "$RESTORE_ROOT/migrations" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9][0-9]_*.sql' -printf '%f\n' | sed -E 's/^0*([0-9]+)_.*/\1/' | sort -n | tail -1)"
actual_migration_version="$(restore_compose exec -T postgres psql -U moeurl -d moeurl -Atc 'select max(version_id) from goose_db_version where is_applied')"
test -n "$expected_migration_version" && test "$actual_migration_version" = "$expected_migration_version" || {
  echo 'restored migration version does not match the current migrations directory' >&2
  exit 1
}
```

验证 `guest`、`user`、`admin` 三个内置组：

```bash
restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -Atc \
  "select key, permissions ? 'short_link:set_metadata' as can_set_metadata, permissions ? 'short_link:custom_slug' as can_custom_slug, permissions ? 'short_link:export_statistics' as can_export_statistics, permissions ? 'short_link:export' as can_export_links, permissions ? 'short_link:read_visits' as can_read_visits, permissions ? 'short_link:export_visits' as can_export_visits, permissions ? 'admin:access' as can_access_admin, permissions ? 'audit:read' as can_read_audit, permissions ? 'audit:export' as can_export_audit from user_group where builtin order by key"
```

登录入口验收必须以下文 `GET /api/v1/auth/methods` 返回的恢复后策略为准。需要验证本地登录时，密码只通过权限为 `600` 的临时 JSON 文件传入，不放在命令行或 Shell 历史中。

选择备份前已记录的样例短码，验证短链和访问配置：

```bash
restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -P pager=off -c \
  "select slug, title, tags, status, redirect_mode, intermediate_delay_seconds, expires_at, password_hash is not null as password_enabled, max_visits, visits_used from short_link where slug = '<sample-slug>' and deleted_at is null"
```

随后通过隔离 App 访问该短码，按其 direct、intermediate 或 confirmation 模式验证公开流程。若短链受密码保护，还应验证错误密码被拒绝、正确密码授权和最终跳转。记录备份校验和、恢复开始/结束时间、镜像版本、migration 版本、样例短码和每项结果。

v0.10.0 还应将 `max_visits`、`visits_used` 与备份前记录逐项比较，恢复不会根据历史访问事件重建额度。用隔离样例验证剩余最后名额只允许一次最终跳转、之后显示耗尽；预览、页面入口和错误密码不改变用量。验证会消耗恢复库中的额度，不得用生产库执行演练，也不能把恢复旧备份视为累计访问次数永不回退的保证。

继续核对 v0.9.0 设置与登录入口：

```bash
restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -P pager=off -c \
  "select key, value from system_setting where key in ('site.name', 'site.default_language', 'site.default_theme', 'site.footer_text', 'site.show_powered_by', 'auth.local_login_enabled', 'site.settings_revision') order by key"

restore_compose exec -T postgres \
  psql -U moeurl -d moeurl -P pager=off -c \
  "select key, display_name, enabled, deleted_at is null as active from oidc_provider order by key"
```

通过 `GET /api/v1/system/public-config` 核对站点品牌，通过 `GET /api/v1/auth/methods` 核对本地登录状态和可用 Provider，并按结果分支验收：

- `local.enabled=true`：使用恢复出的管理员账号向 `http://127.0.0.1:18082/api/v1/auth/login` 发起登录请求，断言 HTTP `200` 且业务 `code=0`。
- `local.enabled=false`：向同一接口发起本地登录请求，断言 HTTP `200` 且业务 `code=110104`；同时必须已经向 `restore.env` 注入原始 `MOEURL_OIDC_ENCRYPTION_KEY`，并使用身份提供商允许的演练 Origin 完成真实 OIDC 登录，不能只依赖恢复前保留的 Session。

记录设置值、登录方式、Provider 集合和密钥恢复来源，但不得记录 Secret 明文。

### v0.26.0 个人域名偏好恢复核查

`user_domain_preference` 随整库备份恢复，不需要新增文件或密钥。比对样例账号的 `domain_id` 与完整精度 `updated_at`，未保存账号应保持无记录；不要把浏览器临时选择当作恢复后的数据库值。恢复域名及组授权后，以两个独立浏览器重新登录，验证个人设置和实际创建返回的域名，并确认旧语言／主题偏好及版本未改变。偏好引用的域名被停用或失去授权时，应显示通用回退状态，不能因此开放该域名。

在隔离恢复库验证删除未被短链引用的域名会同事务清除偏好并推进版本，旧版本保存应冲突。`00025 Down` 删除个人域名偏好表，因此应先备份并明确接受偏好丢失；镜像回退保留新表时，仍须遵守[旧应用的域名删除限制](upgrade-and-recovery.md#v0260-个人默认域名升级与回退)。上述核查仍需实际目标环境演练证据，本地自动化不代表生产恢复已经完成。

### v0.28.0 用户组默认域名恢复核查

v0.28.0 恢复验收还须在清理前记录两个 builtin 组的 `default_domain_id`、完整 `updated_at`、权限及对应域名资格，升级 `00027` 后验证旧值与历史审计保持。分别用 user／admin 创建面板检验组初选、个人／手动覆盖及最终 URL；验证撤权／停用回退、并发权限／默认冲突，以及删除域名同事务清个人／组引用并推进版本。正式 Down 会丢失组默认值，必须先备份并明确接受；旧镜像保留新外键可能拒绝域名删除。迁移与回退边界见[升级回退](upgrade-and-recovery.md#v0280-用户组默认域名升级与回退)，逐候选门禁见[验收](../implementation/v0.28.0-acceptance.md)，本地门禁不替代真实生产恢复演练。

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
