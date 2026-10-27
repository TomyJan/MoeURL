import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { me } from '@/entities/auth/api'
import { createShortLink } from '@/entities/short-link/api'
import { ApiClientError } from '@/shared/api/client'
import type { CreateShortLinkInput } from '@/entities/short-link/model'
import { createDeferred } from '@/test/deferred'
import type { MutationMockResult } from '@/test/mutation-mock'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as unknown[],
  queryResult: {},
  domainQueryResult: {},
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

vi.mock('@/shared/preferences/useDomainPreference', () => {
  const scope = ref({ userId: 'legacy-account', epoch: 1 })
  return {
    useAvailableDomainChoices: () => ({ refetch: vi.fn(), ...state.domainQueryResult }),
    useDomainPreference: () => ({ scope, isCurrent: (candidate: unknown) => candidate === scope.value, query: { data: ref({ domainId: null, updatedAt: null }), isSuccess: ref(true), isError: ref(false) } }),
  }
})

vi.mock('@/shared/preferences/useGroupDefaultDomain', () => ({
  useGroupDefaultDomain: () => ({ data: ref({ domainId: null, status: 'not_set' }), isSuccess: ref(true), isError: ref(false), refetch: vi.fn() }),
}))

vi.mock('@tanstack/vue-query', async () => {
  const { createMutationMock } = await import('@/test/mutation-mock')
  return {
    useMutation: createMutationMock({
      captureOptions: (options) => state.mutationOptions.push(options),
      fields: { isError: true, variables: true, reset: true },
      getResult: () => state.mutationResult as MutationMockResult,
    }),
    useQuery: vi.fn((options?: { queryKey?: readonly string[] }) => {
      state.queryOptions.push(options)
      return { refetch: vi.fn(), ...(options?.queryKey?.[0] === 'domain' ? state.domainQueryResult : state.queryResult) }
    }),
    useQueryClient: () => ({
      invalidateQueries: state.invalidateQueries,
    }),
  }
})

/** Mounts the creation panel with shared test defaults. */
function mountPanel(props: Record<string, unknown> = {}) {
  return render(ShortLinkCreatePanel, {
    props,
    global: {
      stubs: componentStubs,
    },
  })
}

/** Configures the permission query mock for the next panel render. */
function setQueryResult(permissions: string[]) {
  state.queryResult = {
    refetch: vi.fn(),
    data: ref({
      user: {
        permissions,
      },
    }),
  }
}

