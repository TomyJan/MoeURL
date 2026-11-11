import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { evaluateBudget, inspectTemporaryFiles, parseDockerReclaimable } from './check-temp-budget.mjs'

const evidence = fileURLToPath(new URL('../.tmp/v0612-evidence/', import.meta.url))

async function fixture(t) {
  await mkdir(evidence, { recursive: true })
  const base = await mkdtemp(join(evidence, 'budget-fixture-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const roots = [join(base, 'worktree', '.tmp'), join(base, 'main', '.tmp')]
  for (const root of roots) await mkdir(root, { recursive: true })
  async function put(root, relative, bytes) {
    const path = join(root, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.alloc(bytes, 0x61))
    return path
  }
  return { base, roots, put }
}

// Omitting a second root, loose files, or nested active output must break this test.
test('counts both roots, loose files and active descendants without changing them', async t => {
  const { roots, put } = await fixture(t)
  const kept = await put(roots[0], 'loose.log', 11)
  await put(roots[0], 'current/deep/output.bin', 7)
  await put(roots[0], 'shared/cache.bin', 13)
  await put(roots[1], 'current/report.json', 17)
  await put(roots[1], 'old/raw.log', 19)
  const before = await stat(kept)
  const result = await inspectTemporaryFiles(roots, 'current')
  assert.equal(result.activeBytes, 24)
  assert.equal(result.totalBytes, 67)
  assert.equal(result.files, 5)
  assert.equal(result.roots.length, 2)
  assert.equal(result.symlinksSkipped, 0)
  assert.equal(await readFile(kept, 'utf8'), 'aaaaaaaaaaa')
  assert.equal((await stat(kept)).mtimeMs, before.mtimeMs)
})

test('does not charge the same physical root twice', async t => {
  const { roots, put } = await fixture(t)
  await put(roots[0], 'current/kept.bin', 5)
  const result = await inspectTemporaryFiles([roots[0], join(roots[0], '.')], 'current')
  assert.equal(result.totalBytes, 5)
  assert.equal(result.activeBytes, 5)
  assert.equal(result.roots.length, 1)
})

test('counts active directory names using host path case rules', async t => {
  const { roots, put } = await fixture(t)
  await put(roots[0], 'Current/kept.bin', 5)
  const result = await inspectTemporaryFiles(roots, 'current')
  assert.equal(result.totalBytes, 5)
  assert.equal(result.activeBytes, process.platform === 'win32' ? 5 : 0)
})

test('skips directory links and cycles while preserving their external target', async t => {
  const { base, roots, put } = await fixture(t)
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'kept'), 'external bytes')
  await put(roots[0], 'current/small', 3)
  await symlink(outside, join(roots[0], 'linked-cache'), 'junction')
  await symlink(roots[0], join(roots[0], 'loop'), 'junction')
  const result = await inspectTemporaryFiles([roots[0]], 'current')
  assert.equal(result.totalBytes, 3)
  assert.equal(result.activeBytes, 3)
  assert.equal(result.symlinksSkipped, 2)
  assert.equal(await readFile(join(outside, 'kept'), 'utf8'), 'external bytes')
})

test('rejects absent, non-directory, linked and overlapping managed roots', async t => {
  const { base, roots, put } = await fixture(t)
  const fileRoot = await put(roots[0], 'file/.tmp', 1)
  const nested = join(roots[0], 'nested', '.tmp')
  const linked = join(base, 'linked', '.tmp')
  await mkdir(nested, { recursive: true })
  await mkdir(dirname(linked), { recursive: true })
  await symlink(roots[0], linked, 'junction')
  for (const candidates of [[], [join(base, 'absent', '.tmp')], [fileRoot], [linked], [roots[0], nested], [base]]) {
    await assert.rejects(inspectTemporaryFiles(candidates, 'current'))
  }
})

test('rejects active paths that could escape or blur ownership', async t => {
  const { roots } = await fixture(t)
  for (const active of ['', '.', '..', '../current', 'one/two', 'one\\two', '/current', 'C:current']) {
    await assert.rejects(inspectTemporaryFiles(roots, active))
  }
})

