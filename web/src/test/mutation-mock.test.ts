import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createMutationMock } from './mutation-mock'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('createMutationMock', () => {
  it('maps synchronous results and resets configured state fields', () => {
    const state = {
      data: ref<unknown>('previous'),
      error: ref<unknown>(new Error('previous failure')),
      isError: ref(true),
      isPending: ref(false),
      variables: ref<unknown>(undefined),
    }
    const onSuccess = vi.fn()
    const mutationFn = vi.fn(() => 'raw result')
    const useMutation = createMutationMock({
      fields: { isError: true, reset: true, variables: true },
      getResult: () => state,
      resolveSynchronousResult: (result, input) => ({ input, result }),
    })

    const mutation = useMutation({ mutationFn, onSuccess })
    mutation.mutate('payload')

    expect(mutationFn).toHaveBeenCalledWith('payload')
    expect(state.variables.value).toBe('payload')
    expect(state.data.value).toEqual({ input: 'payload', result: 'raw result' })
    expect(state.error.value).toBeUndefined()
    expect(state.isError.value).toBe(false)
    expect(onSuccess).toHaveBeenCalledWith({ input: 'payload', result: 'raw result' })

    mutation.reset?.()
    expect(state.data.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
    expect(state.isError.value).toBe(false)
    expect(state.variables.value).toBeUndefined()
  })

  it('stops after a provided mutate while retaining configured variables', () => {
    const providedMutate = vi.fn()
    const variables = ref<unknown>(undefined)
    const mutationFn = vi.fn()
    const onSuccess = vi.fn()
    const useMutation = createMutationMock({
      fields: { variables: true },
      getResult: () => ({ mutate: providedMutate, variables }),
    })

    const mutation = useMutation({ mutationFn, onSuccess })
    mutation.mutate('payload')

    expect(variables.value).toBe('payload')
    expect(providedMutate).toHaveBeenCalledWith('payload')
    expect(mutationFn).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('leaves variables untouched when variable tracking is disabled', () => {
    const variables = ref<unknown>('existing')
    const useMutation = createMutationMock({
      fields: { reset: true },
      getResult: () => ({ variables }),
    })

    const mutation = useMutation()
    mutation.reset?.()

    expect(mutation).not.toHaveProperty('variables')
    expect(variables.value).toBe('existing')
  })

  it('tracks Promise success and pending state', async () => {
    const deferred = createDeferred<string>()
    const state = {
      data: ref<unknown>(undefined),
      isPending: ref(false),
    }
    const onSuccess = vi.fn()
    const useMutation = createMutationMock({ getResult: () => state })
    const mutation = useMutation({ mutationFn: () => deferred.promise, onSuccess })

    mutation.mutate('payload')
    expect(state.isPending.value).toBe(true)

    deferred.resolve('saved')
    await vi.waitFor(() => expect(state.isPending.value).toBe(false))
    expect(state.data.value).toBe('saved')
    expect(onSuccess).toHaveBeenCalledWith('saved')
  })

  it('captures Promise failures and synchronous exceptions', async () => {
    const deferred = createDeferred<never>()
    const promiseState = {
      error: ref<unknown>(undefined),
      isError: ref(false),
      isPending: ref(false),
    }
    const usePromiseMutation = createMutationMock({
      fields: { isError: true },
      getResult: () => promiseState,
    })
    const promiseMutation = usePromiseMutation({ mutationFn: () => deferred.promise })

    promiseMutation.mutate('payload')
    const rejection = new Error('request failed')
    deferred.reject(rejection)
    await vi.waitFor(() => expect(promiseState.isPending.value).toBe(false))
    expect(promiseState.error.value).toBe(rejection)
    expect(promiseState.isError.value).toBe(true)

    const exceptionState = {
      error: ref<unknown>(undefined),
      isError: ref(false),
    }
    const useExceptionMutation = createMutationMock({
      fields: { isError: true },
      getResult: () => exceptionState,
    })
    const exception = new Error('mutation threw')
    const exceptionMutation = useExceptionMutation({
      mutationFn: () => {
        throw exception
      },
    })

    exceptionMutation.mutate('payload')
    expect(exceptionState.error.value).toBe(exception)
    expect(exceptionState.isError.value).toBe(true)
  })
})
