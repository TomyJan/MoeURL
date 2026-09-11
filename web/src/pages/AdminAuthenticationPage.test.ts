import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'

import {
  createOIDCProvider,
  deleteOIDCProvider,
  listOIDCProviders,
  updateOIDCProvider,
  type OIDCProvider,
} from '@/entities/oidc/api'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'

import AdminAuthenticationPage from './AdminAuthenticationPage.vue'

const PROVIDER_CONFLICT_CODE = 340102

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  mutationInputs: [] as unknown[],
  mutationPending: undefined as unknown as ReturnType<typeof ref<boolean>>,
  queryData: undefined as unknown as ReturnType<typeof ref<unknown>>,
  queryError: undefined as unknown as ReturnType<typeof ref<boolean>>,
  queryPending: undefined as unknown as ReturnType<typeof ref<boolean>>,
  refetch: vi.fn(async () => undefined),
  setQueryData: vi.fn(),
}))

vi.mock('@/entities/oidc/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/oidc/api')>()
  return {
    ...actual,
    createOIDCProvider: vi.fn(),
    deleteOIDCProvider: vi.fn(),
    listOIDCProviders: vi.fn(),
    updateOIDCProvider: vi.fn(),
  }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries, setQueryData: state.setQueryData }),
  useQuery: (options: { queryFn: () => unknown }) => {
    void options.queryFn()
    return { data: state.queryData, isPending: state.queryPending, isError: state.queryError, refetch: state.refetch }
  },
  useMutation: vi.fn((options: {
    mutationFn: (input: unknown) => Promise<unknown>
    onError?: (error: unknown, input: unknown) => unknown
    onSettled?: (result: unknown, error: unknown, input: unknown) => unknown
    onSuccess?: (result: unknown, input: unknown) => unknown
  }) => ({
    isPending: state.mutationPending,
    mutate: (input: unknown) => {
      state.mutationInputs.push(input)
      state.mutationPending.value = true
      void options.mutationFn(input)
        .then((result) => options.onSuccess?.(result, input))
        .catch((error) => options.onError?.(error, input))
        .finally(() => {
          state.mutationPending.value = false
          options.onSettled?.(undefined, undefined, input)
        })
    },
  })),
}))

const company: OIDCProvider = {
  id: '00000000-0000-0000-0000-000000000701',
  key: 'company',
  displayName: 'Company SSO',
  issuerUrl: 'https://id.example.com',
  clientId: 'moeurl',
  clientSecretConfigured: true,
  allowedEmailDomains: ['example.com'],
  enabled: true,
  callbackUrl: 'https://links.example.com/api/v1/auth/oidc/company/callback',
  updatedAt: '2026-09-11T00:00:00Z',
}
const team: OIDCProvider = {
  ...company,
  id: '00000000-0000-0000-0000-000000000702',
  key: 'team',
  displayName: 'Team SSO',
  callbackUrl: 'https://links.example.com/api/v1/auth/oidc/team/callback',
}

