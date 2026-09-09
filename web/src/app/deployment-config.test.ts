import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { loadConfigFromFile } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const repositoryRoot = resolve(__dirname, '../../..')

type RolldownChunkGroup = {
  name?: string
  test?: RegExp
}

type LoadedViteConfig = {
  build?: {
    chunkSizeWarningLimit?: number
    rolldownOptions?: {
      output?: {
        codeSplitting?: {
          groups?: RolldownChunkGroup[]
          maxSize?: unknown
        }
      }
    }
  }
  server?: {
    proxy?: Record<string, unknown>
  }
}

/** Returns configured manual chunk groups in a normalized assertion shape. */
function configuredChunkGroups(config: LoadedViteConfig) {
  return config.build?.rolldownOptions?.output?.codeSplitting?.groups
}

/** Returns one top-level workflow job so assertions cannot match unrelated jobs. */
function workflowJob(workflow: string, jobName: string) {
  const marker = `  ${jobName}:`
  const start = workflow.indexOf(marker)
  if (start < 0) {
    return ''
  }
  const remainder = workflow.slice(start + marker.length)
  const nextJobMatch = /\r?\n {2}[A-Za-z0-9_-]+:\r?\n/.exec(remainder)
  const end = nextJobMatch
    ? start + marker.length + nextJobMatch.index
    : workflow.length
  return workflow.slice(start, end)
}

