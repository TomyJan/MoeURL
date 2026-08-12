import { fireEvent, render, screen } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { me } from '@/entities/auth/api'
import { createShortLink } from '@/entities/short-link/api'
import type { CreateShortLinkInput } from '@/entities/short-link/model'
import { createDeferred } from '@/test/deferred'
import type { MutationMockResult } from '@/test/mutation-mock'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as unknown[],
  queryResult: {},
  queryOptions: [] as unknown[],
  mutationResult: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(),
}))

vi.mock('@/entities/short-link/api', () => ({
  createShortLink: vi.fn(),
}))

vi.mock('@tanstack/vue-query', async () => {
  const { createMutationMock } = await import('@/test/mutation-mock')
  return {
    useMutation: createMutationMock({
      captureOptions: (options) => state.mutationOptions.push(options),
      fields: { isError: true, variables: true },
      getResult: () => state.mutationResult as MutationMockResult,
    }),
    useQuery: vi.fn((options?: unknown) => {
      state.queryOptions.push(options)
      return state.queryResult
    }),
    useQueryClient: () => ({
      invalidateQueries: state.invalidateQueries,
    }),
  }
})

function mountPanel(props: Record<string, unknown> = {}) {
  return render(ShortLinkCreatePanel, {
    props,
    global: {
      stubs: componentStubs,
    },
  })
}

function setQueryResult(permissions: string[]) {
  state.queryResult = {
    data: ref({
      user: {
        permissions,
      },
    }),
  }
}

function setMutationResult(value: Partial<{
  data: ReturnType<typeof ref>
  error: ReturnType<typeof ref>
  isPending: ReturnType<typeof ref>
  variables: ReturnType<typeof ref>
  mutate: ReturnType<typeof vi.fn>
}> = {}) {
  state.mutationResult = {
    data: value.data ?? ref(undefined),
    error: value.error ?? ref(undefined),
    isPending: value.isPending ?? ref(false),
    variables: value.variables ?? ref(undefined),
    ...(value.mutate ? { mutate: value.mutate } : {}),
  }
}

