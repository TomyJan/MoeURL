#!/bin/sh
set -eu

PATH="/usr/bin:/bin:$PATH"
export PATH

PROJECT_NAME="moeurl-compose-smoke"
REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE="$REPOSITORY_ROOT/docker-compose.yml"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/moeurl-compose-smoke.XXXXXX")
CONFIG_ENV="$WORK_DIR/config.env"
RUNTIME_ENV="$WORK_DIR/runtime.env"
CONFIG_JSON="$WORK_DIR/compose-config.json"
DEV_CONFIG_JSON="$WORK_DIR/compose-dev-config.json"
BASE_URL=""
PROJECT_STARTED=0

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  if [ "$PROJECT_STARTED" -eq 1 ]; then
    if ! cleanup_project_resources; then
      printf 'compose smoke warning: isolated project cleanup did not complete\n' >&2
      if [ "$exit_code" -eq 0 ]; then
        exit_code=1
      fi
    fi
  fi
  rm -rf -- "$WORK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'compose smoke failed: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

run_compose() {
  env -u MOEURL_ENV \
    -u MOEURL_HTTP_HOST \
    -u MOEURL_HTTP_PORT \
    -u MOEURL_ANALYTICS_COUNTRY_HEADER \
    -u MOEURL_POSTGRES_PASSWORD \
    -u MOEURL_SETUP_TOKEN \
    -u MOEURL_POSTGRES_HOST \
    -u MOEURL_POSTGRES_PORT \
    docker compose "$@"
}

write_config_env() {
  umask 077
  cat >"$CONFIG_ENV" <<'EOF'
MOEURL_ENV=production
MOEURL_POSTGRES_PASSWORD=config-validation-password
MOEURL_SETUP_TOKEN=config-validation-token-with-32-characters
MOEURL_ANALYTICS_COUNTRY_HEADER=X-MoeURL-Country-Code
EOF
}

assert_missing_password_fails() {
  missing_env="$WORK_DIR/missing-password.env"
  : >"$missing_env"
  if run_compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$missing_env" \
    --file "$COMPOSE_FILE" \
    config --format json >"$WORK_DIR/missing-password.json" 2>"$WORK_DIR/missing-password.stderr"; then
    fail "docker compose config accepted a missing database password"
  fi
}

assert_production_config() {
  run_compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$CONFIG_ENV" \
    --file "$COMPOSE_FILE" \
    config --format json >"$CONFIG_JSON"

  node - "$CONFIG_JSON" <<'NODE'
const fs = require('node:fs')

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const app = config.services?.app
const postgres = config.services?.postgres

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(app && postgres, 'app and postgres services must exist')
assert(app.environment?.MOEURL_ENV === 'production', 'app must use the production environment')
assert(!postgres.ports || postgres.ports.length === 0, 'postgres must not publish a host port')
assert(postgres.environment?.POSTGRES_PASSWORD === 'config-validation-password', 'postgres must use the required deployment password')
assert(app.environment?.MOEURL_DATABASE_URL?.includes(':config-validation-password@postgres:5432/'), 'app database URL must use the deployment password')
assert(app.environment?.MOEURL_ANALYTICS_COUNTRY_HEADER === 'X-MoeURL-Country-Code', 'app must receive the configured trusted country header')

const appPort = (app.ports || []).find((port) => Number(port.target) === 8080)
assert(appPort, 'app must publish container port 8080')
assert(appPort.host_ip === '127.0.0.1', 'app must bind to 127.0.0.1 by default')
assert(String(appPort.published) === '8080', 'app must publish port 8080 by default')

assert(String(app.user) === '10001:10001', 'app must use the image UID and GID 10001')
assert(app.read_only === true, 'app root filesystem must be read-only')
assert(Array.isArray(app.tmpfs) && app.tmpfs.some((entry) => String(entry).split(':')[0] === '/tmp'), 'app must mount /tmp as tmpfs')
assert(app.init === true, 'app must enable an init process')
assert(app.healthcheck && Array.isArray(app.healthcheck.test), 'app healthcheck must exist')
assert(app.healthcheck.test.join(' ').includes('/api/v1/health/ready'), 'app healthcheck must use readiness')
assert(app.restart === 'unless-stopped', 'app restart policy must be unless-stopped')
const stopGracePeriod = String(app.stop_grace_period || '')
const stopGraceMatch = stopGracePeriod.match(/^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)$/)
const durationFactors = { ns: 1e-9, us: 1e-6, 'µs': 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 }
const stopGraceSeconds = stopGraceMatch
  ? Number(stopGraceMatch[1]) * durationFactors[stopGraceMatch[2]]
  : Number.NaN
