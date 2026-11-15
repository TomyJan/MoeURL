import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectSettingsCleanupErrors } from '../web/e2e/settings-dialog-cleanup.ts'

// A rejected attachment must not leak the owned file/handle or erase the original test error.
test('attachment failure preserves errors and still deletes the owned file and closes its handle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-cleanup-'))
  const own = join(dir, 'owned-link'), restored = join(dir, 'connection-restored')
  const handle = await open(own, 'w+')
  const original = new Error('original test failure'), errors = [original]
  try {
    let escaped
    try {
      await collectSettingsCleanupErrors(errors, [
        () => writeFile(restored, 'online'),
        () => writeFile(dir, 'cannot write an attachment over a directory'),
        () => rm(own),
        () => handle.close(),
      ])
    } catch (error) { escaped = error }
    assert.equal(escaped, undefined, 'attachment errors must be collected rather than escape cleanup')
    assert.equal(await readFile(restored, 'utf8'), 'online')
    await assert.rejects(stat(own), { code: 'ENOENT' })
    await assert.rejects(handle.stat(), { code: 'EBADF' })
    assert.equal(errors.length, 2)
    assert.equal(errors[0], original)
    assert.ok(errors[1] instanceof Error)
  } finally { await handle.close(); await rm(dir, { recursive: true, force: true }) }
})

test('synchronous and asynchronous failures both preserve later real file cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-cleanup-'))
  const own = join(dir, 'owned-link')
  await writeFile(own, 'fixture')
  const synchronous = new Error('connection recovery failed'), asynchronous = new Error('attachment upload failed')
  const errors = []
  try {
    await collectSettingsCleanupErrors(errors, [
      () => { throw synchronous },
      async () => { throw asynchronous },
      () => rm(own),
    ])
    await assert.rejects(stat(own), { code: 'ENOENT' })
    assert.deepEqual(errors, [synchronous, asynchronous])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('successful cleanup steps retain order and introduce no errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-cleanup-'))
  const own = join(dir, 'sequence'), errors = []
  try {
    await collectSettingsCleanupErrors(errors, [
      () => writeFile(own, 'attached'),
      async () => assert.equal(await readFile(own, 'utf8'), 'attached'),
      () => rm(own),
    ])
    await assert.rejects(stat(own), { code: 'ENOENT' })
    assert.deepEqual(errors, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