describe('deployment configuration', () => {
  beforeEach(() => {
    vi.stubEnv('MOEURL_E2E_SKIP_DOCKER', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('keeps the development PostgreSQL volume on the established mount path', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toContain('postgres-data:/var/lib/postgresql')
    expect(compose).not.toContain('PGDATA:')
    expect(compose).not.toContain('postgres-data:/var/lib/postgresql/data')
  })

  it('keeps the default Compose environment aligned with production cookie security', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(compose).toContain('MOEURL_ENV: ${MOEURL_ENV:-production}')
    expect(config).toContain("MOEURL_ENV: 'development'")
  })

  it('keeps PostgreSQL internal by default and gives E2E an isolated database secret', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')
    const developmentCompose = readFileSync(resolve(repositoryRoot, 'docker-compose.dev.yml'), 'utf8')
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(compose).not.toContain('MOEURL_POSTGRES_PORT')
    expect(developmentCompose).toContain('${MOEURL_POSTGRES_HOST:-127.0.0.1}:${MOEURL_POSTGRES_PORT:-5432}:5432')
    expect(config).toContain('MOEURL_E2E_POSTGRES_PASSWORD')
    expect(config).toContain('MOEURL_POSTGRES_PASSWORD: e2ePostgresPassword')
    expect(config).toContain('MOEURL_DATABASE_URL: e2eDatabaseURL')
    expect(config).not.toContain('MOEURL_E2E_POSTGRES_PORT')
  })

  it('splits workflow jobs whose identifiers contain uppercase letters or underscores', () => {
    const workflow = [
      'jobs:',
      '  first-job:',
      '    runs-on: ubuntu-latest',
      '  NEXT_JOB:',
      '    runs-on: windows-latest',
      '',
    ].join('\n')

    expect(workflowJob(workflow, 'first-job')).toContain('runs-on: ubuntu-latest')
    expect(workflowJob(workflow, 'first-job')).not.toContain('NEXT_JOB')
  })

  it('injects a complete encoded database URL instead of interpolating a raw password', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')
    const exampleEnv = readFileSync(resolve(repositoryRoot, '.env.example'), 'utf8')
    const readme = readFileSync(resolve(repositoryRoot, 'README.md'), 'utf8')
    const smokeScript = readFileSync(resolve(repositoryRoot, 'scripts/compose-smoke.sh'), 'utf8')

    expect(compose).toContain('MOEURL_DATABASE_URL: ${MOEURL_DATABASE_URL:?required}')
    expect(compose).not.toContain('postgres://moeurl:${MOEURL_POSTGRES_PASSWORD')
    expect(smokeScript).toContain("database_password='compose/reserved?password#100%'")
    expect(smokeScript).toContain('encodeURIComponent(process.argv[1])')
    expect(readme).toContain('MOEURL_POSTGRES_PASSWORD')
    expect(readme).toContain('完整值使用单引号')
    expect(readme).toContain('$VAR')
    expect(readme).toContain('$' + '{VAR}')
    expect(readme).toContain('%24')
    expect(exampleEnv).toContain('complete password value in single quotes')
    expect(exampleEnv).toContain('$VAR')
    expect(exampleEnv).toContain('$' + '{VAR}')
    expect(exampleEnv).toContain('MOEURL_DATABASE_URL')
    expect(exampleEnv).toContain('%24')
  })

  it('leaves the setup token optional for development Compose processes', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')

    expect(compose).toContain('MOEURL_SETUP_TOKEN: ${MOEURL_SETUP_TOKEN:-}')
  })

  it('aligns the production container identity and shutdown budget', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')
    const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8')

    expect(dockerfile).toContain('addgroup -S -g 10001 moeurl')
    expect(dockerfile).toContain('adduser -S -D -H -u 10001 -G moeurl moeurl')
    expect(dockerfile).toContain('apk upgrade --no-cache')
    expect(dockerfile).toContain('github.com/pressly/goose/v3/cmd/goose@v3.28.0')
    expect(compose).toContain('user: "10001:10001"')
    expect(compose).toContain('stop_grace_period: 20s')
  })

  it('keeps local Playwright browser caches out of the Docker build context', () => {
    const dockerIgnore = readFileSync(resolve(repositoryRoot, '.dockerignore'), 'utf8')

    expect(dockerIgnore.split(/\r?\n/)).toContain('web/.pw-browsers*')
  })

  it('keeps E2E Compose cleanup isolated from the default development project', () => {
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(config).toContain('MOEURL_E2E_COMPOSE_PROJECT')
    expect(config).toContain("execFileSync(\\'docker\\'")
    expect(config).toContain("\\'compose\\', \\'-p\\'")
    expect(config).toContain("\\'down\\', \\'-v\\'")
    expect(config).not.toContain('catch {}')
    expect(config).not.toContain('docker compose down -v && docker compose up --build')
    expect(config).not.toContain('down -v && docker compose')
  })

  it('rejects Compose project names that are unsafe for destructive E2E cleanup', { timeout: 30_000 }, async () => {
    const playwrightConfig = await import('../../playwright.config')
    const resolveProjectName = (playwrightConfig as unknown as {
      resolveE2EComposeProjectName?: (value: string | undefined, port: string) => string
    }).resolveE2EComposeProjectName

    expect(resolveProjectName).toBeTypeOf('function')
    expect(resolveProjectName?.(undefined, '18081')).toBe('moeurl-e2e-18081')
    expect(resolveProjectName?.('moeurl-e2e-review_42', '18081')).toBe('moeurl-e2e-review_42')
    for (const unsafeName of ['moeurl', 'moeurl-dev', 'production', 'moeurl-e2e-', 'MoeURL-e2e-review']) {
      expect(() => resolveProjectName?.(unsafeName, '18081')).toThrow(/isolated E2E Compose project/)
    }
  })

  it('documents safe Compose project verification without logging rendered secrets', () => {
    const deploymentGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/single-host-compose.md'),
      'utf8',
    )

    expect(deploymentGuide).not.toContain('config --format json')
    expect(deploymentGuide).toContain('docker compose ls')
    expect(deploymentGuide).toContain('production_compose config >/dev/null')
    expect(deploymentGuide).toContain('不得将未重定向的配置输出记录到终端、CI 日志或工单')
  })

  it('anchors single-host Compose operations to one validated deployment root and project', () => {
    const deploymentGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/single-host-compose.md'),
      'utf8',
    )
    const composeHelper = deploymentGuide.indexOf('production_compose()')

    for (const marker of [
      ': "${MOEURL_DEPLOY_ROOT:?',
      'case "$MOEURL_DEPLOY_ROOT" in',
      'DEPLOY_ROOT="$(CDPATH= cd -- "$MOEURL_DEPLOY_ROOT" && pwd -P)"',
      'DEPLOY_PROJECT=moeurl',
      'DEPLOY_COMPOSE="$DEPLOY_ROOT/docker-compose.yml"',
      'DEPLOY_ENV="$DEPLOY_ROOT/.env"',
      'DEPLOY_DEV_COMPOSE="$DEPLOY_ROOT/docker-compose.dev.yml"',
      'test -r "$DEPLOY_COMPOSE"',
      'test -r "$DEPLOY_ENV"',
    ]) {
      const position = deploymentGuide.indexOf(marker)
      expect(position).toBeGreaterThanOrEqual(0)
      expect(position).toBeLessThan(composeHelper)
    }

    expect(deploymentGuide).toContain('--project-name "$DEPLOY_PROJECT"')
    expect(deploymentGuide).toContain('--project-directory "$DEPLOY_ROOT"')
    expect(deploymentGuide).toContain('--env-file "$DEPLOY_ENV"')
    expect(deploymentGuide).toContain('-f "$DEPLOY_COMPOSE"')
    expect(deploymentGuide).toContain('production_compose config >/dev/null')
    expect(deploymentGuide).toContain('production_compose up --build -d')
    expect(deploymentGuide).toContain('production_compose down')
    expect(deploymentGuide).toContain('production_compose down -v')
    expect(deploymentGuide).toContain('production_compose -f "$DEPLOY_DEV_COMPOSE" up --build')
    expect(deploymentGuide).not.toContain('docker compose --env-file .env')
  })

  it('bounds both production readiness probes with the same transport timeouts', () => {
    const singleHostGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/single-host-compose.md'),
      'utf8',
    )
    const upgradeGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/upgrade-and-recovery.md'),
      'utf8',
    )
    const readinessProbe = 'curl --fail --silent --show-error --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/api/v1/health/ready >/dev/null'

    expect(singleHostGuide).toContain(`until ${readinessProbe}; do`)
    expect(upgradeGuide).toContain(`until ${readinessProbe}; do`)
  })

  it('uses bounded curl probes for external deployment health checks', () => {
    const singleHostGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/single-host-compose.md'),
      'utf8',
    )
    const upgradeGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/upgrade-and-recovery.md'),
      'utf8',
    )
    const restoreGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/backup-and-restore.md'),
      'utf8',
    )
    const curlOptions = '--fail --silent --show-error --connect-timeout 2 --max-time 5'

    expect(singleHostGuide).toContain(
      `curl ${curlOptions} https://go.example.com/api/v1/health/live`,
    )
    expect(singleHostGuide).toContain(
      `curl ${curlOptions} https://go.example.com/api/v1/health/ready`,
    )
    expect(upgradeGuide).toContain(
      `curl ${curlOptions} https://go.example.com/api/v1/health/ready`,
    )
    expect(restoreGuide).toContain(
      `until curl ${curlOptions} http://127.0.0.1:18082/api/v1/health/ready >/dev/null; do`,
    )
  })

  it('stops restore before health polling when PostgreSQL cannot start', () => {
    const restoreGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/backup-and-restore.md'),
      'utf8',
    )

    expect(restoreGuide).toContain(
      "restore_compose up -d postgres || {\n  echo 'restore postgres container failed to start' >&2\n  exit 1\n}",
    )
    expect(restoreGuide).toContain(
      "test -n \"$postgres_id\" || {\n  echo 'restore postgres container was not found' >&2\n  exit 1\n}",
    )
  })

  it('stops backup before pg_dump when the production PostgreSQL identity is invalid', () => {
    const backupGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/backup-and-restore.md'),
      'utf8',
    )

    expect(backupGuide).toContain(
      `test -n "$postgres_id" || {\n  echo 'production postgres container was not found' >&2\n  exit 1\n}`,
    )
    expect(backupGuide).toContain(
      `test "$postgres_project" = "$DEPLOY_PROJECT" || {\n  echo 'production postgres container project does not match DEPLOY_PROJECT' >&2\n  exit 1\n}`,
    )
  })

  it('keeps the technical baseline Compose commands independent of the working directory', () => {
    const baseline = readFileSync(
      resolve(repositoryRoot, 'docs/implementation/technical-baseline.md'),
      'utf8',
    )

    expect(baseline).toContain('[单机 Docker Compose 部署](../deployment/single-host-compose.md)')
    expect(baseline).toContain('production_compose config >/dev/null')
    expect(baseline).toContain('production_compose up --build -d')
    expect(baseline).not.toContain('docker compose --env-file .env config >/dev/null')
    expect(baseline).not.toContain('docker compose --env-file .env up --build -d')
  })

  it('refuses to overwrite an existing README deployment environment file', () => {
    const readme = readFileSync(resolve(repositoryRoot, 'README.md'), 'utf8')
    const existenceCheck = readme.indexOf('test ! -e .env || {')
    const environmentWrite = readme.indexOf('} > .env')

    expect(existenceCheck).toBeGreaterThanOrEqual(0)
    expect(existenceCheck).toBeLessThan(environmentWrite)
    expect(readme).toContain("echo '.env already exists; preserve it or move it explicitly before creating a new file' >&2")
  })

  it('requires an empty restore project before destructive database restore', () => {
    const restoreGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/backup-and-restore.md'),
      'utf8',
    )

    for (const resource of ['restore_container_ids', 'restore_volume_names', 'restore_network_ids']) {
      expect(restoreGuide).toContain(`${resource}="$(docker`)
      expect(restoreGuide).toContain(`test -z "$${resource}"`)
    }
    expect(restoreGuide).toContain("echo 'restore project resources already exist' >&2")
    expect(restoreGuide).toContain('exit 1')
    expect(restoreGuide).toContain(
      "test \"$RESTORE_PROJECT\" = moeurl-restore-drill || {\n  echo 'restore project must be moeurl-restore-drill before pg_restore --clean' >&2\n  exit 1\n}",
    )
    expect(restoreGuide).toContain(
      "test \"$RESTORE_PROJECT\" = moeurl-restore-drill || {\n  echo 'restore project must be moeurl-restore-drill before down -v' >&2\n  exit 1\n}",
    )
  })

  it('stops restore before destructive work when backup validation fails', () => {
    const restoreGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/backup-and-restore.md'),
      'utf8',
    )

    expect(restoreGuide).toContain(
      "test -s \"$backup_file\" || {\n  echo 'restore backup file is missing or empty' >&2\n  exit 1\n}",
    )
    expect(restoreGuide).toContain(
      "sha256sum --check \"$backup_file.sha256\" || {\n  echo 'restore backup checksum verification failed' >&2\n  exit 1\n}",
    )
  })

  it('stops maintenance workflows when critical restore or migration commands fail', () => {
    const restoreGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/backup-and-restore.md'),
      'utf8',
    )
    const upgradeGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/upgrade-and-recovery.md'),
      'utf8',
    )

    expect(restoreGuide).toContain(
      "if ! restore_compose exec -T postgres \\\n  pg_restore -U moeurl -d moeurl --clean --if-exists --exit-on-error < \"$backup_file\"; then\n  echo 'pg_restore failed; restored app was not started' >&2\n  exit 1\nfi",
    )
    expect(restoreGuide).toContain(
      "restore_compose up --build -d app || {\n  echo 'restored app failed to start' >&2\n  exit 1\n}",
    )
    expect(upgradeGuide).toContain(
      "target_compose stop app || {\n  echo 'target app failed to stop; migration was not started' >&2\n  exit 1\n}",
    )
    expect(upgradeGuide).toContain(
      "target_compose up -d postgres || {\n  echo 'target postgres container failed to start' >&2\n  exit 1\n}",
    )
    expect(upgradeGuide).toContain(
      "if ! target_compose run --rm --no-deps \\\n  --entrypoint /bin/sh app -c \\\n  'exec /app/goose -dir /app/migrations postgres \"$MOEURL_DATABASE_URL\" up'; then\n  echo 'target migration failed; target app was not started' >&2\n  exit 1\nfi",
    )
  })

  it('quotes the Nginx GeoIP country-code regular expression', () => {
    const deploymentGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/single-host-compose.md'),
      'utf8',
    )

    expect(deploymentGuide).toContain('"~^[A-Z]{2}$" $geoip2_data_country_code;')
    expect(deploymentGuide).not.toContain('\n    ~^[A-Z]{2}$ $geoip2_data_country_code;')
  })

  it('requires a validated absolute deployment root before upgrade Compose checks', () => {
    const upgradeGuide = readFileSync(
      resolve(repositoryRoot, 'docs/deployment/upgrade-and-recovery.md'),
      'utf8',
    )
    const requiredRoot = upgradeGuide.indexOf(': "${MOEURL_DEPLOY_ROOT:?')
    const absoluteRoot = upgradeGuide.indexOf('case "$MOEURL_DEPLOY_ROOT" in')
    const resolvedRoot = upgradeGuide.indexOf('DEPLOY_ROOT="$(CDPATH= cd -- "$MOEURL_DEPLOY_ROOT" && pwd -P)"')
    const directoryCheck = upgradeGuide.indexOf('test -d "$MOEURL_DEPLOY_ROOT"')
    const composeFileCheck = upgradeGuide.indexOf('test -f "$DEPLOY_COMPOSE"')
    const envFileCheck = upgradeGuide.indexOf('test -f "$DEPLOY_ENV"')
    const composeCheck = upgradeGuide.indexOf('test -r "$DEPLOY_COMPOSE"')
    const envCheck = upgradeGuide.indexOf('test -r "$DEPLOY_ENV"')
    const composeHelper = upgradeGuide.indexOf('production_compose()')

    for (const marker of [requiredRoot, absoluteRoot, resolvedRoot, directoryCheck, composeFileCheck, envFileCheck, composeCheck, envCheck]) {
      expect(marker).toBeGreaterThanOrEqual(0)
      expect(marker).toBeLessThan(composeHelper)
    }
  })

  it('rejects extra Compose smoke arguments before reporting config-only success', () => {
    const smokeScript = readFileSync(resolve(repositoryRoot, 'scripts/compose-smoke.sh'), 'utf8')
    const argumentValidation = smokeScript.indexOf('case "$#" in')
    const configSuccess = smokeScript.indexOf("printf 'Compose configuration assertions passed.\\n'")

    expect(argumentValidation).toBeGreaterThanOrEqual(0)
    expect(argumentValidation).toBeLessThan(configSuccess)
    expect(smokeScript).toContain('1) [ "$1" = "--config-only" ] || fail')
    expect(smokeScript).toContain('*) fail "usage: scripts/compose-smoke.sh [--config-only]" ;;')
  })

  it('does not rely on local Vuetify declarations for public exports', () => {
    const declarations = readFileSync(resolve(repositoryRoot, 'web/src/vuetify.d.ts'), 'utf8')

    expect(declarations).toContain("from 'vuetify'")
    expect(declarations).not.toContain('vuetify/lib/framework')
  })

  it('keeps large frontend dependencies in explicit Rolldown chunks', async () => {
    const loadedConfig = await loadConfigFromFile(
      { command: 'build', mode: 'test' },
      resolve(repositoryRoot, 'web/vite.config.ts'),
    )
    if (!loadedConfig) {
      throw new Error('expected Vite configuration to load')
    }
    const viteConfig = loadedConfig.config as LoadedViteConfig
    const groups = configuredChunkGroups(viteConfig)
    const vendorVue = groups?.find(({ name }) => name === 'vendor-vue')

    expect(groups?.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'vendor-vue',
      'vendor-vuetify',
      'vendor-chart',
      'vendor-qrcode',
    ]))
    expect(vendorVue?.test).toBeInstanceOf(RegExp)
    expect(vendorVue?.test?.test('C:/app/node_modules/vue-i18n/dist/vue-i18n.mjs')).toBe(true)
    expect(viteConfig.build?.chunkSizeWarningLimit).toBeUndefined()
    expect(viteConfig.build?.rolldownOptions?.output?.codeSplitting?.maxSize).toBeUndefined()
  })

  it('allows a cold Docker image build to finish before Playwright starts', { timeout: 30_000 }, async () => {
    const { default: playwrightConfig } = await import('../../playwright.config')

    expect(playwrightConfig.workers).toBeUndefined()
    expect(playwrightConfig.webServer).not.toBeInstanceOf(Array)
    expect(playwrightConfig.webServer).toMatchObject({ timeout: 600_000 })
    expect(playwrightConfig.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'setup', testMatch: '**/initialize.setup.ts' }),
      expect.objectContaining({
        name: 'chromium',
        dependencies: ['setup'],
        testIgnore: '**/initialize.setup.ts',
      }),
    ]))
  })

  it('proxies only short-link preview, unlock, and continue data routes during development', async () => {
    const loadedConfig = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      resolve(repositoryRoot, 'web/vite.config.ts'),
    )
    if (!loadedConfig) {
      throw new Error('expected Vite configuration to load')
    }
    const proxy = (loadedConfig.config as LoadedViteConfig).server?.proxy
    const goProxyEntry = Object.entries(proxy ?? {}).find(([context]) => context.startsWith('^/go/'))

    expect(proxy?.['/api']).toBe('http://127.0.0.1:8080')
    expect(goProxyEntry).toBeDefined()
    expect(goProxyEntry?.[1]).toBe('http://127.0.0.1:8080')
    const goDataRoute = new RegExp(goProxyEntry![0])
    expect(goDataRoute.test('/go/abc123/preview')).toBe(true)
    expect(goDataRoute.test('/go/abc123/preview?foo=1')).toBe(true)
    expect(goDataRoute.test('/go/abc123/unlock')).toBe(true)
    expect(goDataRoute.test('/go/abc123/continue')).toBe(true)
    expect(goDataRoute.test('/go/abc123')).toBe(false)
    expect(goDataRoute.test('/go/abc123/settings')).toBe(false)
  })

  it('registers only the Vuetify components used by the application', () => {
    const vuetify = readFileSync(resolve(repositoryRoot, 'web/src/app/vuetify.ts'), 'utf8')

    expect(vuetify).not.toContain("import * as components from 'vuetify/components'")
    for (const component of ['VAlert', 'VApp', 'VBtn', 'VDialog', 'VTextField']) {
      expect(vuetify).toContain(component)
    }
  })

  it('disables the Node 26 Web Storage global for Vitest workers', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'web/package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const vitestConfig = readFileSync(resolve(repositoryRoot, 'web/vitest.config.ts'), 'utf8')

    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts['test:coverage']).toBe('vitest run --coverage')
    expect(vitestConfig).toContain("execArgv: ['--no-experimental-webstorage']")
  })

  it('pins fatal backend and image security release gates', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/code-check.yml'), 'utf8')
    const backendSecurity = workflowJob(workflow, 'backend-security')
    const imageSecurity = workflowJob(workflow, 'image-security')

    expect(backendSecurity).toContain('go-version-file: go.mod')
    expect(backendSecurity).toContain('go test -race ./... -count=1')
    expect(backendSecurity).toContain('golang.org/x/vuln/cmd/govulncheck@v1.8.0')
    expect(backendSecurity).toContain('govulncheck ./...')
    expect(backendSecurity).toContain('github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0')
    expect(backendSecurity).toContain('git diff --exit-code -- internal/db/sqlc')
    expect(backendSecurity).toContain('git ls-files --others --exclude-standard -- internal/db/sqlc')

    expect(imageSecurity).toContain('docker build --tag moeurl:ci .')
    expect(imageSecurity).toContain(
      'aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25',
    )
    expect(imageSecurity).toContain('version: v0.74.0')
    expect(imageSecurity).toContain('severity: HIGH,CRITICAL')
    expect(imageSecurity).toContain("exit-code: '1'")
    expect(imageSecurity).not.toContain('continue-on-error: true')
    expect(imageSecurity).not.toContain('ignore-unfixed: true')
  })

  it('runs the complete Compose smoke with the target Node runtime', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/code-check.yml'), 'utf8')
    const composeSmoke = workflowJob(workflow, 'compose-smoke')
    const smokeScript = readFileSync(resolve(repositoryRoot, 'scripts/compose-smoke.sh'), 'utf8')

    expect(composeSmoke).toContain('node-version-file: web/package.json')
    expect(composeSmoke).toContain('bash scripts/compose-smoke.sh')
    expect(composeSmoke).not.toContain('--config-only')
    expect(composeSmoke).not.toContain('continue-on-error: true')
    expect(smokeScript).toContain('env -u MOEURL_ENV')
    expect(smokeScript).toContain('-u MOEURL_POSTGRES_PASSWORD')
    expect(smokeScript).toContain('-u MOEURL_DATABASE_URL')
    expect(smokeScript).toContain('-u MOEURL_SETUP_TOKEN')
    expect(smokeScript).toContain("assert(app.environment?.MOEURL_ENV === 'production'")
    expect(smokeScript).toContain('expected_migration_version=')
    expect(smokeScript).toContain('"$migration_version" = "$expected_migration_version"')
    expect(smokeScript).not.toContain('[ "$migration_version" = "11" ]')
    expect(smokeScript).not.toContain('database migration version is not 11')
  })

  it('keeps target-runtime acceptance pending until remote evidence exists', () => {
    const acceptance = readFileSync(
      resolve(repositoryRoot, 'docs/implementation/v0.6.0-acceptance.md'),
      'utf8',
    )

    expect(acceptance).toContain('生产验收尚未完成')
    expect(acceptance).toContain('- [ ] `govulncheck ./...` 通过。')
    expect(acceptance).toContain('- [ ] `cd web && pnpm test:e2e` 全量通过。')
    expect(acceptance).toContain('- [ ] 最终 Docker 镜像 HIGH、CRITICAL 漏洞扫描通过。')
    expect(acceptance).toContain('- [ ] production Compose smoke 和隔离恢复演练通过。')
  })

  it('keeps the detailed plan and local runtime evidence aligned with completed work', () => {
    const detailedPlan = readFileSync(
      resolve(repositoryRoot, 'docs/implementation/v0.6.0-detailed-plan.md'),
      'utf8',
    )
    const acceptance = readFileSync(
      resolve(repositoryRoot, 'docs/implementation/v0.6.0-acceptance.md'),
      'utf8',
    )

    expect(detailedPlan).not.toContain('以下代码与验收步骤尚未执行')
    expect(detailedPlan).toContain('- [x] **步骤 1：编写配置失败测试**')
    expect(detailedPlan).toContain('- [x] **步骤 5：编写并核验运维文档**')
    expect(detailedPlan).toContain('- [ ] **步骤 6：执行隔离恢复演练**')
    expect(acceptance).toContain('项目固定 pnpm `11.5.0`')
  })
})