assert(Number.isFinite(stopGraceSeconds) && stopGraceSeconds > 15, 'app stop grace period must exceed the 15-second shutdown budget')
assert(postgres.healthcheck && Array.isArray(postgres.healthcheck.test), 'postgres healthcheck must exist')
assert(postgres.restart === 'unless-stopped', 'postgres restart policy must be unless-stopped')
NODE
}

assert_development_override() {
  run_compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$CONFIG_ENV" \
    --file "$COMPOSE_FILE" \
    --file "$REPOSITORY_ROOT/docker-compose.dev.yml" \
    config --format json >"$DEV_CONFIG_JSON"

  node - "$DEV_CONFIG_JSON" <<'NODE'
const fs = require('node:fs')
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const ports = config.services?.postgres?.ports || []
const postgresPort = ports.find((port) => Number(port.target) === 5432)
if (!postgresPort || postgresPort.host_ip !== '127.0.0.1' || String(postgresPort.published) !== '5432') {
  throw new Error('development override must publish PostgreSQL only on 127.0.0.1:5432')
}
NODE
}

project_resource_ids() {
  resource_file="$WORK_DIR/project-resources"
  : >"$resource_file"
  docker ps --all --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME" >>"$resource_file" || return 1
  docker network ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME" >>"$resource_file" || return 1
  docker volume ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME" >>"$resource_file" || return 1
  sed '/^[[:space:]]*$/d' "$resource_file"
}

assert_project_absent() {
  resource_ids=$(project_resource_ids) || fail "could not inspect isolated Docker project resources"
  if [ -n "$resource_ids" ]; then
    fail "isolated project already has Docker resources; inspect and remove it before retrying"
  fi
}

down_project() {
  run_compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" \
    --file "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1
}

cleanup_project_resources() {
  down_failed=0
  if ! down_project; then
    down_failed=1
    printf 'compose smoke warning: isolated project down command failed\n' >&2
  fi

  resource_ids=$(project_resource_ids) || return 1
  if [ -n "$resource_ids" ]; then
    printf 'compose smoke warning: isolated project resources remain; retrying cleanup\n' >&2
    if ! down_project; then
      down_failed=1
      printf 'compose smoke warning: isolated project cleanup retry failed\n' >&2
    fi
    resource_ids=$(project_resource_ids) || return 1
  fi

  [ -z "$resource_ids" ] || return 1
  [ "$down_failed" -eq 0 ]
}

require_docker_engine() {
  if ! docker info >/dev/null; then
    fail "Docker Engine is unavailable"
  fi
}

generate_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
}

write_runtime_env() {
  database_password=$(generate_secret)
  setup_token=$(generate_secret)
  admin_password=$(generate_secret)
  runtime_port=${MOEURL_SMOKE_HTTP_PORT:-18081}

  umask 077
  cat >"$RUNTIME_ENV" <<EOF
MOEURL_ENV=production
MOEURL_HTTP_HOST=127.0.0.1
MOEURL_HTTP_PORT=$runtime_port
MOEURL_POSTGRES_PASSWORD=$database_password
MOEURL_SETUP_TOKEN=$setup_token
EOF
  # curl treats localhost as a secure cookie context, so production Secure
  # Session cookies remain usable without weakening MOEURL_ENV.
  BASE_URL="http://localhost:$runtime_port"
  export setup_token admin_password
}

