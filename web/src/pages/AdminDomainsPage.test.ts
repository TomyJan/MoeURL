import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { createDomain, deleteDomain, listDomains, setDefaultDomain, updateDomain } from '@/entities/domain/api'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import AdminDomainsPage from './AdminDomainsPage.vue'

const primary = {
  id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary',
  purpose: 'short_link' as const, enabled: true, isDefault: true, allowedGroups: ['user', 'admin'] as Array<'user' | 'admin'>,
  referenced: false, updatedAt: '2026-09-14T00:00:00Z',
}
const secondary = { ...primary, id: '00000000-0000-4000-8000-000000000802', host: 'https://links.example.com', displayName: 'Secondary', isDefault: false }
const state = vi.hoisted(() => ({
  data: undefined as unknown as ReturnType<typeof ref<{ items: typeof primary[] } | undefined>>,
  pending: undefined as unknown as ReturnType<typeof ref<boolean>>,
  error: undefined as unknown as ReturnType<typeof ref<boolean>>,
  refetch: vi.fn(), invalidate: vi.fn(), setQueryData: vi.fn(),
}))

vi.mock('@/entities/domain/api', async (original) => ({
  ...await original<typeof import('@/entities/domain/api')>(),
  createDomain: vi.fn(), deleteDomain: vi.fn(), listDomains: vi.fn(), setDefaultDomain: vi.fn(), updateDomain: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@tanstack/vue-query', () => ({
  useQuery: () => ({ data: state.data, isPending: state.pending, isError: state.error, refetch: state.refetch }),
  useQueryClient: () => ({ invalidateQueries: state.invalidate, setQueryData: state.setQueryData }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: (result: unknown, input: unknown) => void | Promise<void>; onError: (error: unknown, input: unknown) => Promise<void> }) => {
    const isPending = ref(false)
    return {
      isPending,
      mutate: (input: unknown) => {
        isPending.value = true
        void options.mutationFn(input)
          .then((result) => options.onSuccess(result, input))
          .catch((error) => options.onError(error, input))
          .finally(() => { isPending.value = false })
      },
    }
  },
}))

function mount() { return render(AdminDomainsPage, { global: { stubs: componentStubs } }) }

beforeEach(() => {
  state.data = ref({ items: [primary, secondary] })
  state.pending = ref(false)
  state.error = ref(false)
  state.refetch.mockReset()
  state.refetch.mockImplementation(async () => ({ isSuccess: true, data: state.data.value }))
  state.invalidate.mockReset()
  state.setQueryData.mockReset()
  state.setQueryData.mockImplementation((_key, updater) => { state.data.value = updater(state.data.value) })
  vi.mocked(listDomains).mockReset()
  vi.mocked(createDomain).mockReset()
  vi.mocked(updateDomain).mockReset()
  vi.mocked(setDefaultDomain).mockReset()
  vi.mocked(deleteDomain).mockReset()
})

