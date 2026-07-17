import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('accepts excluded blocks when compiler column positions differ', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moeurl-coverage-'))
  const coveragePath = join(directory, 'coverage.out')
  const targetsPath = join(directory, 'targets.txt')
  const excludedPath = join(directory, 'excluded.txt')
  const sourcePath = 'github.com/TomyJan/MoeURL/internal/auth/service.go'

  writeFileSync(coveragePath, `mode: set\n${sourcePath}:48.1,50.99 1 0\n`)
  writeFileSync(targetsPath, `${sourcePath}\n`)
  writeFileSync(excludedPath, `${sourcePath}:48.16,50.3\n`)

  try {
    const result = spawnSync(process.execPath, [
      'scripts/go-coverage-threshold.mjs',
      coveragePath,
      '100',
      `--include-from=${targetsPath}`,
      `--exclude-blocks-from=${excludedPath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Go coverage: 100\.00%/)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('accepts configured exclusions when compiler line positions shift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moeurl-coverage-'))
  const coveragePath = join(directory, 'coverage.out')
  const targetsPath = join(directory, 'targets.txt')
  const excludedPath = join(directory, 'excluded.txt')
  const sourcePath = 'github.com/TomyJan/MoeURL/internal/auth/service.go'

  writeFileSync(coveragePath, `mode: set\n${sourcePath}:148.1,150.99 1 0\n`)
  writeFileSync(targetsPath, `${sourcePath}\n`)
  writeFileSync(excludedPath, `${sourcePath}:48.16,50.3\n`)

  try {
    const result = spawnSync(process.execPath, [
      'scripts/go-coverage-threshold.mjs',
      coveragePath,
      '100',
      `--include-from=${targetsPath}`,
      `--exclude-blocks-from=${excludedPath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Go coverage: 100\.00%/)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('accepts remaining exclusions when only some locations shift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moeurl-coverage-'))
  const coveragePath = join(directory, 'coverage.out')
  const targetsPath = join(directory, 'targets.txt')
  const excludedPath = join(directory, 'excluded.txt')
  const sourcePath = 'github.com/TomyJan/MoeURL/internal/auth/service.go'

  writeFileSync(coveragePath, `mode: set\n${sourcePath}:48.1,50.99 1 0\n${sourcePath}:148.1,150.99 1 0\n`)
  writeFileSync(targetsPath, `${sourcePath}\n`)
  writeFileSync(excludedPath, `${sourcePath}:48.16,50.3\n${sourcePath}:58.16,60.3\n`)

  try {
    const result = spawnSync(process.execPath, [
      'scripts/go-coverage-threshold.mjs',
      coveragePath,
      '100',
      `--include-from=${targetsPath}`,
      `--exclude-blocks-from=${excludedPath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Go coverage: 100\.00%/)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('accepts a shifted exclusion when another configured block is covered', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moeurl-coverage-'))
  const coveragePath = join(directory, 'coverage.out')
  const targetsPath = join(directory, 'targets.txt')
  const excludedPath = join(directory, 'excluded.txt')
  const sourcePath = 'github.com/TomyJan/MoeURL/internal/auth/service.go'

  writeFileSync(coveragePath, `mode: set\n${sourcePath}:48.1,50.99 1 1\n${sourcePath}:148.1,150.99 1 0\n`)
  writeFileSync(targetsPath, `${sourcePath}\n`)
  writeFileSync(excludedPath, `${sourcePath}:48.16,50.3\n${sourcePath}:58.16,60.3\n`)

  try {
    const result = spawnSync(process.execPath, [
      'scripts/go-coverage-threshold.mjs',
      coveragePath,
      '100',
      `--include-from=${targetsPath}`,
      `--exclude-blocks-from=${excludedPath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Go coverage: 100\.00%/)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('rejects additional uncovered blocks after line positions shift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'moeurl-coverage-'))
  const coveragePath = join(directory, 'coverage.out')
  const targetsPath = join(directory, 'targets.txt')
  const excludedPath = join(directory, 'excluded.txt')
  const sourcePath = 'github.com/TomyJan/MoeURL/internal/auth/service.go'

  writeFileSync(coveragePath, `mode: set\n${sourcePath}:148.1,150.99 1 0\n${sourcePath}:160.1,162.99 1 0\n`)
  writeFileSync(targetsPath, `${sourcePath}\n`)
  writeFileSync(excludedPath, `${sourcePath}:48.16,50.3\n`)

  try {
    const result = spawnSync(process.execPath, [
      'scripts/go-coverage-threshold.mjs',
      coveragePath,
      '100',
      `--include-from=${targetsPath}`,
      `--exclude-blocks-from=${excludedPath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Go coverage must be at least 100%/)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