function mountPage(stubs = componentStubs) {
  return render(AdminAuthenticationPage, { global: { stubs } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

beforeEach(() => {
  state.mutationPending = ref(false)
  state.mutationInputs = []
  state.queryData = ref<unknown>({ providers: [company, team] })
  state.queryError = ref(false)
  state.queryPending = ref(false)
  state.invalidateQueries.mockClear()
  state.refetch.mockReset()
  state.refetch.mockResolvedValue(undefined)
  state.setQueryData.mockReset()
  state.setQueryData.mockImplementation((_key: unknown, updater: (current: { providers: OIDCProvider[] } | undefined) => unknown) => {
    state.queryData.value = updater(state.queryData.value as { providers: OIDCProvider[] })
  })
  vi.mocked(useMutation).mockClear()
  vi.mocked(listOIDCProviders).mockReset()
  vi.mocked(listOIDCProviders).mockResolvedValue({ providers: [] })
  vi.mocked(createOIDCProvider).mockReset()
  vi.mocked(updateOIDCProvider).mockReset()
  vi.mocked(deleteOIDCProvider).mockReset()
})

describe('AdminAuthenticationPage', () => {
  it('renders loading and empty states when provider data has not arrived', async () => {
    state.queryPending.value = true
    state.queryData.value = undefined
    const pending = mountPage()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    state.queryPending.value = false
    mountPage()
    expect(screen.getByText('oidc.empty')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.addProvider' }))
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.cancel' }))
    expect(screen.getByText('oidc.empty')).toBeTruthy()
  })

  it('shows a load error and retries the provider query', async () => {
    state.queryError.value = true
    mountPage({
      ...componentStubs,
      VAlert: { template: '<div role="alert"><slot /><slot name="append" /></div>' },
    })
		expect(screen.getByText('oidc.loadFailed')).toBeTruthy()
		await fireEvent.click(screen.getByRole('button', { name: 'oidc.retry' }))
		expect(state.refetch).toHaveBeenCalledOnce()
	})

  it('renders configured providers without exposing a stored secret', () => {
    mountPage()
    expect(screen.getByRole('button', { name: /^Company SSO/ })).toBeTruthy()
    expect(screen.getByDisplayValue('https://id.example.com')).toBeTruthy()
    expect(screen.queryByDisplayValue('client-secret')).toBeNull()
    expect(useMutation).toHaveBeenCalledWith(expect.objectContaining({ retry: false }))
  })

  it('submits a new provider and clears the plaintext secret after success', async () => {
    vi.mocked(createOIDCProvider).mockResolvedValue({ provider: { ...team, key: 'new-team', displayName: 'New Team' } })
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.addProvider' }))
    await fireEvent.update(screen.getByLabelText('oidc.key'), 'new-team')
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'New Team')
    await fireEvent.update(screen.getByLabelText('oidc.issuerUrl'), 'https://team.example.com')
    await fireEvent.update(screen.getByLabelText('oidc.clientId'), 'client')
    await fireEvent.update(screen.getByLabelText('oidc.clientSecret'), 'top-secret')
    await fireEvent.update(screen.getByLabelText('oidc.allowedDomains'), 'example.com')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    expect(JSON.stringify(state.mutationInputs)).not.toContain('top-secret')
    expect(createOIDCProvider).toHaveBeenCalledWith(expect.objectContaining({ key: 'new-team', clientSecret: 'top-secret', allowedEmailDomains: ['example.com'] }))
    await waitFor(() => expect(screen.queryByDisplayValue('top-secret')).toBeNull())
    expect(screen.getByText('oidc.saveSuccess')).toBeTruthy()
  })

  it('prevents starting another provider draft while a create request is pending', async () => {
    const request = deferred<{ provider: OIDCProvider }>()
    vi.mocked(createOIDCProvider).mockReturnValue(request.promise)
    mountPage()
    const addProvider = screen.getByRole('button', { name: 'oidc.addProvider' }) as HTMLButtonElement

    await fireEvent.click(addProvider)
    await fireEvent.update(screen.getByLabelText('oidc.key'), 'new-team')
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'Pending provider')
    await fireEvent.update(screen.getByLabelText('oidc.issuerUrl'), 'https://team.example.com')
    await fireEvent.update(screen.getByLabelText('oidc.clientId'), 'client')
    await fireEvent.update(screen.getByLabelText('oidc.clientSecret'), 'top-secret')
    await fireEvent.update(screen.getByLabelText('oidc.allowedDomains'), 'example.com')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))

    await waitFor(() => expect(createOIDCProvider).toHaveBeenCalledOnce())
    expect(addProvider.disabled).toBe(true)
    request.resolve({ provider: { ...team, key: 'new-team', displayName: 'Pending provider' } })
    await waitFor(() => expect(addProvider.disabled).toBe(false))
  })

  it('creates into an initially empty query cache and ignores refreshes while drafting', async () => {
    state.queryData.value = undefined
    vi.mocked(createOIDCProvider).mockResolvedValue({ provider: company })
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.addProvider' }))
    await fireEvent.update(screen.getByLabelText('oidc.key'), 'company')
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'Draft name')
    await fireEvent.update(screen.getByLabelText('oidc.issuerUrl'), company.issuerUrl)
    await fireEvent.update(screen.getByLabelText('oidc.clientId'), company.clientId)
    await fireEvent.update(screen.getByLabelText('oidc.clientSecret'), 'top-secret')
    await fireEvent.update(screen.getByLabelText('oidc.allowedDomains'), 'example.com')
    state.queryData.value = { providers: [team] }
    await nextTick()
    expect(screen.getByDisplayValue('Draft name')).toBeTruthy()
    state.queryData.value = undefined
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await waitFor(() => expect(screen.getByDisplayValue('Company SSO')).toBeTruthy())
    expect(state.queryData.value).toEqual({ providers: [company] })
  })

  it('treats a create response carrying the update-conflict code as a normal failure', async () => {
    vi.mocked(createOIDCProvider).mockRejectedValue(new ApiClientError(PROVIDER_CONFLICT_CODE, 'unexpected create conflict'))
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.addProvider' }))
    await fireEvent.update(screen.getByLabelText('oidc.key'), 'new-provider')
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'New provider')
    await fireEvent.update(screen.getByLabelText('oidc.issuerUrl'), company.issuerUrl)
    await fireEvent.update(screen.getByLabelText('oidc.clientId'), company.clientId)
    await fireEvent.update(screen.getByLabelText('oidc.clientSecret'), 'top-secret')
    await fireEvent.update(screen.getByLabelText('oidc.allowedDomains'), 'example.com')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await waitFor(() => expect(screen.getByText('oidc.saveFailed')).toBeTruthy())
    expect(state.refetch).not.toHaveBeenCalled()
  })

  it('does not change selection or feedback when an earlier save finishes', async () => {
    const request = deferred<{ provider: OIDCProvider }>()
    vi.mocked(updateOIDCProvider).mockReturnValue(request.promise)
    mountPage()
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'Company changed')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await waitFor(() => expect(updateOIDCProvider).toHaveBeenCalledOnce())
    await fireEvent.click(screen.getByRole('button', { name: /^Team SSO/ }))

    request.resolve({ provider: { ...company, displayName: 'Company changed', updatedAt: '2026-09-11T01:00:00Z' } })

    await waitFor(() => expect(state.setQueryData).toHaveBeenCalledOnce())
    expect(screen.getByDisplayValue('Team SSO')).toBeTruthy()
    expect(screen.queryByText('oidc.saveSuccess')).toBeNull()
  })

  it('preserves the active draft while refreshing a conflicting provider', async () => {
    vi.mocked(updateOIDCProvider).mockRejectedValue(new ApiClientError(PROVIDER_CONFLICT_CODE, 'conflict'))
    state.refetch.mockImplementation(async () => {
      state.queryData.value = {
        providers: [{ ...company, displayName: 'Server value', updatedAt: '2026-09-11T01:00:00Z' }, team],
      }
    })
    mountPage()
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'My draft')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))

    await waitFor(() => expect(screen.getByText('oidc.conflict')).toBeTruthy())
    expect(state.refetch).toHaveBeenCalledOnce()
    expect(screen.getByDisplayValue('My draft')).toBeTruthy()
  })

  it('removes a deleted provider from query data and selects the next provider', async () => {
    vi.mocked(deleteOIDCProvider).mockResolvedValue(undefined)
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'oidc.delete' }))

    await waitFor(() => expect(deleteOIDCProvider).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Company SSO/ })).toBeNull())
    expect(screen.getByDisplayValue('Team SSO')).toBeTruthy()
    expect(screen.getByText('oidc.saveSuccess')).toBeTruthy()
  })

  it('does not show an earlier failure after switching providers', async () => {
    const request = deferred<{ provider: OIDCProvider }>()
    vi.mocked(updateOIDCProvider).mockReturnValue(request.promise)
    mountPage()
    await fireEvent.update(screen.getByLabelText('oidc.displayName'), 'Company changed')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await fireEvent.click(screen.getByRole('button', { name: /^Team SSO/ }))

    request.reject(new Error('failed'))

    await waitFor(() => expect(state.mutationPending.value).toBe(false))
    await nextTick()
    expect(screen.queryByText('oidc.saveFailed')).toBeNull()
  })

  it('synchronizes a completed update even when the provider disappeared during the request', async () => {
    const request = deferred<{ provider: OIDCProvider }>()
    vi.mocked(updateOIDCProvider).mockReturnValue(request.promise)
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await waitFor(() => expect(updateOIDCProvider).toHaveBeenCalledOnce())
    state.queryData.value = { providers: [] }
    await nextTick()
    request.resolve({ provider: { ...company, displayName: 'Recovered provider' } })
    await waitFor(() => expect(state.queryData.value).toEqual({ providers: [{ ...company, displayName: 'Recovered provider' }] }))
    expect(screen.queryByText('oidc.saveSuccess')).toBeNull()
  })

  it('refreshes after a delete conflict', async () => {
    vi.mocked(deleteOIDCProvider).mockRejectedValue(new ApiClientError(PROVIDER_CONFLICT_CODE, 'conflict'))
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'oidc.delete' }))
    await waitFor(() => expect(screen.getByText('oidc.conflict')).toBeTruthy())
    expect(state.refetch).toHaveBeenCalledOnce()
  })

  it('refreshes an earlier conflicting provider without changing the active feedback', async () => {
    const request = deferred<{ provider: OIDCProvider }>()
    vi.mocked(updateOIDCProvider).mockReturnValue(request.promise)
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await fireEvent.click(screen.getByRole('button', { name: /^Team SSO/ }))
    request.reject(new ApiClientError(PROVIDER_CONFLICT_CODE, 'conflict'))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce())
    expect(screen.queryByText('oidc.conflict')).toBeNull()
  })

  it('rejects an incomplete create form before mutation', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.addProvider' }))
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    expect(screen.getByText('oidc.saveFailed')).toBeTruthy()
    expect(createOIDCProvider).not.toHaveBeenCalled()
  })

  it('cancels creation and restores the first provider without retaining its secret', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.addProvider' }))
    await fireEvent.update(screen.getByLabelText('oidc.clientSecret'), 'temporary-secret')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.cancel' }))
    expect(screen.getByDisplayValue('Company SSO')).toBeTruthy()
    expect(screen.queryByDisplayValue('temporary-secret')).toBeNull()
  })

  it('shows a retryable error for an active failed save and clears its secret', async () => {
    vi.mocked(updateOIDCProvider).mockRejectedValue(new Error('database unavailable'))
    mountPage()
    await fireEvent.update(screen.getByLabelText('oidc.clientSecret'), 'replacement-secret')
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
    await waitFor(() => expect(screen.getByText('oidc.saveFailed')).toBeTruthy())
    expect(updateOIDCProvider).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: { mode: 'set', value: 'replacement-secret' } }))
    expect(screen.queryByDisplayValue('replacement-secret')).toBeNull()
  })

	it('submits the changed enabled state', async () => {
		vi.mocked(updateOIDCProvider).mockResolvedValue({ provider: { ...company, enabled: false } })
		mountPage()
		await fireEvent.click(screen.getByLabelText('oidc.enabled'))
		await fireEvent.click(screen.getByRole('button', { name: 'oidc.save' }))
		await waitFor(() => expect(updateOIDCProvider).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })))
	})

  it('honors an external delete-dialog close event', async () => {
		mountPage({
			...componentStubs,
			VDialog: {
				props: ['modelValue'],
				emits: ['update:modelValue'],
				template: '<div v-if="modelValue" role="dialog"><button aria-label="external-close" @click="$emit(\'update:modelValue\', false)" /><slot /></div>',
			},
		})
		await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
		await fireEvent.click(screen.getByRole('button', { name: 'external-close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the delete dialog from its cancel action', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
    const dialog = screen.getByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: 'oidc.cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clears selection when a server refresh returns no providers', async () => {
    mountPage()
    state.queryData.value = { providers: [] }
    await nextTick()
    expect(screen.getByText('oidc.empty')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('does not apply a completed delete to a newly selected provider', async () => {
    const request = deferred<void>()
    vi.mocked(deleteOIDCProvider).mockReturnValue(request.promise)
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'oidc.delete' }))
    await waitFor(() => expect(deleteOIDCProvider).toHaveBeenCalledOnce())
    await fireEvent.click(screen.getByRole('button', { name: /^Team SSO/ }))
    request.resolve()
    await waitFor(() => expect(state.setQueryData).toHaveBeenCalledOnce())
    expect(screen.getByDisplayValue('Team SSO')).toBeTruthy()
    expect(screen.queryByText('oidc.saveSuccess')).toBeNull()
  })

  it('removes a deleted provider when the query cache is not initialized', async () => {
    vi.mocked(deleteOIDCProvider).mockResolvedValue(undefined)
    state.setQueryData.mockImplementationOnce((_key: unknown, updater: (current: { providers: OIDCProvider[] } | undefined) => unknown) => {
      state.queryData.value = updater(undefined)
    })
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'oidc.delete' }))
    await waitFor(() => expect(state.setQueryData).toHaveBeenCalledOnce())
    expect(state.queryData.value).toEqual({ providers: [] })
  })

  it('ignores confirmation after the selected provider disappears', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'oidc.delete' }))
    state.queryData.value = { providers: [] }
    await nextTick()
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'oidc.delete' }))
    expect(deleteOIDCProvider).not.toHaveBeenCalled()
  })

  it('ignores a stale form submit after its provider disappears', () => {
    const view = mountPage()
    const form = view.container.querySelector('form')
    expect(form).toBeTruthy()
    state.queryData.value = { providers: [] }
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(updateOIDCProvider).not.toHaveBeenCalled()
  })
})
