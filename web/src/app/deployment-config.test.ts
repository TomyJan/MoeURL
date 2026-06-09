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

  it('keeps E2E Compose cleanup isolated from the default development project', () => {
    const config = readFileSync(resolve(repositoryRoot, 'web/playwright.config.ts'), 'utf8')

    expect(config).toContain('MOEURL_E2E_COMPOSE_PROJECT')
    expect(config).toContain('docker compose -p')
    expect(config).toContain('down -v')
    expect(config).not.toContain('docker compose down -v && docker compose up --build')
  })
})
