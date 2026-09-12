# 单机 Docker Compose 部署

## 1. 支持边界

MoeURL v0.6.0 的生产部署边界是单台主机上的 Docker Compose。外部 Caddy、Nginx 或现有边缘代理负责 TLS 终止、证书续期、HSTS、公网访问日志和来源级限流。MoeURL 不内置反向代理，也不承诺高可用、Kubernetes 或跨主机故障转移。

默认拓扑只把 App 的 `8080` 端口绑定到宿主机 `127.0.0.1`。PostgreSQL 仅加入 Compose 内部网络，不映射宿主机端口。若反向代理不在同一台主机，应通过受控私网、主机防火墙和显式 `MOEURL_HTTP_HOST` 开放 App，不能直接把 PostgreSQL 暴露到网络。

## 2. 前置条件

- 受支持的 Linux 主机、Docker Engine 和 Docker Compose v2 或兼容版本。
- 用于运维命令和健康检查的 Bash、curl 与 OpenSSL。
- 指向反向代理的域名和有效 TLS 证书。
- 由专用系统账号管理的仓库目录与卷外备份目录。
- 主机时间同步、磁盘空间监控和定期安全更新。

生产部署前先核对实际版本：

```bash
docker version
docker compose version
```

## 3. 准备部署秘密

所有生产 Compose 操作先固定到一个绝对部署根目录和明确的 project。不要依赖调用命令时的当前目录：

```bash
: "${MOEURL_DEPLOY_ROOT:?set MOEURL_DEPLOY_ROOT to the absolute deployment root}"
case "$MOEURL_DEPLOY_ROOT" in
  /*) ;;
  *) echo 'MOEURL_DEPLOY_ROOT must be an absolute path' >&2; exit 1 ;;
esac
test -d "$MOEURL_DEPLOY_ROOT" || { echo 'deployment root does not exist' >&2; exit 1; }
DEPLOY_ROOT="$(CDPATH= cd -- "$MOEURL_DEPLOY_ROOT" && pwd -P)" || exit 1
DEPLOY_PROJECT=moeurl
DEPLOY_COMPOSE="$DEPLOY_ROOT/docker-compose.yml"
DEPLOY_ENV="$DEPLOY_ROOT/.env"
DEPLOY_DEV_COMPOSE="$DEPLOY_ROOT/docker-compose.dev.yml"
test -f "$DEPLOY_COMPOSE" && test -r "$DEPLOY_COMPOSE" || {
  echo 'deployment docker-compose.yml is missing or unreadable' >&2
  exit 1
}
```

`DEPLOY_PROJECT` 固定为本指南使用的生产 project 名；若现有部署使用其他名称，必须在维护窗口前统一修改该值并用容器的 `com.docker.compose.project` 标签核对，不能临时依赖目录名推导。后续命令必须在保留这些变量和 `production_compose` 函数的同一 Shell 会话中执行；重新登录后先重新执行本节初始化与校验。

`.env` 包含数据库密码、完整数据库连接 URL、初始化 Token 和 OIDC 加密密钥，必须排除在版本控制、工单、聊天记录和命令跟踪之外。Compose 不再把原始密码拼接进 URL；`MOEURL_POSTGRES_PASSWORD` 交给 PostgreSQL 初始化，`MOEURL_DATABASE_URL` 作为已经正确编码的完整连接配置交给 App。以下命令使用只包含十六进制字符的随机数据库密码，并为 OIDC 生成独立的 Base64 密钥。执行前将公共地址替换为实际公网 HTTPS Origin：

```bash
test ! -e "$DEPLOY_ENV" || {
  echo 'deployment .env already exists; use the separate password-rotation procedure' >&2
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
} > "$DEPLOY_ENV"
unset database_password oidc_encryption_key
chmod 600 "$DEPLOY_ENV"
```

确认文件只对部署账号可读：

```bash
test -f "$DEPLOY_ENV" && test -r "$DEPLOY_ENV" || {
  echo 'deployment .env is missing or unreadable' >&2
  exit 1
}
stat -c '%a %U:%G %n' "$DEPLOY_ENV"

production_compose() {
  docker compose \
    --project-name "$DEPLOY_PROJECT" \
    --project-directory "$DEPLOY_ROOT" \
    --env-file "$DEPLOY_ENV" \
    -f "$DEPLOY_COMPOSE" \
    "$@"
}
```

`MOEURL_SETUP_TOKEN` 至少为 32 个字符。初始化完成后仍需保留该变量，因为 production 应用每次启动都会校验配置。自定义数据库密码包含 `/`、`?`、`#`、`%` 等 URI 保留字符时，必须先对密码部分做百分号编码，再写入 `MOEURL_DATABASE_URL`；`MOEURL_POSTGRES_PASSWORD` 仍保存原始值。数据库密码轮换必须使用独立维护流程，在维护窗口内同时修改 PostgreSQL 角色密码、`MOEURL_POSTGRES_PASSWORD` 和 `MOEURL_DATABASE_URL`，不能重新运行首次生成命令或只改其中一项。

