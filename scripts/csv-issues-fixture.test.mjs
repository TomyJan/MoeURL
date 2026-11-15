import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runCsvIssueScenario } from '../web/e2e/csv-issues-fixture.ts'

// The real lifecycle must change server-side ownership state and release a real handle.
// Only the external browser boundary and HTTP failures are controlled here; no source-text checks.
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'moeurl-csv-fixture-'))
  const handle = await open(join(directory, 'browser-context'), 'wx+')
  const state = { users: [], links: [], operations: [] }
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
      const send = (data, code = 0) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code, data })) }
      if (path === '/state') { send(state); return }
      state.operations.push({ path, body })
      if (path === '/api/v1/auth/login') { send({}); return }
      if (path === '/api/v1/admin/user/create') {
        if (options.createFailure) { send({}, 7001); return }
        assert.equal(body.groupKey, 'admin'); assert.equal(body.status, 'active')
        const user = { id: 'owned-user', username: body.username, status: 'active' }
        state.users.push(user); send({ user: { id: user.id, username: user.username } }); return
      }
      if (path === '/api/v1/short-link/list') {
        if (options.listFailure) { send({}, 7002); return }
        send({ items: state.links }); return
      }
      if (path === '/api/v1/admin/short-link/delete') {
        if (options.deleteFailure && body.id === 'owned-first') { send({}, 7003); return }
        state.links = state.links.filter(link => link.id !== body.id); send({}); return
      }
      if (path === '/api/v1/admin/user/update') {
        assert.equal(body.id, 'owned-user'); assert.equal(body.status, 'disabled')
        if (options.disableFailure) { send({}, 7004); return }
        state.users[0].status = 'disabled'; send({}); return
      }
      if (path === '/owned-links') {
        state.links = [{ id: 'owned-first' }, { id: 'owned-second' }]; send({}); return
      }
      throw new Error('Unexpected fixture endpoint: ' + path)
    } catch (error) { response.writeHead(500); response.end(String(error)) }
  })
  // Register cleanup before listen, so even a startup failure releases the exact owned resources.
  t.after(async () => {
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await handle.close()
    await rm(directory, { recursive: true, force: true })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const baseURL = 'http://127.0.0.1:' + server.address().port
  const request = async (path, data) => {
    const response = await fetch(baseURL + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(5_000) })
    return { status: () => response.status, json: () => response.json() }
  }
  const api = { get: path => request(path), post: (path, { data }) => request(path, data) }
  const page = { request: api }
  const context = {
    request: api,
    addInitScript: async () => undefined,
    newPage: async () => { if ('pageFailure' in options) throw options.pageFailure; return page },
    close: async () => { await handle.close(); if ('closeFailure' in options) throw options.closeFailure },
  }
  const browser = {
    version: () => 'controlled-browser-boundary',
    newContext: async () => { if ('contextFailure' in options) throw options.contextFailure; return context },
  }
  const touchPages = new WeakSet()
  const info = { project: { use: { baseURL } }, title: 'v0.82.0 en 390px', outputPath: name => join(directory, name), attach: async () => { if ('attachmentFailure' in options) throw options.attachmentFailure } }
  const run = use => runCsvIssueScenario({ browser, page }, use, info, { username: 'fixture-admin', password: 'fixture-only' }, touchPages)
  const read = async () => (await (await request('/state')).json()).data
  const addLinks = async () => request('/owned-links', {})
  const closed = () => assert.rejects(handle.stat(), { code: 'EBADF' })
  return { run, read, addLinks, closed, page, touchPages }
}

test('disables the created account when browser context initialization fails', async t => {
  const original = new Error('browser context initialization rejected')
  const f = await fixture(t, { contextFailure: original })
  await assert.rejects(f.run(async () => assert.fail('scenario must not run')), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [original]); return true
  })
  assert.equal((await f.read()).users[0].status, 'disabled')
  assert.equal((await f.read()).operations.some(operation => operation.path.includes('short-link/')), false)
})

test('retains initialization and disable failures', async t => {
  const original = new Error('browser context initialization rejected')
  const f = await fixture(t, { contextFailure: original, disableFailure: true })
  await assert.rejects(f.run(async () => assert.fail('scenario must not run')), error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 2)
    assert.equal(error.errors[0], original); assert.ok(error.errors[1] instanceof Error); return true
  })
  assert.equal((await f.read()).users[0].status, 'active')
})

test('continues every cleanup after body and deletion failures', async t => {
  const original = new Error('original scenario assertion'), closing = new Error('close reported failure after release')
  const f = await fixture(t, { deleteFailure: true, disableFailure: true, closeFailure: closing })
  await assert.rejects(f.run(async () => { await f.addLinks(); throw original }), error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 4)
    assert.equal(error.errors[0], original); assert.ok(error.errors[1] instanceof Error)
    assert.ok(error.errors[2] instanceof Error); assert.equal(error.errors[3], closing); return true
  })
  const state = await f.read()
  assert.deepEqual(state.links, [{ id: 'owned-first' }])
  assert.equal(state.users[0].status, 'active')
  assert.deepEqual(state.operations.filter(operation => operation.path.endsWith('/delete') || operation.path.endsWith('/update')).map(operation => operation.body.id), ['owned-first', 'owned-second', 'owned-user'])
  await f.closed()
})

test('still disables and closes after list failure', async t => {
  const original = new Error('scenario failed'), f = await fixture(t, { listFailure: true })
  await assert.rejects(f.run(async () => { throw original }), error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 2)
    assert.equal(error.errors[0], original); assert.ok(error.errors[1] instanceof Error); return true
  })
  assert.equal((await f.read()).users[0].status, 'disabled'); await f.closed()
})

test('does not disable an uncreated account', async t => {
  const f = await fixture(t, { createFailure: true, contextFailure: new Error('must not create a context') })
  await assert.rejects(f.run(async () => assert.fail('scenario must not run')), error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 1); return true
  })
  const state = await f.read()
  assert.deepEqual(state.users, []); assert.deepEqual(state.links, [])
  assert.deepEqual(state.operations.map(operation => operation.path), ['/api/v1/auth/login', '/api/v1/admin/user/create'])
})

test('successful scenario deletes owned links and closes context', async t => {
  const f = await fixture(t)
  await f.run(async ({ page, user }) => {
    assert.equal(page, f.page); assert.equal(user.id, 'owned-user')
    assert.equal(f.touchPages.has(page), true); await f.addLinks()
  })
  const state = await f.read()
  assert.equal(state.users[0].status, 'disabled'); assert.deepEqual(state.links, []); await f.closed()
})

test('runtime attachment failure still disables and releases the context', async t => {
  const original = new Error('runtime attachment failed'), f = await fixture(t, { attachmentFailure: original })
  await assert.rejects(f.run(async () => assert.fail('scenario must not run')), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [original]); return true
  })
  assert.equal((await f.read()).users[0].status, 'disabled'); await f.closed()
})

test('page initialization failure still disables and releases the context', async t => {
  const original = new Error('newPage rejected'), f = await fixture(t, { pageFailure: original })
  await assert.rejects(f.run(async () => assert.fail('scenario must not run')), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [original]); return true
  })
  assert.equal((await f.read()).users[0].status, 'disabled'); await f.closed()
})

for (const original of [undefined, null, false, 0, '']) {
  test('preserves falsey rejection: ' + String(original), async t => {
    const f = await fixture(t)
    await assert.rejects(f.run(async () => { throw original }), error => {
      assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [original]); return true
    })
    assert.equal((await f.read()).users[0].status, 'disabled'); await f.closed()
  })
}
