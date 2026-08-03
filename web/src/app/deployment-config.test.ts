import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(__dirname, '../../..')

describe('deployment configuration', () => {
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

  it('allows the PostgreSQL host port to be isolated for E2E', () => {
    const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8')
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(compose).toContain('${MOEURL_POSTGRES_PORT:-5432}:5432')
    expect(config).toContain('MOEURL_E2E_POSTGRES_PORT')
    expect(config).toContain('MOEURL_POSTGRES_PORT: e2ePostgresPort')
  })

  it('keeps E2E Compose cleanup isolated from the default development project', () => {
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(config).toContain('MOEURL_E2E_COMPOSE_PROJECT')
    expect(config).toContain("execFileSync(\\'docker\\'")
    expect(config).toContain("\\'compose\\', \\'-p\\'")
    expect(config).toContain("\\'down\\', \\'-v\\'")
    expect(config).toContain('catch')
    expect(config).not.toContain('docker compose down -v && docker compose up --build')
    expect(config).not.toContain('down -v && docker compose')
  })

  it('does not rely on local Vuetify declarations for public exports', () => {
    const declarations = readFileSync(resolve(repositoryRoot, 'web/src/vuetify.d.ts'), 'utf8')

    expect(declarations).toContain("from 'vuetify'")
    expect(declarations).not.toContain('vuetify/lib/framework')
  })

  it('keeps large frontend dependencies in explicit Rolldown chunks', () => {
    const config = readFileSync(resolve(repositoryRoot, 'web/vite.config.ts'), 'utf8')

    expect(config).toContain('rolldownOptions')
    expect(config).toContain('codeSplitting')
    expect(config).toContain("name: 'vendor-vue'")
    expect(config).toMatch(/vendor-vue[\s\S]*vue-i18n/)
    expect(config).toContain("name: 'vendor-vuetify'")
    expect(config).toContain("name: 'vendor-chart'")
    expect(config).toContain("name: 'vendor-qrcode'")
    expect(config).not.toContain('maxSize')
    expect(config).not.toContain('chunkSizeWarningLimit')
  })

  it('allows a cold Docker image build to finish before Playwright starts', () => {
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(config).toMatch(/webServer:[\s\S]*timeout: 600_000/)
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
})