默认 `sslmode=disable` 只适用于 PostgreSQL 不发布端口、Compose 网络仅包含受信容器的单机边界，这是本部署模式明确接受的风险。若数据库链路经过不受信网络，应把 `MOEURL_DATABASE_URL` 改为 `sslmode=verify-full`，使用与连接主机名匹配的服务端证书，并确保签发 CA 已进入 App 容器的系统信任库或通过受审查的 Compose override 只读挂载后由 `sslrootcert` 指定。PostgreSQL 服务端证书配置和 CA 生命周期不由默认 Compose 管理；无法建立该信任链时不得把数据库开放给不受信网络。

## 4. 首次启动

先解析最终配置。该命令缺少数据库密码时必须失败；缺少初始化 Token 的 production 容器必须在应用配置校验阶段拒绝启动：

```bash
production_compose config >/dev/null
```

构建并启动：

```bash
production_compose up --build -d
production_compose ps
```

使用有超时的轮询等待 readiness，不要用一次固定等待代替状态检查：

```bash
deadline=$(( $(date +%s) + 120 ))
until curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/api/v1/health/ready >/dev/null; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo 'readiness timeout' >&2; exit 1; }
  sleep 1
done
```

随后通过 HTTPS 打开 `/setup`，输入 `.env` 中的初始化 Token，创建站点和管理员。完成后验证：

```bash
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 https://go.example.com/api/v1/health/live
curl --fail --silent --show-error --connect-timeout 2 --max-time 5 https://go.example.com/api/v1/health/ready
```

不要把 Token 放到 URL、Shell 参数、截图或代理访问日志中。初始化请求必须使用 JSON 请求体并经 HTTPS 发送。

### 4.1 启用 OIDC

`MOEURL_PUBLIC_BASE_URL` 必须与用户实际访问的公网 HTTPS Origin 完全一致，只包含 scheme、host 和可选端口。`MOEURL_OIDC_ENCRYPTION_KEY` 必须是 Base64 编码的 32 字节随机值。两项配置必须同时存在；若数据库中已有启用的 provider，缺少任一项时 App 会拒绝启动。

管理员在「身份认证」页面创建 provider 后，到身份提供商登记以下固定回调地址：

```text
https://<公网域名>/api/v1/auth/oidc/<provider-key>/callback
```

反向代理必须保留外部 HTTPS 地址语义。OIDC callback 的访问日志不得记录查询参数，公开工单和调试日志同样不得包含 `code` 或 `state`；只记录请求方法、路径、状态码和必要的运维字段。MoeURL 只使用配置的公共地址生成 callback，不信任请求 `Host`。加密密钥不得在线随意轮换；丢失或更换后，既有 Client Secret 无法解密，必须停用 provider 并用受控流程重新录入。数据库恢复时必须同时恢复原加密密钥，详见 [PostgreSQL 备份与隔离恢复](backup-and-restore.md)。

## 5. 外部 TLS 反向代理

### 5.1 Caddy

标准 Caddy 可以负责证书、HSTS 和可信转发头：

```caddyfile
go.example.com {
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    reverse_proxy 127.0.0.1:8080 {
        header_up Host {host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
        header_up -X-MoeURL-Country-Code
    }
}
```

Caddy 标准发行版不提供通用请求限流指令。公网部署必须在到达 Caddy 前使用受信边缘代理或防火墙实施本节 5.4 的来源级限流，或者使用经过固定版本、审查和升级验证的限流模块。不能因为使用 Caddy 而省略限流。

若启用 Caddy 或上游边缘代理的访问日志，必须为 OIDC callback 删除查询参数或使用只记录路径的日志字段，确认导出的日志不包含 `code` 和 `state` 后才可接入集中日志系统。

只有在该域名及其所有子域都长期强制 HTTPS 后才启用示例中的 `includeSubDomains`；否则应先使用不包含该参数的 HSTS 策略。

### 5.2 Nginx

在 `http` 块定义按真实连接来源地址计数的区域：

```nginx
limit_req_zone $binary_remote_addr zone=moeurl_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=moeurl_setup:10m rate=2r/m;
limit_req_zone $binary_remote_addr zone=moeurl_unlock:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=moeurl_oidc_start:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=moeurl_oidc_callback:10m rate=10r/m;
log_format moeurl_path_only '$remote_addr [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent';
```

