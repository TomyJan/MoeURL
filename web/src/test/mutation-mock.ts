import { ref, type Ref } from 'vue'
import { vi } from 'vitest'

export interface MutationMockCallOptions {
  mutationFn?: (input: unknown) => unknown
  onSuccess?: (value: unknown, variables: unknown) => void
}

export interface MutationMockResult {
  data?: Ref<unknown>
  error?: Ref<unknown>
  isError?: Ref<boolean>
  isPending?: Ref<boolean>
  mutate?: (input: unknown) => void
  variables?: Ref<unknown>
}

interface MutationMockFields {
  isError?: boolean
  reset?: boolean
  variables?: boolean
}

interface CreateMutationMockOptions {
  captureOptions?: (options: MutationMockCallOptions | undefined) => void
  fields?: MutationMockFields
  getResult: () => MutationMockResult
  resolveSynchronousResult?: (result: unknown, input: unknown) => unknown
}

/** Creates a reactive mutation double that runs configured lifecycle callbacks. */
export function createMutationMock(config: CreateMutationMockOptions) {
  return vi.fn((options?: MutationMockCallOptions) => {
    config.captureOptions?.(options)
    const base = config.getResult()
    const providedMutate = base.mutate
    const data = base.data ?? ref<unknown>(undefined)
    const error = base.error ?? ref<unknown>(undefined)
    const isError = base.isError ?? ref(false)
    const isPending = base.isPending ?? ref(false)
    const variables = base.variables ?? ref<unknown>(undefined)
    const reset = vi.fn(() => {
      data.value = undefined
      error.value = undefined
      isError.value = false
      isPending.value = false
      if (config.fields?.variables) {
        variables.value = undefined
      }
    })
    /** Applies a successful result and invokes the configured success callback. */
    const succeed = (value: unknown, input: unknown) => {
      data.value = value
      options?.onSuccess?.(value, input)
    }
    /** Applies a failed result and invokes the configured error callback. */
    const fail = (reason: unknown) => {
      error.value = reason
      if (config.fields?.isError) {
        isError.value = true
      }
    }
    const mutate = vi.fn((input: unknown) => {
      if (config.fields?.variables) {
        variables.value = input
      }
      if (providedMutate) {
        providedMutate(input)
        return
      }
      error.value = undefined
      if (config.fields?.isError) {
        isError.value = false
      }
      try {
        const result = options?.mutationFn?.(input)
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          isPending.value = true
          void Promise.resolve(result)
            .then((value) => succeed(value, input))
            .catch(fail)
            .finally(() => {
              isPending.value = false
            })
          return
        }
        succeed(config.resolveSynchronousResult?.(result, input) ?? result, input)
      } catch (reason) {
        fail(reason)
      }
    })

    return {
      data,
      error,
      isPending,
      mutate,
      ...(config.fields?.isError ? { isError } : {}),
      ...(config.fields?.reset ? { reset } : {}),
      ...(config.fields?.variables ? { variables } : {}),
    }
  })
}
