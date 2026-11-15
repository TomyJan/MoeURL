import assert from 'node:assert/strict'
import { appendFile, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectSettingsCleanupErrors, withSettingsCleanup } from '../web/e2e/settings-dialog-cleanup.ts'

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

// A finally rejection must not replace the body error or prevent later actual file cleanup.
test('body and recovery failures retain both original objects and still remove the owned file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-recovery-'))
  const own = join(dir, 'owned-link'), order = join(dir, 'recovery-order')
  const original = new Error('original settings assertion'), recovery = new Error('network recovery rejected')
  await writeFile(own, 'fixture')
  try {
    let escaped
    try {
      await withSettingsCleanup(
        async () => { await writeFile(order, 'body'); throw original },
        [async () => { await appendFile(order, '|release') }, async () => { await appendFile(order, '|restore'); throw recovery }, () => rm(own)],
      )
    } catch (error) { escaped = error }
    assert.ok(escaped instanceof AggregateError)
    assert.deepEqual(escaped.errors, [original, recovery])
    assert.equal(escaped.errors[0], original)
    assert.equal(escaped.errors[1], recovery)
    assert.equal(await readFile(order, 'utf8'), 'body|release|restore')
    await assert.rejects(stat(own), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('synchronous release failure also retains an asynchronous restoration failure and later cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-recovery-')), own = join(dir, 'owned-link')
  const original = new Error('settings assertion'), release = new Error('release failed'), restore = new Error('restore failed')
  await writeFile(own, 'fixture')
  try {
    await assert.rejects(withSettingsCleanup(() => { throw original }, [
      () => { throw release }, async () => { throw restore }, () => rm(own),
    ]), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [original, release, restore])
      return true
    })
    await assert.rejects(stat(own), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a successful body runs exactly once and cleanup-only failures still reject after all steps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-recovery-')), own = join(dir, 'owned-link')
  const first = new Error('first cleanup'), second = new Error('second cleanup')
  try {
    await assert.rejects(withSettingsCleanup(() => writeFile(own, 'created once', { flag: 'wx' }), [
      () => { throw first }, async () => { throw second }, () => rm(own),
    ]), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [first, second])
      return true
    })
    await assert.rejects(stat(own), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('only a body failure remains failed after successful cleanup without flattening its identity', async () => {
  const nested = new AggregateError([new Error('nested original')], 'body aggregate')
  await assert.rejects(withSettingsCleanup(() => { throw nested }, []), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.errors.length, 1)
    assert.equal(error.errors[0], nested)
    return true
  })
})

for (const value of [undefined, null, false, 0, '']) {
  test('falsey body rejection remains a failure: ' + String(value), async () => {
    await assert.rejects(withSettingsCleanup(async () => { throw value }, []), error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [value])
      return true
    })
  })
}

test('successful body and ordered cleanup resolve without repeating the body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moeurl-settings-recovery-')), own = join(dir, 'sequence')
  try {
    assert.equal(await withSettingsCleanup(() => writeFile(own, 'body', { flag: 'wx' }), [
      () => appendFile(own, '|release'), async () => assert.equal(await readFile(own, 'utf8'), 'body|release'), () => rm(own),
    ]), undefined)
    await assert.rejects(stat(own), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
