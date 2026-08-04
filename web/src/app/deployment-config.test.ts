import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { loadConfigFromFile } from 'vite'
import { describe, expect, it } from 'vitest'

import playwrightConfig from '../../playwright.config'

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
}

function configuredChunkGroups(config: LoadedViteConfig) {
  return config.build?.rolldownOptions?.output?.codeSplitting?.groups
}

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

  it('allows a cold Docker image build to finish before Playwright starts', () => {
    expect(playwrightConfig.webServer).not.toBeInstanceOf(Array)
    expect(playwrightConfig.webServer).toMatchObject({ timeout: 600_000 })
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