站点配置示例使用 Nginx 1.25.1 及更高版本的独立 HTTP/2 指令：

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name go.example.com;

    ssl_certificate /etc/letsencrypt/live/go.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/go.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    limit_req_status 429;

    location = /api/v1/auth/login {
        limit_req zone=moeurl_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/snippets/moeurl-proxy-headers.conf;
    }

    location = /api/v1/init/setup {
        limit_req zone=moeurl_setup burst=2 nodelay;
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/snippets/moeurl-proxy-headers.conf;
    }

    location ~ ^/go/[^/]+/unlock$ {
        limit_req zone=moeurl_unlock burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/snippets/moeurl-proxy-headers.conf;
    }

    location ~ ^/api/v1/auth/oidc/[^/]+/start$ {
        limit_req zone=moeurl_oidc_start burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/snippets/moeurl-proxy-headers.conf;
    }

    location ~ ^/api/v1/auth/oidc/[^/]+/callback$ {
        limit_req zone=moeurl_oidc_callback burst=10 nodelay;
        access_log /var/log/nginx/access.log moeurl_path_only;
        error_log /var/log/nginx/error.log crit;
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/snippets/moeurl-proxy-headers.conf;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        include /etc/nginx/snippets/moeurl-proxy-headers.conf;
    }
}
```

`/etc/nginx/snippets/moeurl-proxy-headers.conf`：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-MoeURL-Country-Code "";
proxy_http_version 1.1;
```

若 Nginx 前还有 CDN 或负载均衡器，必须先配置可信代理地址与 Real IP 模块，再把恢复后的可信来源用于限流。不得直接信任任意客户端提供的 `X-Forwarded-For`。

同样，只有确认全部子域都支持 HTTPS 后才保留 Nginx 示例中的 `includeSubDomains`。

### 5.3 匿名国家维度 Header

默认示例删除 `X-MoeURL-Country-Code`，不会把客户端同名 Header 传给 App。若设置 `MOEURL_ANALYTICS_COUNTRY_HEADER=X-MoeURL-Country-Code`，TLS 信任边界必须先覆盖或删除客户端值，再只从可信 Geo 数据源设置规范的两个大写英文字母国家码。

Nginx 使用本机可信 GeoIP2 数据时，可以在 `http` 块先规范化模块输出：

```nginx
map $geoip2_data_country_code $moeurl_country_code {
    default "";
    "~^[A-Z]{2}$" $geoip2_data_country_code;
}
```

随后把 snippet 中的清空指令替换为 `proxy_set_header X-MoeURL-Country-Code $moeurl_country_code;`。该值来自本机 Geo 模块，会覆盖客户端同名 Header。若 Geo 信息由上游边缘代理提供，主机防火墙必须只允许该可信代理连接 Caddy/Nginx，并在公网边缘先删除客户端同名 Header、校验后再写入国家码；不能在允许客户端直连的入口原样转发该 Header。没有可信 Geo 数据源时保持清空，并不要启用 `MOEURL_ANALYTICS_COUNTRY_HEADER`。

### 5.4 必须限流的端点

至少按来源地址独立限制：

- `POST /api/v1/auth/login`
- `POST /api/v1/init/setup`
- `POST /go/*/unlock`
- `GET /api/v1/auth/oidc/*/start`
- `GET /api/v1/auth/oidc/*/callback`

应用内账号级登录保护、短链级密码保护和 OIDC 进程并发槽位不能替代来源级限流。限额应根据正常用户流量调整，并对 HTTP `429`、异常峰值和代理错误率建立监控。

## 6. 日常操作与开发覆盖

普通停止保留 PostgreSQL 命名卷：

```bash
production_compose down
```

本地确需直连 PostgreSQL 时，显式叠加开发覆盖文件；它只把数据库绑定到本机回环地址：

```bash
test -f "$DEPLOY_DEV_COMPOSE" && test -r "$DEPLOY_DEV_COMPOSE" || {
  echo 'development Compose override is missing or unreadable' >&2
  exit 1
}
production_compose -f "$DEPLOY_DEV_COMPOSE" up --build
```

不要在生产启动命令中加入 `docker-compose.dev.yml`。

> **数据破坏警告：** `production_compose down -v` 会永久删除 `DEPLOY_PROJECT` 对应的 PostgreSQL 卷、管理员、短链和配置。执行前必须完成并验证卷外备份，且先用 `docker compose ls` 和资源标签确认 project。配置可用性只通过 `production_compose config >/dev/null` 验证；渲染结果可能包含秘密，不得将未重定向的配置输出记录到终端、CI 日志或工单。生产日常停止不得使用 `-v`。

隔离 Compose 自动验收入口：

```bash
bash "$DEPLOY_ROOT/scripts/compose-smoke.sh" --config-only
bash "$DEPLOY_ROOT/scripts/compose-smoke.sh"
```

两种 smoke 模式都使用 Node.js 解析 Compose JSON；`--config-only` 也必须提供 Node.js。完整 smoke 还必须使用项目目标运行时 Node.js 26.x，固定使用 `moeurl-compose-smoke` project；检测到同名资源时会拒绝复用。脚本只清理带该 project 标签的容器、网络和卷。

App 的 Compose 停止宽限期为 20 秒，长于应用内部 15 秒统一关闭期限。Docker 在发送强制终止信号前会留出应用完成 HTTP、后台清理和数据库关闭的时间；升级工具不得把该值缩短到 15 秒以内。
