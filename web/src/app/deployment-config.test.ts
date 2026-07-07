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
})