describe('ShortLinkCreatePanel', () => {
  beforeEach(() => {
    state.invalidateQueries.mockReset()
    state.mutationOptions = []
    state.queryOptions = []
    vi.mocked(createShortLink).mockReset()
    vi.mocked(createShortLink).mockResolvedValue({
      shortLink: { slug: 'abc123', url: 'https://go.example.com/abc123' },
    } as never)
    setQueryResult([])
    setMutationResult()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
  })

  it('keeps the form visible while blocking users without create permission', async () => {
    const mutate = vi.fn()
    setMutationResult({ mutate })

    const { container } = mountPanel()

    expect(container.querySelector('.short-link-create-panel__shell')).toBeTruthy()
    expect(container.querySelector('.short-link-create-panel__field-row')).toBeTruthy()
    const targetInput = screen.getByLabelText('shortLinkCreate.targetLabel') as HTMLInputElement
    expect(targetInput.disabled).toBe(true)
    expect(targetInput.placeholder).toBe('shortLinkCreate.targetPlaceholder')
    expect(screen.queryByText(/^https$/i)).toBeNull()
    expect(screen.getByText('shortLinkCreate.permissionRequired')).toBeTruthy()

    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).not.toHaveBeenCalled()
  })

  it('does not flash the permission hint before the current user query resolves', () => {
    state.queryResult = {
      data: ref(undefined),
    }

    const { container } = mountPanel()

    expect(container.querySelector('.short-link-create-panel__shell')).toBeTruthy()
    expect(screen.queryByText('shortLinkCreate.permissionRequired')).toBeNull()
    expect((screen.getByLabelText('shortLinkCreate.targetLabel') as HTMLInputElement).disabled).toBe(true)
  })

  it('creates a short link and exposes copy and reset actions', async () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult()

    mountPanel({ mode: 'full' })

    expect(state.mutationOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ mutationFn: expect.any(Function) })]),
    )
    expect(state.queryOptions).toEqual(expect.arrayContaining([expect.objectContaining({ queryFn: me })]))

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(createShortLink).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
    expect(await screen.findByTestId('short-link-create-result')).toBeTruthy()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['short-link'] })
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-short-link'] })
    expect(screen.getByText('shortLinkCreate.successTitle')).toBeTruthy()
    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()

    await fireEvent.click(screen.getByText('shortLinkCreate.qrCode'))
    expect(screen.getByTestId('short-link-qr-dialog-stub').textContent).toContain('https://go.example.com/abc123')
    expect(screen.getByTestId('short-link-qr-dialog-stub').textContent).toContain('abc123')
    await fireEvent.click(screen.getByLabelText('short-link-qr-close'))
    expect(screen.queryByTestId('short-link-qr-dialog-stub')).toBeNull()

    await fireEvent.click(screen.getByText('shortLinkCreate.copy'))
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')

    await fireEvent.click(screen.getByText('shortLinkCreate.reset'))
    expect(screen.queryByText('https://go.example.com/abc123')).toBeNull()
  })

  it('does not run the real mutation or success flow when a custom mutate is provided', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ mutate })

    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
    expect(createShortLink).not.toHaveBeenCalled()
    expect(state.invalidateQueries).not.toHaveBeenCalled()
    expect(screen.queryByTestId('short-link-create-result')).toBeNull()
  })

  it('hides advanced settings without access-configuration permissions', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])

    mountPanel()

    expect(screen.queryByText('shortLinkCreate.advanced')).toBeNull()
    expect(screen.queryByText('shortLinkCreate.redirectModes.intermediate')).toBeNull()
    expect(screen.queryByLabelText('shortLinkCreate.expirationEnabled')).toBeNull()
  })

  it('submits intermediate settings without expiration when only intermediate access is allowed', async () => {
    const mutate = vi.fn()
    setQueryResult([
      'short_link:create',
      'domain:use_default',
      'short_link:use_intermediate',
    ])
    setMutationResult({ mutate })

    mountPanel()

    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    expect(screen.getByText('shortLinkCreate.redirectModes.intermediate')).toBeTruthy()
    expect(screen.queryByLabelText('shortLinkCreate.expirationEnabled')).toBeNull()
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.intermediate'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({
      targetUrl: 'https://example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
    })
    expect(mutate.mock.calls[0]?.[0]).not.toHaveProperty('expiration')
  })

  it('submits intermediate and future expiration settings then resets defaults', async () => {
    setQueryResult([
      'short_link:create',
      'domain:use_default',
      'short_link:use_intermediate',
      'short_link:set_expiration',
    ])
    setMutationResult()

    mountPanel()

    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    expect(screen.queryByLabelText('shortLinkCreate.intermediateDelay')).toBeNull()
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.intermediate'))
    expect(screen.getByLabelText('shortLinkCreate.intermediateDelay')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.intermediateDelay'), '7')
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.direct'))
    expect(screen.queryByLabelText('shortLinkCreate.intermediateDelay')).toBeNull()
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.intermediate'))

    await fireEvent.click(screen.getByLabelText('shortLinkCreate.expirationEnabled'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(screen.getByText('shortLinkCreate.expirationRequired')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.expiresAt'), '2020-01-01T00:00')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(createShortLink).not.toHaveBeenCalled()
    expect(screen.getByText('shortLinkCreate.expirationFuture')).toBeTruthy()

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.expiresAt'), '2099-01-01T00:00')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(createShortLink).toHaveBeenCalledWith({
      targetUrl: 'https://example.com/docs',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 7,
      expiration: { mode: 'at', expiresAt: new Date('2099-01-01T00:00').toISOString() },
    })
    expect(await screen.findByTestId('short-link-create-result')).toBeTruthy()
    expect((screen.getByLabelText('shortLinkCreate.targetLabel') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('shortLinkCreate.intermediateDelay')).toBeNull()
    expect((screen.getByLabelText('shortLinkCreate.expirationEnabled') as HTMLInputElement).checked).toBe(false)
  })

  it('submits never expiration without exposing intermediate controls', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_expiration'])
    setMutationResult({ mutate })

    mountPanel()

    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    expect(screen.queryByText('shortLinkCreate.redirectMode')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({
      targetUrl: 'https://example.com',
      expiration: { mode: 'never' },
    })
  })

  it('shows password controls only with permission and submits a protected link', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_password'])
    setMutationResult()
    let sentInput: CreateShortLinkInput | undefined
    vi.mocked(createShortLink).mockImplementation(async (request) => {
      sentInput = structuredClone(request)
      return { shortLink: { slug: 'abc123', url: 'https://go.example.com/abc123' } } as never
    })

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    expect(screen.getByLabelText('shortLinkCreate.passwordEnabled')).toBeTruthy()
    expect(screen.queryByLabelText('shortLinkCreate.password')).toBeNull()

    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))
    expect(screen.getByLabelText('shortLinkCreate.password').getAttribute('autocomplete')).toBe('new-password')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.password'), 'correct horse')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(sentInput).toEqual({
      targetUrl: 'https://example.com',
      password: { mode: 'set', value: 'correct horse' },
    })
  })

  it('keeps raw passwords out of pending and failed mutation variables', async () => {
    const deferred = createDeferred<never>()
    const variables = ref<unknown>()
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_password'])
    setMutationResult({ variables })
    vi.mocked(createShortLink).mockReturnValue(deferred.promise)

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))
    const passwordInput = screen.getByLabelText('shortLinkCreate.password') as HTMLInputElement
    await fireEvent.update(passwordInput, 'correct horse')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(variables.value).toEqual({ targetUrl: 'https://example.com' })
    expect(passwordInput.value).toBe('')
    deferred.reject(new Error('create failed'))
    await vi.waitFor(() => {
      expect(screen.getByText('create failed')).toBeTruthy()
    })
    expect(variables.value).toEqual({ targetUrl: 'https://example.com' })
  })

  it('clears a protected input before rejecting a mutation that lost its password', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_password'])
    setMutationResult({ mutate })

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))
    const passwordInput = screen.getByLabelText('shortLinkCreate.password') as HTMLInputElement
    await fireEvent.update(passwordInput, 'correct horse')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    const options = state.mutationOptions[0] as {
      mutationFn?: (input: { targetUrl: string }) => Promise<unknown>
      onSettled?: () => void
    }
    options.onSettled?.()
    expect(passwordInput.value).toBe('')
    await expect(options.mutationFn?.({ targetUrl: 'https://example.com' })).rejects.toThrow('password validation failed')
    expect(screen.getByText('shortLinkCreate.passwordRequired')).toBeTruthy()
  })

  it('rejects an invalid protected-link password before mutation', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_password'])
    setMutationResult()

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))
    const passwordInput = screen.getByLabelText('shortLinkCreate.password') as HTMLInputElement
    await fireEvent.update(passwordInput, 'short')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    await vi.waitFor(() => expect(screen.getByText('shortLinkCreate.passwordInvalid')).toBeTruthy())
    expect(screen.queryByText('shortLinkCreate.failed')).toBeNull()
    expect(passwordInput.value).toBe('')
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('requires a password value when protection is enabled', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_password'])
    setMutationResult()

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(screen.getByText('shortLinkCreate.passwordRequired')).toBeTruthy()
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('fails safely when the password input element is unavailable', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_password'])
    setMutationResult({ mutate })

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))
    screen.getByLabelText('shortLinkCreate.password').remove()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(screen.getByText('shortLinkCreate.passwordRequired')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('hides password controls without password permission', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:use_intermediate'])
    setMutationResult()

    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))

    expect(screen.queryByLabelText('shortLinkCreate.passwordEnabled')).toBeNull()
    expect(screen.queryByLabelText('shortLinkCreate.password')).toBeNull()
  })

  it('validates target URL before submitting', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ mutate })

    mountPanel()

    for (const value of ['not-a-url', 'ftp://example.com']) {
      await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), value)
      await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

      expect(mutate).not.toHaveBeenCalled()
      expect(screen.getByText('shortLinkCreate.invalidUrl')).toBeTruthy()
    }
  })

  it('blocks duplicate submissions while creation is pending', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ isPending: ref(true), mutate })

    mountPanel()

    const submitButton = screen.getByText('shortLinkCreate.submit') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(submitButton)

    expect(mutate).not.toHaveBeenCalled()
  })

  it('disables advanced access settings while creation is pending', async () => {
    const isPending = ref(false)
    setQueryResult([
      'short_link:create',
      'domain:use_default',
      'short_link:use_intermediate',
      'short_link:set_expiration',
      'short_link:set_password',
    ])
    setMutationResult({ isPending })

    mountPanel()
    const advancedButton = screen.getByText('shortLinkCreate.advanced') as HTMLButtonElement
    await fireEvent.click(advancedButton)
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.intermediate'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.expirationEnabled'))
    await fireEvent.click(screen.getByLabelText('shortLinkCreate.passwordEnabled'))

    isPending.value = true
    await nextTick()

    expect(advancedButton.disabled).toBe(true)
    expect(screen.getByRole('radiogroup').getAttribute('disabled')).not.toBeNull()
    expect((screen.getByText('shortLinkCreate.redirectModes.direct') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('shortLinkCreate.redirectModes.intermediate') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('shortLinkCreate.intermediateDelay') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('shortLinkCreate.expirationEnabled') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('shortLinkCreate.expiresAt') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('shortLinkCreate.passwordEnabled') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('shortLinkCreate.password') as HTMLInputElement).disabled).toBe(true)
  })

  it('binds pending state into the submit button disabled expression', () => {
    const source = readFileSync('src/features/short-link-create/ShortLinkCreatePanel.vue', 'utf8')
    const submitButtonBlock = source.match(/<v-btn\s+class="short-link-create-panel__submit"[\s\S]+?<\/v-btn>/)?.[0] ?? ''

    expect(submitButtonBlock).toContain(':disabled="!canCreateShortLink || mutation.isPending.value"')
  })

  it('shows copy failures without clearing the created link', async () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    })

    mountPanel()

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await fireEvent.click(await screen.findByText('shortLinkCreate.copy'))

    expect(await screen.findByText('shortLinkCreate.copyFailed')).toBeTruthy()
    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()
  })

  it('shows a copy failure when the clipboard API is unavailable', async () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })

    mountPanel()

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await fireEvent.click(await screen.findByText('shortLinkCreate.copy'))

    expect(await screen.findByText('shortLinkCreate.copyFailed')).toBeTruthy()
  })

  it('shows API errors and fallback errors', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ error: ref(new Error('invalid target')) })

    const { unmount } = mountPanel()
    expect(screen.getByText('invalid target')).toBeTruthy()
    unmount()

    setMutationResult({ error: ref({}) })
    mountPanel()
    expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
  })

  it('shows a later API failure even when mutation data still contains a previous success', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({
      data: ref({ shortLink: { url: 'https://go.example.com/abc123' } }),
      error: ref(new Error('later failure')),
    })

    mountPanel()

    expect(screen.getByText('later failure')).toBeTruthy()
  })
})