/** Configures the creation mutation mock for the next panel render. */
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
  it.each(['AbC', 'TeamDocs2026', 'A'.repeat(32)])('submits normalized custom slug %s and resets it for the next creation', async (value) => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:custom_slug'])
    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    const field = screen.getByLabelText('shortLinkCreate.customSlug') as HTMLInputElement
    await fireEvent.update(field, value)
    expect(field.value).toBe(value)
    expect(screen.getByTestId('custom-slug-preview').textContent).toBe(`https://go.example.com/${value.toLowerCase()}`)
    expect(screen.getByText('shortLinkCreate.customSlugHint')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(createShortLink).toHaveBeenCalledWith({ targetUrl: 'https://example.com/docs', customSlug: value.toLowerCase() })
    await screen.findByTestId('short-link-create-result')
    await fireEvent.click(screen.getByText('shortLinkCreate.reset'))
    expect(field.value).toBe('')
    expect(screen.queryByTestId('custom-slug-preview')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com/random')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(createShortLink).toHaveBeenLastCalledWith({ targetUrl: 'https://example.com/random' })
  })

  it.each(['ab', 'a'.repeat(33), ' team ', 'ＡBC', 'abK', 'abc-def', 'abc_def', 'ab/c', 'ab%20'])('rejects raw invalid custom slug %j and reveals collapsed advanced settings', async (value) => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:custom_slug'])
    mountPanel()
    const advanced = screen.getByText('shortLinkCreate.advanced')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(advanced)
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.customSlug'), value)
    expect(screen.queryByTestId('custom-slug-preview')).toBeNull()
    await fireEvent.click(advanced)
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(advanced.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('shortLinkCreate.customSlugInvalid')
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('omits cached custom slug after permission loss and disables it during creation', async () => {
    const permissions = ref({ user: { permissions: ['short_link:create', 'domain:use_default', 'short_link:custom_slug'] } })
    state.queryResult = { data: permissions }
    const pending = ref(false)
    const mutate = vi.fn()
    setMutationResult({ mutate, isPending: pending })
    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    const field = screen.getByLabelText('shortLinkCreate.customSlug')
    await fireEvent.update(field, 'TeamDocs')
    pending.value = true
    await nextTick()
    expect(field).toHaveProperty('disabled', true)
    pending.value = false
    permissions.value.user.permissions = ['short_link:create', 'domain:use_default', 'short_link:set_metadata']
    await nextTick()
    expect(screen.queryByLabelText('shortLinkCreate.customSlug')).toBeNull()
    expect(screen.queryByTestId('custom-slug-preview')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com', metadata: { title: '', tags: [] } })
  })

  it.each([
    { code: 200101, key: 'shortLinkCreate.customSlugConflict' },
    { code: 200102, key: 'shortLinkCreate.customSlugReserved' },
    { code: 120001, key: 'shortLinkCreate.failed' },
    { code: 200114, key: 'shortLinkCreate.domainOrPermissionsChanged' },
  ])('preserves the entire draft after $code and allows random fallback', async ({ code, key }) => {
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned', 'short_link:custom_slug', 'short_link:set_metadata'])
    state.domainQueryResult = {
      data: ref({ items: [
        { id: 'primary', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
        { id: 'second', host: 'https://links.example.com/', displayName: 'Second', isDefault: false },
      ] }), isPending: ref(false), isError: ref(false),
    }
    vi.mocked(createShortLink).mockRejectedValueOnce(new ApiClientError(code, 'Untrusted server details'))
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com/docs')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), 'second')
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.customSlug'), 'TeamDocs')
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), 'Team')
    await fireEvent.update(screen.getByLabelText('linkMetadata.tags'), 'Docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(await screen.findByText(key)).toBeTruthy()
    expect(screen.queryByText('Untrusted server details')).toBeNull()
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('value', 'https://example.com/docs')
    expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', 'second')
    expect(screen.getByLabelText('shortLinkCreate.customSlug')).toHaveProperty('value', 'TeamDocs')
    expect(screen.getByLabelText('linkMetadata.title')).toHaveProperty('value', 'Team')
    expect(screen.getByLabelText('linkMetadata.tags')).toHaveProperty('value', 'Docs')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.customSlug'), '')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(createShortLink).toHaveBeenLastCalledWith({ targetUrl: 'https://example.com/docs', domainId: 'second', metadata: { title: 'Team', tags: ['Docs'] } })
  })

  it('updates preview on domain selection, authorization fallback and failed refetch', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned', 'short_link:custom_slug'])
    const data = ref({ items: [
      { id: 'second', host: 'https://links.example.com/', displayName: 'Second', isDefault: false },
      { id: 'primary', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
    ] })
    const isError = ref(false)
    state.domainQueryResult = { data, isPending: ref(false), isError }
    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.customSlug'), 'Docs2026')
    expect(screen.getByTestId('custom-slug-preview').textContent).toBe('https://go.example.com/docs2026')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), 'second')
    expect(screen.getByTestId('custom-slug-preview').textContent).toBe('https://links.example.com/docs2026')
    data.value = { items: [data.value.items[1]!] }
    await nextTick()
    expect(screen.getByTestId('custom-slug-preview').textContent).toBe('https://go.example.com/docs2026')
    isError.value = true
    await nextTick()
    expect(screen.queryByTestId('custom-slug-preview')).toBeNull()
    isError.value = false
    data.value = { items: [] }
    await nextTick()
    expect(screen.queryByTestId('custom-slug-preview')).toBeNull()
  })

  it('previews a legacy assigned authority using the same HTTPS origin as the server', async () => {
    setQueryResult(['short_link:create', 'domain:use_assigned', 'short_link:custom_slug'])
    state.domainQueryResult = {
      data: ref({ items: [{ id: 'assigned', host: 'links.example.com:8443', displayName: 'Assigned', isDefault: false }] }),
      isPending: ref(false), isError: ref(false),
      refetch: vi.fn(),
    }
    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.customSlug'), 'TeamDocs')
    expect(screen.getByTestId('custom-slug-preview').textContent).toBe('https://links.example.com:8443/teamdocs')
  })

  it('creates trimmed metadata only with its independent permission and resets the inputs', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_metadata'])
    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), '\u0085文档入口\u3000')
    await fireEvent.update(screen.getByLabelText('linkMetadata.tags'), ' 团队资料 \n Release 计划 ')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await nextTick()
    expect(createShortLink).toHaveBeenCalledWith({ targetUrl: 'https://example.com', metadata: { title: '文档入口', tags: ['团队资料', 'Release 计划'] } })
    expect((screen.getByLabelText('linkMetadata.title') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('linkMetadata.tags') as HTMLTextAreaElement).value).toBe('')
  })

  it('blocks invalid metadata and omits the draft after permission is revoked', async () => {
    const data = ref({ user: { permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] } })
    state.queryResult = { data }
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), '😀'.repeat(121))
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(screen.getByText('linkMetadata.titleInvalid')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
    await fireEvent.update(screen.getByLabelText('linkMetadata.title'), 'Valid')
    await fireEvent.update(screen.getByLabelText('linkMetadata.tags'), 'duplicate\nduplicate')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(screen.getByText('linkMetadata.tagsInvalid')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
    data.value.user.permissions = ['short_link:create', 'domain:use_default']
    await nextTick()
    expect(screen.queryByLabelText('linkMetadata.title')).toBeNull()
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenLastCalledWith({ targetUrl: 'https://example.com' })
  })

  it.each([
    { field: 'title', invalid: '😀'.repeat(121), valid: '文档入口', error: 'linkMetadata.titleInvalid' },
    { field: 'tags', invalid: 'A\nA', valid: 'A\nB', error: 'linkMetadata.tagsInvalid' },
  ])('reveals invalid $field after advanced settings are collapsed and allows correction', async ({ field, invalid, valid, error }) => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_metadata'])
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mountPanel()
    const advanced = screen.getByText('shortLinkCreate.advanced')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(advanced)
    await fireEvent.update(screen.getByLabelText(`linkMetadata.${field}`), invalid)
    await fireEvent.click(advanced)
    expect(screen.queryByLabelText(`linkMetadata.${field}`)).toBeNull()

    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).not.toHaveBeenCalled()
    expect(advanced.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(error)).toBeTruthy()
    expect((screen.getByLabelText(`linkMetadata.${field}`) as HTMLInputElement).value).toBe(invalid)
    await fireEvent.update(screen.getByLabelText(`linkMetadata.${field}`), valid)
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({
      targetUrl: 'https://example.com',
      metadata: field === 'title' ? { title: valid, tags: [] } : { title: '', tags: ['A', 'B'] },
    })
  })

  it('blocks creation after a permission refetch fails even with cached permissions', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_max_visits'])
    state.queryResult = { ...state.queryResult, isError: ref(true) }
    mountPanel()
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('submits a finite visit limit and resets it after success', async () => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_max_visits'])
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('visitLimit.enabled'))
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), '2')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(createShortLink).toHaveBeenCalledWith({ targetUrl: 'https://example.com', maxVisits: 2 })
    await screen.findByTestId('short-link-create-result')
    expect((screen.getByLabelText('visitLimit.enabled') as HTMLInputElement).checked).toBe(false)
  })

  it.each(['', '0', '-1', '1.5', '1e2', '2147483648'])('rejects invalid visit limit %s before creating', async (value) => {
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_max_visits'])
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('visitLimit.enabled'))
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), value)
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(screen.getByText('visitLimit.invalid')).toBeTruthy()
    expect(createShortLink).not.toHaveBeenCalled()
  })

  it('keeps the quota draft after failure, disables it while pending and omits it after permission loss', async () => {
    const pending = ref(false)
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'short_link:set_max_visits'])
    setMutationResult({ mutate, isPending: pending })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByLabelText('visitLimit.enabled'))
    await fireEvent.update(screen.getByLabelText('visitLimit.maximum'), '2147483647')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenLastCalledWith({ targetUrl: 'https://example.com', maxVisits: 2147483647 })
    expect((screen.getByLabelText('visitLimit.maximum') as HTMLInputElement).value).toBe('2147483647')
    pending.value = true
    await nextTick()
    expect((screen.getByLabelText('visitLimit.maximum') as HTMLInputElement).disabled).toBe(true)
    pending.value = false
    const query = state.queryResult as { data: { value: { user: { permissions: string[] } } } }
    query.data.value.user.permissions = ['short_link:create', 'domain:use_default']
    await nextTick()
    expect(screen.queryByLabelText('visitLimit.enabled')).toBeNull()
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenLastCalledWith({ targetUrl: 'https://example.com' })
  })

  beforeEach(() => {
    state.invalidateQueries.mockReset()
    state.mutationOptions = []
    state.queryOptions = []
    vi.mocked(me).mockResolvedValue({ user: { id: 'legacy-account', username: 'legacy', nickname: '', group: 'user', permissions: [] } })
    vi.mocked(createShortLink).mockReset()
    vi.mocked(createShortLink).mockResolvedValue({
      shortLink: { slug: 'abc123', url: 'https://go.example.com/abc123' },
    } as never)
    setQueryResult([])
    state.domainQueryResult = {
      data: ref({ items: [{ id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true }] }),
      isPending: ref(false), isError: ref(false),
      refetch: vi.fn(),
    }
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

  it('shows no permission warning while an authorized user waits for domains', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    state.domainQueryResult = { data: ref(undefined), isPending: ref(true), isError: ref(false) }
    mountPanel()
    expect(screen.queryByText('shortLinkCreate.permissionRequired')).toBeNull()
    expect(screen.queryByText('shortLinkCreate.noAvailableDomains')).toBeNull()
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
  })

  it('offers a retry rather than a permission warning when domains fail to load', async () => {
    const refetch = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    state.domainQueryResult = { data: ref(undefined), isPending: ref(false), isError: ref(true), refetch }
    mountPanel()
    expect(screen.getByRole('alert').textContent).toContain('shortLinkCreate.domainLoadFailed')
    expect(screen.queryByText('shortLinkCreate.permissionRequired')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryDomains' }))
    expect(refetch).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
  })

  it('explains an empty successful domain list without implying missing permissions', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    state.domainQueryResult = { data: ref({ items: [] }), isPending: ref(false), isError: ref(false) }
    mountPanel()
    expect(screen.getByText('shortLinkCreate.noAvailableDomains')).toBeTruthy()
    expect(screen.queryByText('shortLinkCreate.permissionRequired')).toBeNull()
  })

  it('sends an explicit domain ID only when another authorized domain is selected', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned'])
    state.domainQueryResult = {
      data: ref({ items: [
        { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
        { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
      ] }), isPending: ref(false), isError: ref(false),
    }
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), '00000000-0000-4000-8000-000000000802')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com', domainId: '00000000-0000-4000-8000-000000000802' })
  })

  it('uses the server default without a domain ID even when it is not first in the list', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned'])
    state.domainQueryResult = {
      data: ref({ items: [
        { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
        { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
      ] }), isPending: ref(false), isError: ref(false),
    }
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
  })

  it('submits the default domain ID when only assigned-domain permission is granted', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_assigned'])
    state.domainQueryResult = {
      data: ref({ items: [
        { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
        { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
      ] }), isPending: ref(false), isError: ref(false),
    }
    setMutationResult({ mutate })
    mountPanel()
    expect((screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement).value).toBe('00000000-0000-4000-8000-000000000801')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com', domainId: '00000000-0000-4000-8000-000000000801' })
  })

  it('submits the sole assigned domain explicitly when no default grant is available', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_assigned'])
    state.domainQueryResult = {
      data: ref({ items: [{ id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false }] }),
      isPending: ref(false), isError: ref(false),
    }
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com', domainId: '00000000-0000-4000-8000-000000000802' })
  })

  it('clears an assigned choice when a later authorization response removes it', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned'])
    const data = ref({ items: [
      { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
      { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
    ] })
    state.domainQueryResult = { data, isPending: ref(false), isError: ref(false) }
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), '00000000-0000-4000-8000-000000000802')
    data.value = { items: [data.value.items[0]!] }
    await nextTick()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
  })

  it('keeps an explicit choice when a refreshed domain list still authorizes it', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned'])
    const data = ref({ items: [
      { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
      { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
    ] })
    state.domainQueryResult = { data, isPending: ref(false), isError: ref(false) }
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), '00000000-0000-4000-8000-000000000802')
    data.value = { items: [data.value.items[0]!, { ...data.value.items[1]!, displayName: 'Renamed' }] }
    await nextTick()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com', domainId: data.value.items[1]?.id })
  })

  it('waits for available domains and rejects create permission without either domain grant', () => {
    setQueryResult(['short_link:create'])
    state.domainQueryResult = { data: ref(undefined), isPending: ref(true), isError: ref(false) }
    mountPanel()
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
  })

  it('does not submit a stale explicit domain selection after its query fails', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned'])
    const data = ref({ items: [
      { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
      { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
    ] })
    const isError = ref(false)
    state.domainQueryResult = { data, isPending: ref(false), isError }
    setMutationResult({ mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), '00000000-0000-4000-8000-000000000802')
    isError.value = true
    await nextTick()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('preserves an explicit domain selection across a failed refetch without allowing submission', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default', 'domain:use_assigned'])
    const data = ref({ items: [
      { id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary', isDefault: true },
      { id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Second', isDefault: false },
    ] })
    const isError = ref(false)
    state.domainQueryResult = { data, isPending: ref(false), isError }
    setMutationResult({ mutate })
    mountPanel()
    const selector = screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement
    await fireEvent.update(selector, data.value.items[1]!.id)
    isError.value = true
    await nextTick()
    expect(selector.value).toBe(data.value.items[1]!.id)
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).not.toHaveBeenCalled()
    isError.value = false
    await nextTick()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com', domainId: data.value.items[1]!.id })
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

  it('submits confirmation without an intermediate delay when only confirmation access is allowed', async () => {
    const mutate = vi.fn()
    setQueryResult([
      'short_link:create',
      'domain:use_default',
      'short_link:use_confirmation',
    ])
    setMutationResult({ mutate })

    mountPanel()

    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    expect(screen.queryByText('shortLinkCreate.redirectModes.intermediate')).toBeNull()
    expect(screen.getByText('shortLinkCreate.redirectModes.confirmation')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.confirmation'))
    expect(screen.queryByLabelText('shortLinkCreate.intermediateDelay')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com/confirm')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({
      targetUrl: 'https://example.com/confirm',
      redirectMode: 'confirmation',
    })
  })

  it('falls back to direct when the selected redirect permission is removed', async () => {
    const mutate = vi.fn()
    const currentUser = ref({
      user: {
        permissions: [
          'short_link:create',
          'domain:use_default',
          'short_link:use_intermediate',
          'short_link:use_confirmation',
        ],
      },
    })
    state.queryResult = { data: currentUser }
    setMutationResult({ mutate })
    mountPanel()

    await fireEvent.click(screen.getByText('shortLinkCreate.advanced'))
    await fireEvent.click(screen.getByText('shortLinkCreate.redirectModes.confirmation'))
    currentUser.value = {
      user: {
        permissions: [
          'short_link:create',
          'domain:use_default',
          'short_link:use_confirmation',
        ],
      },
    }
    await nextTick()
    expect(screen.getByText('shortLinkCreate.redirectModes.confirmation').getAttribute('aria-pressed')).toBe('true')

    currentUser.value = {
      user: {
        permissions: [
          'short_link:create',
          'domain:use_default',
          'short_link:use_intermediate',
        ],
      },
    }
    await nextTick()

    expect(screen.queryByText('shortLinkCreate.redirectModes.confirmation')).toBeNull()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com/changed')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({
      targetUrl: 'https://example.com/changed',
      redirectMode: 'direct',
    })
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
      expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
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
      onSettled?: (result: unknown, error: unknown, input: unknown) => void
    }
    options.onSettled?.(undefined, null, mutate.mock.calls[0]![0])
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

  it('blocks another submission while a creation is pending', async () => {
    const isPending = ref(false)
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ isPending, mutate })
    mountPanel()
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(false)
    isPending.value = true
    await nextTick()
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(mutate).not.toHaveBeenCalled()
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
    expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
    expect(screen.queryByText('invalid target')).toBeNull()
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

    expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
  })
})
