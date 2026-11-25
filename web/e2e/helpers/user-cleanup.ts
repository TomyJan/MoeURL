export interface UserCleanupSteps {
  changeGroup?: () => Promise<unknown>
  disable: () => Promise<unknown>
}

export interface UserCleanupSnapshot {
  id: string
  group: string
  updatedAt: string
}

/** Runs test-fixture migration and disable cleanup while collecting failures. */
export async function runUserCleanupSteps(steps: UserCleanupSteps, cleanupErrors: unknown[]): Promise<void> {
  if (steps.changeGroup) {
    try {
      await steps.changeGroup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  try {
    await steps.disable()
  } catch (error) {
    cleanupErrors.push(error)
  }
}

/** Attempts to disable every registered fixture even when the latest user snapshot cannot be read. */
export async function cleanupCreatedUser(
  createdUserId: string,
  currentUser: UserCleanupSnapshot | undefined,
  changeGroup: (user: UserCleanupSnapshot) => Promise<unknown>,
  disable: (userId: string) => Promise<unknown>,
  cleanupErrors: unknown[],
): Promise<void> {
  await runUserCleanupSteps({
    changeGroup: currentUser && currentUser.group !== 'user' ? () => changeGroup(currentUser) : undefined,
    disable: () => disable(createdUserId),
  }, cleanupErrors)
}