describe('AdminDomainsPage', () => {
  it('provides loading, retry and empty states', async () => {
    state.pending.value = true
    state.data.value = undefined
    const loading = mount()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    loading.unmount()
    state.pending.value = false
    state.error.value = true
    const failed = render(AdminDomainsPage, { global: { stubs: { ...componentStubs, VAlert: { template: '<div role="alert"><slot /><slot name="append" /></div>' } } } })
    await fireEvent.click(screen.getByRole('button', { name: 'domains.retry' }))
    expect(state.refetch).toHaveBeenCalled()
    failed.unmount()
    state.error.value = false
    state.data.value = { items: [] }
    mount()
    expect(screen.getByText('domains.empty')).toBeTruthy()
  })

  it('preserves a dirty draft and its original revision after a conflict refresh', async () => {
    vi.mocked(updateDomain).mockRejectedValue(new ApiClientError(210103, 'conflict'))
    state.refetch.mockImplementation(async () => {
      state.data.value = { items: [primary, { ...secondary, displayName: 'Other editor', updatedAt: '2026-09-14T01:00:00Z' }] }
      return { isSuccess: true, data: state.data.value }
    })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'My draft')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'My draft'))
    await waitFor(() => expect(screen.getByText('domains.conflict')).toBeTruthy())
    expect(vi.mocked(updateDomain).mock.calls[0]?.[0]).toMatchObject({ expectedUpdatedAt: secondary.updatedAt, displayName: 'My draft' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', false))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    expect(vi.mocked(updateDomain).mock.calls[1]?.[0]).toMatchObject({ expectedUpdatedAt: secondary.updatedAt })
  })

  it('requires explicit confirmation before replacing a conflicted draft and reloads the latest revision', async () => {
    const latest = { ...secondary, displayName: 'Remote edit', updatedAt: '2026-09-14T01:00:00Z' }
    vi.mocked(updateDomain).mockRejectedValueOnce(new ApiClientError(210103, 'conflict')).mockResolvedValueOnce({ domain: { ...latest, displayName: 'Confirmed edit' } })
    state.refetch.mockImplementation(async () => {
      state.data.value = { items: [primary, latest] }
      return { isSuccess: true, data: state.data.value }
    })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Local edit')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(screen.getByText('domains.conflict')).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: 'domains.reloadDraft' }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Local edit')
    await fireEvent.click(screen.getByRole('button', { name: /Remote edit/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Local edit')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    await waitFor(() => expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Remote edit'))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Confirmed edit')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(updateDomain).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: latest.updatedAt, displayName: 'Confirmed edit' })))
  })

  it('keeps unsaved changes when switching domains is canceled', async () => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'My unsaved changes')
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'My unsaved changes')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(expect.objectContaining({ id: secondary.id, expectedUpdatedAt: secondary.updatedAt })))
  })

  it('asks before replacing an edited domain with a new-domain form', async () => {
    mount()
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'My changes')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'My changes')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', '')
  })

  it.each(['host', 'displayName', 'allowedGroups', 'enabled'] as const)('does not drop a new-domain %s draft when selecting a domain', async (field) => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    if (field === 'host') await fireEvent.update(screen.getByLabelText('domains.host'), 'https://new.example.com')
    if (field === 'displayName') await fireEvent.update(screen.getByLabelText('domains.displayName'), 'New domain')
    if (field === 'allowedGroups') await fireEvent.click(screen.getByLabelText('domains.groups.user'))
    if (field === 'enabled') await fireEvent.click(screen.getByLabelText('domains.enabled'))
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByText('domains.createTitle')).toBeTruthy()
  })

  it('keeps a conflicted draft when another reload fails, until a later confirmation succeeds', async () => {
    const latest = { ...secondary, updatedAt: '2026-09-14T02:00:00Z' }
    vi.mocked(updateDomain).mockRejectedValue(new ApiClientError(210103, 'conflict'))
    state.refetch.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce({ isSuccess: false, data: undefined })
      .mockImplementationOnce(async () => { state.data.value = { items: [primary, latest] }; return { isSuccess: true, data: state.data.value } })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Keep this')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce())
    await fireEvent.click(screen.getByRole('button', { name: 'domains.reloadDraft' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep this')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does not discard a conflicted draft when the confirmation is canceled during refresh', async () => {
    let resolveRefresh!: (result: { isSuccess: true; data: { items: typeof primary[] } }) => void
    const latest = { ...secondary, updatedAt: '2026-09-14T03:00:00Z' }
    vi.mocked(updateDomain).mockRejectedValue(new ApiClientError(210103, 'conflict'))
    state.refetch.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Retain this')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce())
    await fireEvent.click(screen.getByRole('button', { name: 'domains.reloadDraft' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(2))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'domains.cancel' }))
    state.data.value = { items: [primary, latest] }
    resolveRefresh({ isSuccess: true, data: state.data.value })
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Retain this')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the draft if the selected domain disappears before discard confirmation', async () => {
    mount()
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'My changes')
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    state.data.value = { items: [primary] }
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'My changes')
  })

  it('keeps an edited deleted domain until the pending switch is confirmed', async () => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Keep my draft')
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    state.data.value = { items: [primary] }
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep my draft')
    expect(screen.getByText('domains.removedDraft')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', true)
    await fireEvent.submit(screen.getByLabelText('domains.displayName').closest('form')!)
    expect(updateDomain).not.toHaveBeenCalled()
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep my draft')
    state.data.value = { items: [] }
    await nextTick()
    expect(screen.getByText('domains.empty')).toBeTruthy()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep my draft')
    state.data.value = { items: [primary] }
    await nextTick()
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', primary.displayName)
    expect(updateDomain).not.toHaveBeenCalled()
  })

  it('preserves a draft when a conflict refresh removes its domain', async () => {
    vi.mocked(updateDomain).mockRejectedValue(new ApiClientError(210103, 'conflict'))
    state.refetch.mockImplementation(async () => {
      state.data.value = { items: [primary] }
      return { isSuccess: true, data: state.data.value }
    })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Keep after conflict')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(screen.getByText('domains.removedDraft')).toBeTruthy())
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep after conflict')
    expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', true)
  })

  it('closes the discard dialog without dropping edits', async () => {
    render(AdminDomainsPage, { global: { stubs: {
      ...componentStubs,
      VDialog: { props: ['modelValue'], emits: ['update:modelValue'], template: '<div v-if="modelValue" role="dialog"><button aria-label="close-discard" @click="$emit(\'update:modelValue\', false)" /><slot /></div>' },
    } } })
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Keep me')
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'close-discard' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep me')
  })

  it('switches the default using the selected domain revision', async () => {
    vi.mocked(setDefaultDomain).mockResolvedValue({ domain: { ...secondary, isDefault: true } })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.setDefault' }))
    await waitFor(() => expect(setDefaultDomain).toHaveBeenCalledWith({ id: secondary.id, expectedUpdatedAt: secondary.updatedAt }))
  })

  it('keeps unsaved edits when setting the default and saves against its new revision', async () => {
    const selected = { ...secondary, isDefault: true, updatedAt: '2026-09-14T01:00:00Z' }
    vi.mocked(setDefaultDomain).mockResolvedValue({ domain: selected })
    vi.mocked(updateDomain).mockResolvedValue({ domain: { ...selected, displayName: 'My unsaved name', allowedGroups: ['admin'] } })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'My unsaved name')
    await fireEvent.click(screen.getByLabelText('domains.groups.user'))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.setDefault' }))
    await waitFor(() => expect(state.setQueryData).toHaveBeenCalled())
    await nextTick()
    await waitFor(() => expect(screen.getByText('domains.saved')).toBeTruthy())
    expect(updateDomain).not.toHaveBeenCalled()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'My unsaved name')
    expect(screen.getByLabelText('domains.groups.user')).toHaveProperty('checked', false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', false))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(expect.objectContaining({
      id: secondary.id, expectedUpdatedAt: selected.updatedAt, displayName: 'My unsaved name', allowedGroups: ['admin'],
    })))
  })

  it('reconciles a pending disable edit when its domain becomes the default', async () => {
    const promoted = { ...secondary, isDefault: true, updatedAt: '2026-09-14T01:00:00Z' }
    vi.mocked(setDefaultDomain).mockResolvedValue({ domain: promoted })
    vi.mocked(updateDomain).mockResolvedValue({ domain: { ...promoted, displayName: 'Keep this name' } })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Keep this name')
    await fireEvent.click(screen.getByLabelText('domains.enabled'))
    expect(screen.getByLabelText('domains.enabled')).toHaveProperty('checked', false)
    await fireEvent.click(screen.getByRole('button', { name: 'domains.setDefault' }))
    await waitFor(() => expect(screen.getByText('domains.saved')).toBeTruthy())
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Keep this name')
    expect(screen.getByLabelText('domains.enabled')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('domains.enabled')).toHaveProperty('disabled', true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', false))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(expect.objectContaining({
      id: secondary.id, expectedUpdatedAt: promoted.updatedAt, displayName: 'Keep this name', enabled: true,
    })))
  })

  it('blocks writes to the former default until the authoritative list refresh completes', async () => {
    const promoted = { ...secondary, isDefault: true, updatedAt: '2026-09-14T01:00:00Z' }
    const formerDefault = { ...primary, isDefault: false, updatedAt: '2026-09-14T01:00:01Z' }
    let resolveRefresh!: (result: { isSuccess: true; data: { items: typeof primary[] } }) => void
    state.refetch.mockImplementation(() => new Promise((resolve) => { resolveRefresh = resolve }))
    vi.mocked(setDefaultDomain).mockResolvedValue({ domain: promoted })
    vi.mocked(updateDomain).mockResolvedValue({ domain: { ...formerDefault, displayName: 'Former default' } })

    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.setDefault' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1))
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', true)

    state.data.value = { items: [promoted, formerDefault] }
    resolveRefresh({ isSuccess: true, data: state.data.value })
    await waitFor(() => expect(screen.getByLabelText('domains.displayName')).toHaveProperty('disabled', false))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Former default')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(expect.objectContaining({
      id: formerDefault.id, expectedUpdatedAt: formerDefault.updatedAt, displayName: 'Former default',
    })))
  })

  it('keeps domain writes blocked after a failed default refresh until retry succeeds', async () => {
    const promoted = { ...secondary, isDefault: true, updatedAt: '2026-09-14T01:00:00Z' }
    const formerDefault = { ...primary, isDefault: false, updatedAt: '2026-09-14T01:00:01Z' }
    state.refetch.mockResolvedValueOnce({ isSuccess: false, data: undefined })
    vi.mocked(setDefaultDomain).mockResolvedValue({ domain: promoted })

    render(AdminDomainsPage, { global: { stubs: { ...componentStubs, VAlert: { template: '<div role="alert"><slot /><slot name="append" /></div>' } } } })
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.setDefault' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'domains.retry' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'domains.add' })).toHaveProperty('disabled', true)

    state.refetch.mockImplementationOnce(async () => {
      state.data.value = { items: [promoted, formerDefault] }
      return { isSuccess: true, data: state.data.value }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'domains.retry' }))
    await waitFor(() => expect(screen.getByLabelText('domains.displayName')).toHaveProperty('disabled', false))
    expect(state.refetch).toHaveBeenCalledTimes(2)
  })

  it('confirms deletion of only the captured unreferenced domain', async () => {
    vi.mocked(deleteDomain).mockResolvedValue(undefined)
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.delete' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(updateDomain).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDelete' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenCalledWith({ id: secondary.id, expectedUpdatedAt: secondary.updatedAt }))
  })

  it('creates a domain with explicitly selected groups and preserves a real empty state', async () => {
    state.data.value = { items: [] }
    const created = { ...secondary, allowedGroups: ['user'] as Array<'user' | 'admin'> }
    vi.mocked(createDomain).mockResolvedValue({ domain: created })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    await fireEvent.update(screen.getByLabelText('domains.host'), ' https://links.example.com ')
    await fireEvent.update(screen.getByLabelText('domains.displayName'), ' Second ')
    await fireEvent.click(screen.getByLabelText('domains.groups.user'))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(createDomain).toHaveBeenCalledWith({
      host: 'https://links.example.com', displayName: 'Second', allowedGroups: ['user'], enabled: true,
    }))
    await waitFor(() => expect(screen.getByText('domains.saved')).toBeTruthy())
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['domain', 'available'] })
  })

  it('can cancel creation and rejects an empty submitted address', async () => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    expect(screen.getByText('domains.saveFailed')).toBeTruthy()
    expect(createDomain).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByLabelText('domains.host')).toHaveProperty('value', primary.host)
    expect(createDomain).not.toHaveBeenCalled()
  })

  it('closes a fresh create form even when no domains exist', async () => {
    state.data.value = { items: [] }
    mount()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByText('domains.empty')).toBeTruthy()
  })

  it('updates name, grants and enabled state but locks an address with existing links', async () => {
    state.data.value = { items: [primary, { ...secondary, referenced: true }] }
    vi.mocked(updateDomain).mockResolvedValue({ domain: { ...secondary, referenced: true, displayName: 'Renamed', enabled: false, allowedGroups: ['admin'] } })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    expect(screen.getByLabelText('domains.host')).toHaveProperty('disabled', true)
    expect(screen.getByText('domains.addressLocked')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'domains.delete' })).toHaveProperty('disabled', true)
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Renamed')
    await fireEvent.click(screen.getByLabelText('domains.groups.user'))
    await fireEvent.click(screen.getByLabelText('domains.enabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(updateDomain).toHaveBeenCalledWith(expect.objectContaining({
      id: secondary.id, expectedUpdatedAt: secondary.updatedAt, displayName: 'Renamed', allowedGroups: ['admin'], enabled: false,
    })))
    await waitFor(() => expect(screen.getByText('domains.saved')).toBeTruthy())
  })

  it('does not put save feedback from a previous selection on another domain', async () => {
    let resolve!: (value: { domain: typeof secondary }) => void
    vi.mocked(updateDomain).mockReturnValue(new Promise((done) => { resolve = done }))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    resolve({ domain: secondary })
    await waitFor(() => expect(state.setQueryData).toHaveBeenCalled())
    expect(screen.queryByText('domains.saved')).toBeNull()
  })

  it('reconciles a later successful query after the first conflict reload fails', async () => {
    vi.mocked(updateDomain).mockRejectedValue(new ApiClientError(210103, 'conflict'))
    state.refetch.mockRejectedValue(new Error('offline'))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Local edits')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalled())
    state.data.value = { items: [primary, { ...secondary, displayName: 'Remote edits', updatedAt: '2026-09-14T01:00:00Z' }] }
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Local edits')
    expect(screen.getByText('domains.conflict')).toBeTruthy()
  })

  it('retains the pending revision when refetch resolves with an error result', async () => {
    vi.mocked(updateDomain).mockRejectedValueOnce(new ApiClientError(210103, 'conflict'))
    state.refetch.mockResolvedValue({ isSuccess: false, data: undefined })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Local edits')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalled())
    state.data.value = { items: [primary, { ...secondary, displayName: 'Changed', updatedAt: '2026-09-14T05:00:00Z' }] }
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Local edits')
  })

  it('keeps another domain conflict pending when an unrelated save updates the cache', async () => {
    const latestA = { ...secondary, displayName: 'Remote A', updatedAt: '2026-09-14T02:00:00Z' }
    const latestB = { ...primary, displayName: 'Saved B', updatedAt: '2026-09-14T01:00:00Z' }
    vi.mocked(deleteDomain).mockRejectedValueOnce(new ApiClientError(210103, 'conflict')).mockResolvedValueOnce(undefined)
    vi.mocked(updateDomain).mockResolvedValue({ domain: latestB })
    state.refetch.mockRejectedValueOnce(new Error('offline'))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDelete' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: 'domains.confirmDelete' })).toHaveProperty('disabled', false))
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), latestB.displayName)
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Saved B/ })).toBeTruthy())
    state.data.value = { items: [latestB, latestA] }
    await nextTick()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDelete' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenLastCalledWith({ id: secondary.id, expectedUpdatedAt: latestA.updatedAt }))
  })

  it('closes a delete confirmation when a conflict refresh finds its target removed', async () => {
    vi.mocked(deleteDomain).mockRejectedValue(new ApiClientError(210103, 'conflict'))
    state.refetch.mockImplementation(async () => {
      state.data.value = { items: [primary] }
      return { isSuccess: true, data: state.data.value }
    })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDelete' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', { name: /Secondary/ })).toBeNull()
  })

  it('keeps the active draft while a normal refresh updates an unrelated domain', async () => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Local')
    state.data.value = { items: [{ ...primary, displayName: 'New primary' }, { ...secondary, updatedAt: '2026-09-14T02:00:00Z' }] }
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Local')
  })

  it('offers a retry after a non-conflict write failure without replacing the draft', async () => {
    vi.mocked(updateDomain).mockRejectedValue(new Error('unavailable'))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Retry this')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(screen.getByText('domains.saveFailed')).toBeTruthy())
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Retry this')
    expect(state.refetch).not.toHaveBeenCalled()
  })

  it('refreshes an unedited conflicted domain and the revision of a pending delete', async () => {
    const latest = { ...secondary, displayName: 'Changed remotely', updatedAt: '2026-09-14T03:00:00Z' }
    vi.mocked(deleteDomain).mockRejectedValueOnce(new ApiClientError(210103, 'conflict')).mockResolvedValueOnce(undefined)
    state.refetch.mockImplementation(async () => {
      state.data.value = { items: [primary, latest] }
      return { isSuccess: true, data: state.data.value }
    })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDelete' }))
    await waitFor(() => expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Changed remotely'))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDelete' }))
    await waitFor(() => expect(deleteDomain).toHaveBeenLastCalledWith({ id: secondary.id, expectedUpdatedAt: latest.updatedAt }))
  })

  it('retains pending conflict context until a later revision actually arrives', async () => {
    vi.mocked(updateDomain).mockRejectedValueOnce(new ApiClientError(210103, 'conflict'))
    state.refetch.mockResolvedValue({ isSuccess: true, data: { items: [primary, secondary] } })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(state.refetch).toHaveBeenCalled())
    state.data.value = { items: [primary, { ...secondary, displayName: 'Latest', updatedAt: '2026-09-14T04:00:00Z' }] }
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Latest')
  })

  it('does not surface a failed save after switching selection', async () => {
    let reject!: (reason: unknown) => void
    vi.mocked(updateDomain).mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    reject(new Error('unavailable'))
    await nextTick()
    expect(screen.queryByText('domains.saveFailed')).toBeNull()
  })

  it('cancels a delete confirmation without running the mutation', async () => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(deleteDomain).not.toHaveBeenCalled()
  })

  it('closes the delete dialog through its model update without a deletion', async () => {
    render(AdminDomainsPage, { global: { stubs: {
      ...componentStubs,
      VDialog: { props: ['modelValue'], emits: ['update:modelValue'], template: '<div v-if="modelValue" role="dialog"><button aria-label="close-dialog" @click="$emit(\'update:modelValue\', false)" /><slot /></div>' },
    } } })
    await fireEvent.click(screen.getByRole('button', { name: /Secondary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.delete' }))
    await fireEvent.click(screen.getByRole('button', { name: 'close-dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps a creation draft during a background list refresh', async () => {
    mount()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Draft')
    state.data.value = { items: [primary, { ...secondary, displayName: 'Remote' }] }
    await nextTick()
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('value', 'Draft')
  })

  it('can reconcile a successful write after the previous cached list was evicted', async () => {
    vi.mocked(createDomain).mockResolvedValue({ domain: secondary })
    mount()
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    await fireEvent.update(screen.getByLabelText('domains.host'), secondary.host)
    await fireEvent.update(screen.getByLabelText('domains.displayName'), secondary.displayName)
    state.data.value = undefined
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await waitFor(() => expect(state.data.value?.items).toEqual([secondary]))
  })
})
