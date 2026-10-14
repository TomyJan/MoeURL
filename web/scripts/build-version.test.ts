import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadBuildMetadata, resolveBuildMetadata } from './build-version.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('build version metadata', () => {
  it('links an exact semantic version tag to that tag', () => {
    expect(resolveBuildMetadata({ packageVersion: '0.11.0', commit: 'a'.repeat(40), tag: 'v0.11.0' })).toEqual({
      label: 'V0.11.0',
      url: 'https://github.com/TomyJan/MoeURL/tree/v0.11.0',
    })
  })

  it('links an untagged commit version to the exact source commit', () => {
    expect(resolveBuildMetadata({ packageVersion: '0.11.0', commit: '1234567890abcdef'.repeat(2) + '12345678' })).toEqual({
      label: 'V0.11.0-1234567',
      url: 'https://github.com/TomyJan/MoeURL/commit/1234567890abcdef1234567890abcdef12345678',
    })
  })

  it('derives an exact tag from the checked out commit and rejects a missing Docker commit', () => {
    const repository = createRepository()
    const commit = git(repository, 'rev-parse', 'HEAD')
    git(repository, 'tag', 'v0.11.0')

    expect(loadBuildMetadata(repository, {}, '0.11.0')).toEqual({
      label: 'V0.11.0',
      url: 'https://github.com/TomyJan/MoeURL/tree/v0.11.0',
    })
    expect(() => resolveBuildMetadata({ packageVersion: '0.11.0', commit: '', tag: '' })).toThrow(/commit/i)

    git(repository, 'tag', '-d', 'v0.11.0')
    expect(loadBuildMetadata(repository, { MOEURL_BUILD_COMMIT: commit }, '0.11.0')).toEqual({
      label: `V0.11.0-${commit.slice(0, 7)}`,
      url: `https://github.com/TomyJan/MoeURL/commit/${commit}`,
    })
  }, 30_000)

  it('ignores non-version tags and resolves tags against the configured source commit', () => {
    const repository = createRepository()
    const commit = git(repository, 'rev-parse', 'HEAD')
    git(repository, 'tag', 'latest')
    expect(loadBuildMetadata(repository, {})).toEqual({
      label: `V0.11.0-${commit.slice(0, 7)}`,
      url: `https://github.com/TomyJan/MoeURL/commit/${commit}`,
    })
    git(repository, 'tag', 'v0.11.0')
    git(repository, 'commit', '--allow-empty', '-m', 'next source commit')
    expect(loadBuildMetadata(repository, { MOEURL_BUILD_COMMIT: commit })).toEqual({
      label: 'V0.11.0', url: 'https://github.com/TomyJan/MoeURL/tree/v0.11.0',
    })
  }, 30_000)

  it('builds without Git using explicit source metadata and rejects a missing source', () => {
    const directory = mkdtempSync(join(tmpdir(), 'moeurl-build-source-'))
    temporaryDirectories.push(directory)
    expect(loadBuildMetadata(directory, { MOEURL_BUILD_COMMIT: 'a'.repeat(40), MOEURL_BUILD_TAG: '' }, '0.11.0')).toEqual({
      label: 'V0.11.0-aaaaaaa', url: `https://github.com/TomyJan/MoeURL/commit/${'a'.repeat(40)}`,
    })
    expect(() => loadBuildMetadata(directory, {}, '0.11.0')).toThrow(/commit/i)
  })

  it('rejects malformed source metadata and falls back to a commit for other tags', () => {
    expect(() => resolveBuildMetadata({ packageVersion: '0.11.0', commit: 'not-a-commit' })).toThrow(/commit/i)
    expect(() => resolveBuildMetadata({ packageVersion: 'invalid', commit: 'a'.repeat(40) })).toThrow(/version/i)
    expect(resolveBuildMetadata({ packageVersion: '0.11.0', commit: 'a'.repeat(40), tag: 'latest' }).label).toBe('V0.11.0-aaaaaaa')
  })
})

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), 'moeurl-build-version-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'web'))
  writeFileSync(join(directory, 'web', 'package.json'), '{"version":"0.11.0"}')
  git(directory, 'init', '-b', 'main')
  git(directory, 'config', 'user.name', 'Build metadata test')
  git(directory, 'config', 'user.email', 'build-test@example.invalid')
  git(directory, 'add', 'web/package.json')
  git(directory, 'commit', '-m', 'test fixture')
  return directory
}

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
