import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import type { FullConfig } from '@playwright/test'

type CommandRunner = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' },
) => unknown

const repositoryRoot = resolve(import.meta.dirname, '../..')
const isolatedProjectPattern = /^moeurl-e2e-[a-z0-9][a-z0-9_-]*$/

/** Removes the isolated Compose resources created for one E2E run. */
export function cleanupE2ECompose(
  projectName: string | undefined,
  skipDockerCompose: boolean,
  run: CommandRunner = execFileSync,
): void {
  if (skipDockerCompose) {
    return
  }
  if (!projectName || !isolatedProjectPattern.test(projectName)) {
    throw new Error('Playwright teardown requires an isolated E2E Compose project using the moeurl-e2e- prefix')
  }

  run(
    'docker',
    [
      'compose',
      '-p',
      projectName,
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.e2e.yml',
      'down',
      '-v',
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MOEURL_DATABASE_URL: 'postgres://cleanup',
        MOEURL_OIDC_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        MOEURL_POSTGRES_PASSWORD: 'cleanup',
        MOEURL_PUBLIC_BASE_URL: 'http://127.0.0.1',
      },
      stdio: 'inherit',
    },
  )
}

export default function globalTeardown(config: FullConfig): void {
  const projectName = config.metadata.e2eComposeProjectName
  const skipDockerCompose = config.metadata.e2eSkipDockerCompose
  cleanupE2ECompose(
    typeof projectName === 'string' ? projectName : undefined,
    skipDockerCompose === true,
  )
}
