import { expect, it } from 'vitest'
import { cleanupCreatedUser, runUserCleanupSteps } from '../../e2e/helpers/user-cleanup'

it('still attempts to disable a user after migration cleanup fails', async () => {
  const calls: string[] = []
  const cleanupErrors: unknown[] = []
  const migrationError = new Error('injected migration cleanup failure')
  let disabled = false

  await runUserCleanupSteps({
    changeGroup: async () => {
      calls.push('change-group')
      throw migrationError
    },
    disable: async () => {
      calls.push('disable')
      disabled = true
    },
  }, cleanupErrors)

  expect(calls).toEqual(['change-group', 'disable'])
  expect(cleanupErrors).toEqual([migrationError])
  expect(disabled).toBe(true)
})

it('collects disable failure after a successful migration', async () => {
  const calls: string[] = []
  const cleanupErrors: unknown[] = []
  const disableError = new Error('injected disable cleanup failure')

  await runUserCleanupSteps({
    changeGroup: async () => { calls.push('change-group') },
    disable: async () => {
      calls.push('disable')
      throw disableError
    },
  }, cleanupErrors)

  expect(calls).toEqual(['change-group', 'disable'])
  expect(cleanupErrors).toEqual([disableError])
})

it('still disables a registered user when the current user-list snapshot is unavailable', async () => {
  const calls: string[] = []
  const cleanupErrors: unknown[] = []

  await cleanupCreatedUser(
    'created-user-id',
    undefined,
    async () => { calls.push('change-group') },
    async (userId) => { calls.push(`disable:${userId}`) },
    cleanupErrors,
  )

  expect(calls).toEqual(['disable:created-user-id'])
  expect(cleanupErrors).toEqual([])
})