// A missing reserve or a relaxed comparison must reject exactly the wrong operation.
test('allows exact limits and refuses a reserve crossing any individual budget', () => {
  assert.equal(evaluateBudget({ activeBytes: 4294967296, totalBytes: 12884901888, dockerCacheBytes: 6442450944, reserveBytes: 0 }).allowed, true)
  for (const [input, violation] of [
    [{ activeBytes: 4294967296, totalBytes: 4294967296, dockerCacheBytes: 0, reserveBytes: 1 }, 'active'],
    [{ activeBytes: 0, totalBytes: 12884901888, dockerCacheBytes: 0, reserveBytes: 1 }, 'total'],
    [{ activeBytes: 0, totalBytes: 0, dockerCacheBytes: 6442450944, reserveBytes: 1 }, 'docker'],
  ]) {
    const result = evaluateBudget(input)
    assert.equal(result.allowed, false)
    assert.deepEqual(result.violations, [violation])
  }
})

test('rejects invalid capacity numbers rather than treating them as empty', () => {
  const valid = { activeBytes: 0, totalBytes: 0, dockerCacheBytes: 0, reserveBytes: 0 }
  for (const field of Object.keys(valid)) {
    for (const bad of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
      assert.throws(() => evaluateBudget({ ...valid, [field]: bad }))
    }
  }
  assert.throws(() => evaluateBudget({ ...valid, activeBytes: 1 }))
  assert.throws(() => evaluateBudget({ ...valid, totalBytes: Number.MAX_SAFE_INTEGER, reserveBytes: 1 }))
})

function dockerRows(value) {
  return JSON.stringify({ Type: 'Images', Reclaimable: '8GB (50%)' }) + '\n' + JSON.stringify({ Type: 'Build Cache', Reclaimable: value }) + '\n'
}

test('uses only Docker build cache and reserves margin for rounded CLI units', () => {
  assert.equal(parseDockerReclaimable(dockerRows('4.684GB')), 4700777216)
  assert.equal(parseDockerReclaimable(dockerRows('4.684GB (50%)')), 4700777216)
  assert.equal(parseDockerReclaimable(dockerRows('0B')), 16777216)
  assert.equal(parseDockerReclaimable(dockerRows('1.5kB')), 16778716)
})

test('rejects missing, ambiguous, malformed or unsafe Docker inventory', () => {
  for (const output of ['', 'not json', '{}', dockerRows('1GiB'), dockerRows('-1GB'), dockerRows('NaNGB'), dockerRows('1GB extra'), dockerRows('1GB (101%)'), dockerRows('9007199254740992TB'), dockerRows(null), dockerRows('1GB') + dockerRows('2GB')]) {
    assert.throws(() => parseDockerReclaimable(output))
  }
})

const cliPath = fileURLToPath(new URL('./check-temp-budget.mjs', import.meta.url))
function cli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 10_000 })
}

test('CLI reports a real read-only snapshot and returns nonzero before oversized work', async t => {
  const { roots, put } = await fixture(t)
  const kept = await put(roots[0], 'current/kept', 1)
  const before = await stat(kept)
  const args = ['--root', roots[0], '--active', 'current']
  const accepted = cli([...args, '--reserve-mib', '0'])
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.notEqual(accepted.stdout.trim(), '', 'Accepted work requires an actual capacity report')
  assert.equal(JSON.parse(accepted.stdout).totalBytes, 1)
  const refused = cli([...args, '--reserve-mib', '4096'])
  assert.equal(refused.status, 1, refused.stderr)
  assert.deepEqual(JSON.parse(refused.stdout).violations, ['active'])
  assert.equal(await readFile(kept, 'utf8'), 'a')
  assert.equal((await stat(kept)).mtimeMs, before.mtimeMs)
})

test('CLI refuses malformed or incomplete options without silently weakening a budget', async t => {
  const { roots } = await fixture(t)
  const valid = ['--root', roots[0], '--active', 'current']
  for (const args of [[], ['--unknown'], ['--root'], [...valid, '--active', 'other'], [...valid, '--docker', '--docker'], [...valid, '--reserve-mib'], [...valid, '--reserve-mib', '-1'], [...valid, '--reserve-mib', '1.5'], [...valid, '--reserve-mib', '1e3'], [...valid, '--reserve-mib', '9007199254740991']]) {
    const result = cli(args)
    assert.equal(result.status, 2, JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }))
    assert.equal(result.stdout, '')
  }
})