wait_for_readiness() {
  deadline=$(( $(date +%s) + 120 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl --fail --silent --show-error "$BASE_URL/api/v1/health/ready" >"$WORK_DIR/readiness.json" 2>/dev/null \
      && node -e "const r=require(process.argv[1]);process.exit(r.code===0&&r.data?.status==='ok'?0:1)" "$WORK_DIR/readiness.json"; then
      return 0
    fi
    run_compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" --file "$COMPOSE_FILE" \
      ps --status exited --quiet app | grep -q . && fail "app exited before becoming ready"
    sleep 1
  done
  fail "readiness did not succeed before the timeout"
}

write_request_files() {
  node - "$WORK_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const directory = process.argv[2]
const setup = {
  adminUsername: 'smokeadmin',
  adminPassword: process.env.admin_password,
  adminNickname: 'Smoke Admin',
  siteName: 'MoeURL Smoke',
  systemDomain: '127.0.0.1',
  shortLinkDomain: '127.0.0.1',
  defaultLanguage: 'zh-CN',
  defaultTheme: 'system',
}
fs.writeFileSync(path.join(directory, 'setup-missing-token.json'), JSON.stringify(setup), { mode: 0o600 })
fs.writeFileSync(path.join(directory, 'setup-valid.json'), JSON.stringify({ ...setup, setupToken: process.env.setup_token }), { mode: 0o600 })
fs.writeFileSync(path.join(directory, 'login.json'), JSON.stringify({ username: setup.adminUsername, password: setup.adminPassword }), { mode: 0o600 })
fs.writeFileSync(path.join(directory, 'short-link.json'), JSON.stringify({
  targetUrl: 'https://example.com/moeurl-compose-smoke',
  redirectMode: 'direct',
}), { mode: 0o600 })
NODE
}

post_json() {
  request_file=$1
  response_file=$2
  shift 2
  curl --fail --silent --show-error \
    --header 'Content-Type: application/json' \
    --data-binary "@$request_file" \
    "$@" >"$response_file"
}

assert_response_code() {
  response_file=$1
  expected_code=$2
  node - "$response_file" "$expected_code" <<'NODE'
const fs = require('node:fs')
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const expected = Number(process.argv[3])
if (payload.code !== expected) {
  throw new Error(`unexpected business code: ${payload.code}`)
}
NODE
}

assert_secret_absent() {
  response_file=$1
  node - "$response_file" <<'NODE'
const fs = require('node:fs')
const response = fs.readFileSync(process.argv[2], 'utf8')
if (response.includes(process.env.setup_token)) {
  throw new Error('setup response exposed the deployment credential')
}
NODE
}

login_admin() {
  post_json "$WORK_DIR/login.json" "$WORK_DIR/login-response.json" \
    --cookie-jar "$WORK_DIR/cookies.txt" "$BASE_URL/api/v1/auth/login"
  assert_response_code "$WORK_DIR/login-response.json" 0
  node - "$WORK_DIR/cookies.txt" <<'NODE'
const fs = require('node:fs')
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/)
const cookies = lines
  .filter((line) => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
  .map((line) => line.split('\t'))
if (!cookies.some((fields) => fields[3] === 'TRUE')) {
  throw new Error('production login must issue a Secure Session cookie')
}
NODE
}

assert_persisted_link() {
  curl --fail --silent --show-error --cookie "$WORK_DIR/cookies.txt" \
    "$BASE_URL/api/v1/short-link/list?page=1&pageSize=20" >"$WORK_DIR/list-response.json"
  node - "$WORK_DIR/list-response.json" <<'NODE'
const fs = require('node:fs')
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const found = payload.code === 0 && payload.data?.items?.some((item) =>
  item.targetUrl === 'https://example.com/moeurl-compose-smoke' && item.redirectMode === 'direct')
if (!found) {
  throw new Error('created short link was not retained after app restart')
}
NODE
}

assert_database_state() {
  migration_version=$(run_compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" --file "$COMPOSE_FILE" \
    exec -T postgres psql -U moeurl -d moeurl -Atc \
    "select max(version_id) from goose_db_version where is_applied" | tr -d '\r')
  [ "$migration_version" = "11" ] || fail "database migration version is not 11"

  builtin_groups=$(run_compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" --file "$COMPOSE_FILE" \
    exec -T postgres psql -U moeurl -d moeurl -Atc \
    "select count(*) from user_group where builtin and key in ('guest','user','admin')" | tr -d '\r')
  [ "$builtin_groups" = "3" ] || fail "built-in user groups are incomplete"
}

run_full_smoke() {
  require_command curl
  require_docker_engine
  assert_project_absent
  write_runtime_env
  write_request_files

  PROJECT_STARTED=1
  run_compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" --file "$COMPOSE_FILE" \
    up --build --detach
  wait_for_readiness

  post_json "$WORK_DIR/setup-missing-token.json" "$WORK_DIR/setup-missing-response.json" \
    "$BASE_URL/api/v1/init/setup"
  assert_response_code "$WORK_DIR/setup-missing-response.json" 900102
  assert_secret_absent "$WORK_DIR/setup-missing-response.json"

  post_json "$WORK_DIR/setup-valid.json" "$WORK_DIR/setup-valid-response.json" \
    "$BASE_URL/api/v1/init/setup"
  assert_response_code "$WORK_DIR/setup-valid-response.json" 0
  assert_secret_absent "$WORK_DIR/setup-valid-response.json"

  login_admin
  post_json "$WORK_DIR/short-link.json" "$WORK_DIR/short-link-response.json" \
    --cookie "$WORK_DIR/cookies.txt" "$BASE_URL/api/v1/short-link/create"
  assert_response_code "$WORK_DIR/short-link-response.json" 0
  assert_database_state

  run_compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" --file "$COMPOSE_FILE" restart app
  wait_for_readiness
  login_admin
  assert_persisted_link

  cleanup_project_resources || fail "isolated project cleanup failed"
  assert_project_absent
  PROJECT_STARTED=0
}

require_command docker
require_command node
write_config_env
assert_missing_password_fails
assert_production_config
assert_development_override

if [ "${1:-}" = "--config-only" ]; then
  printf 'Compose configuration assertions passed.\n'
  exit 0
fi
if [ "$#" -ne 0 ]; then
  fail "usage: scripts/compose-smoke.sh [--config-only]"
fi

run_full_smoke
printf 'Compose smoke assertions passed.\n'
