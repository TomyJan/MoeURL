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
  const nextJobMatch = /\r?\n {2}[a-z0-9-]+:\r?\n/.exec(remainder)
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

  it('injects a complete encoded database URL instead of interpolating a raw password', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')
    const smokeScript = readFileSync(resolve(repositoryRoot, 'scripts/compose-smoke.sh'), 'utf8')

    expect(compose).toContain('MOEURL_DATABASE_URL: ${MOEURL_DATABASE_URL:?required}')
    expect(compose).not.toContain('postgres://moeurl:${MOEURL_POSTGRES_PASSWORD')
    expect(smokeScript).toContain("database_password='compose/reserved?password#100%'")
    expect(smokeScript).toContain('encodeURIComponent(process.argv[1])')
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
    expect(backendSecurity).toContain('golang.org/x/vuln/cmd/govulncheck@v1.1.4')
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
