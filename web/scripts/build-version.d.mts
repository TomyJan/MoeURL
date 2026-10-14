export function resolveBuildMetadata(input: {
  packageVersion: string
  commit: string
  tag?: string
}): { label: string; url: string }

export function loadBuildMetadata(
  repositoryRoot: string,
  environment?: NodeJS.ProcessEnv,
  packageVersion?: string,
): { label: string; url: string }

export function loadBuildSource(
  repositoryRoot: string,
  environment?: NodeJS.ProcessEnv,
  packageVersion?: string,
): { commit: string; tag: string; metadata: { label: string; url: string } }
