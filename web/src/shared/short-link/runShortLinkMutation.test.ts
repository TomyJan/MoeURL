import { describe, expect, it } from 'vitest'

import type { UpdateShortLinkInput } from '@/entities/short-link/model'
import { createDeferred } from '@/test/deferred'
import { runShortLinkMutation } from './runShortLinkMutation'

describe('runShortLinkMutation', () => {
  it('keeps the password until an asynchronous mutation settles', async () => {
    const deferred = createDeferred<void>()
    let request: UpdateShortLinkInput | undefined
    const mutation = runShortLinkMutation(
      (input: UpdateShortLinkInput) => {
        request = input
        return deferred.promise
      },
      { id: 'link-id' },
      { mode: 'set', value: 'correct horse' },
    )

    expect(request?.password).toEqual({ mode: 'set', value: 'correct horse' })

    deferred.resolve()
    await mutation

    expect(request).not.toHaveProperty('password')
  })

  it('rejects when a requested password was cleared before execution', async () => {
    const mutationFn = vi.fn(async () => undefined)

    await expect(runShortLinkMutation(mutationFn, { id: 'link-id' }, undefined, true))
      .rejects.toThrow('password input was cleared before mutation execution')
    expect(mutationFn).not.toHaveBeenCalled()
  })
})
