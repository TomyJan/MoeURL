import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const repositoryURL = 'https://github.com/TomyJan/MoeURL'
const versionTagPattern = /^v(\d+\.\d+\.\d+)$/

/** Produces immutable display text and a source link; unrelated tags use the commit baseline. */
export function resolveBuildMetadata({ packageVersion, commit, tag = '' }) {
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    throw new Error('web/package.json must contain a numeric semantic version')
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) {
    throw new Error('MOEURL_BUILD_COMMIT must contain the full Git commit hash')
  }

  const match = versionTagPattern.exec(tag)
  if (match) {
    return { label: `V${match[1]}`, url: `${repositoryURL}/tree/${encodeURIComponent(tag)}` }
  }

  return {
    label: `V${packageVersion}-${commit.slice(0, 7)}`,
    url: `${repositoryURL}/commit/${commit}`,
  }
}

/** Loads the shared footer constant for Vite and unit-test builds. */
export function loadBuildMetadata(repositoryRoot, environment = process.env, packageVersion) {
  return loadBuildSource(repositoryRoot, environment, packageVersion).metadata
}

/** Resolves Git source locally or from explicit build arguments when .git is absent. */
export function loadBuildSource(repositoryRoot, environment = process.env, packageVersion) {
  let version = packageVersion
  if (!version) {
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'web', 'package.json'), 'utf8'))
    version = manifest.version
  }
  const commit = environment.MOEURL_BUILD_COMMIT || git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
  const configuredTag = environment.MOEURL_BUILD_TAG
  const tag = configuredTag === undefined
    ? git(repositoryRoot, ['tag', '--points-at', commit, '--sort=-version:refname'], false).split('\n').find(value => versionTagPattern.test(value)) ?? ''
    : configuredTag
  return { commit, tag, metadata: resolveBuildMetadata({ packageVersion: version, commit, tag }) }
}

function git(cwd, args, required = true) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    if (!required) return ''
    throw new Error('a full Git commit or MOEURL_BUILD_COMMIT is required to build MoeURL')
  }
}
