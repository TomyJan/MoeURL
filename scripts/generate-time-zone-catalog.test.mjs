import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generateTimeZoneMigration, renderTimeZoneMigration } from './generate-time-zone-catalog.mjs'

test('generates once, verifies read-only, and refuses to overwrite historical output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-time-zones-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const output = join(dir, 'migration.sql')
  await assert.rejects(generateTimeZoneMigration(output, true), /missing/)
  const text = await generateTimeZoneMigration(output)
  assert.equal(await readFile(output, 'utf8'), text)
  assert.equal(await generateTimeZoneMigration(output, true), text)
  assert.equal(await generateTimeZoneMigration(output), text)
  await writeFile(output, 'historical bytes')
  await assert.rejects(generateTimeZoneMigration(output), /Refusing to overwrite/)
  await assert.rejects(generateTimeZoneMigration(output, true), /Refusing to overwrite/)
  assert.equal(await readFile(output, 'utf8'), 'historical bytes')
})

test('corrupt source values cannot produce permissive or injected SQL', () => {
  for (const value of [null, {}, [], [null], [1], ['UTC', 'UTC'], ['UTC', 'Asia/Tokyo'], ['../Asia/Tokyo'], ["x');drop table app_user;--"], ['Asia/Tokyo']]) {
    assert.throws(() => renderTimeZoneMigration(value), /Invalid/)
  }
})

test('CLI rejects unexpected arguments without writing a migration', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./generate-time-zone-catalog.mjs', import.meta.url)), '--unknown'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Only --check/)
})
