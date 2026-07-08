import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useMutationTargetId } from './useMutationTargetId'

describe('useMutationTargetId', () => {
  it('returns the extracted target id only while a mutation is pending', () => {
    const mutation = {
      isPending: ref(true),
      variables: ref<{ id: string } | undefined>({ id: 'link-id' }),
    }

    const targetId = useMutationTargetId(mutation, (variables) => variables?.id)

    expect(targetId.value).toBe('link-id')

    mutation.isPending.value = false
    expect(targetId.value).toBe('')
  })

  it('supports string mutation variables', () => {
    const mutation = {
      isPending: ref(true),
      variables: ref<string | undefined>('link-id'),
    }

    const targetId = useMutationTargetId(mutation, (variables) => variables)

    expect(targetId.value).toBe('link-id')
  })
})
