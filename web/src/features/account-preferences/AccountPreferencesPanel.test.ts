import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { getAccountPreferences, updateAccountPreferences, type AccountPreferences } from '@/entities/user/preferences'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AccountPreferencesPanel from './AccountPreferencesPanel.vue'
import { messages } from '@/app/i18n'

vi.mock('vuetify', () => ({ useTheme: () => ({ global: { name: { value: 'moeurlLight' } } }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/entities/user/preferences', async (original) => ({ ...await original<typeof import('@/entities/user/preferences')>(), getAccountPreferences: vi.fn(), updateAccountPreferences: vi.fn() }))
const clients: QueryClient[] = []
const original: AccountPreferences = { language: 'zh-CN', theme: null, updatedAt: '2026-10-16T01:02:03.123456Z' }
const saved: AccountPreferences = { language: 'en', theme: 'dark', updatedAt: '2026-10-16T01:02:04Z' }
/** Mounts the real editor with isolated authenticated cache state. */
function mount(id = 'A', locale = 'test') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id, username: id, group: 'user' } })
  const i18n = createI18n({ legacy: false, locale, messages: locale === 'test' ? {} : messages, missingWarn: false, fallbackWarn: false })
  return { ...render(AccountPreferencesPanel, { props: { userId: id, active: true }, global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } }), client, i18n }
}
/** Changes the two visible account fields without changing the effective UI. */
async function edit(language = 'en', theme = 'dark') {
  await fireEvent.update(screen.getByLabelText('accountPreferences.language'), language)
  await fireEvent.update(screen.getByLabelText('accountPreferences.theme'), theme)
}
/** Submits via the form to cover keyboard as well as button submission. */
async function submit() { await fireEvent.submit(screen.getByTestId('account-preferences-form')) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccountPreferences).mockReset().mockResolvedValue(original)
  vi.mocked(updateAccountPreferences).mockReset().mockResolvedValue(saved)
})
afterEach(() => { cleanup(); for (const client of clients.splice(0)) { revokeAccountIdentity(client); client.clear() } })
describe('AccountPreferencesPanel', () => {
  it.each([['zh-CN', '账号主题', '跟随系统', '保存到账号'], ['en', 'Account theme', 'System default', 'Save to account']])('renders localized account choices in %s', async (locale, themeLabel, systemLabel, saveLabel) => {
    vi.mocked(getAccountPreferences).mockResolvedValue({ ...original, language: locale as AccountPreferences['language'] })
    mount('A', locale)
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByLabelText(themeLabel!)).toBeTruthy()
    expect(screen.getByRole('option', { name: systemLabel! })).toBeTruthy()
    expect(screen.getByRole('button', { name: saveLabel! })).toBeTruthy()
  })
  it('rejects a malformed account choice without sending a write', async () => {
    mount()
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await edit('invalid', 'dark')
    await submit()
    expect(updateAccountPreferences).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('accountPreferences.invalidRequest')
  })
  it('disables saving until the authoritative read succeeds and saves explicitly once', async () => {
    const loading = createDeferred<AccountPreferences>()
    const saving = createDeferred<AccountPreferences>()
    vi.mocked(getAccountPreferences).mockReturnValue(loading.promise)
    vi.mocked(updateAccountPreferences).mockReturnValue(saving.promise)
    const { client, i18n } = mount()
    expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(true)
    await submit()
    expect(updateAccountPreferences).not.toHaveBeenCalled()
    loading.resolve(original)
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await edit()
    expect(updateAccountPreferences).not.toHaveBeenCalled()
    expect(i18n.global.locale.value).toBe('zh-CN')
    await submit()
    await submit()
    expect(updateAccountPreferences).toHaveBeenCalledTimes(1)
    expect(updateAccountPreferences).toHaveBeenCalledWith({ language: 'en', theme: 'dark', expectedUpdatedAt: original.updatedAt })
    expect((screen.getByLabelText('accountPreferences.theme') as HTMLSelectElement).disabled).toBe(true)
    saving.resolve(saved)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('accountPreferences.saved'))
    expect(i18n.global.locale.value).toBe('en')
    expect(client.getQueriesData({ queryKey: ['user', 'preferences', 'A'] })[0]?.[1]).toEqual(saved)
    await edit('browser', 'browser')
    vi.mocked(updateAccountPreferences).mockResolvedValue({ language: null, theme: null, updatedAt: saved.updatedAt })
    await submit()
    await waitFor(() => expect(updateAccountPreferences).toHaveBeenLastCalledWith({ language: null, theme: null, expectedUpdatedAt: saved.updatedAt }))
  })
  it('keeps a persistent load error, forbids save and retries the read', async () => {
    vi.mocked(getAccountPreferences).mockRejectedValueOnce(new Error('private'))
    mount()
    await screen.findByText('accountPreferences.loadFailed')
    expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(true)
    await submit()
    expect(updateAccountPreferences).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByTestId('account-preferences-retry'))
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    expect(getAccountPreferences).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('private')).toBeNull()
  })
  it.each([[new Error('private'), 'saveFailed'], [new ApiClientError(120001, 'private'), 'unavailable'], [new ApiClientError(500, 'private'), 'saveFailed']])('preserves dirty values and the original version through background refetch and normal failure %#', async (error, message) => {
    const { client } = mount()
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await edit()
    vi.mocked(getAccountPreferences).mockResolvedValue({ ...saved, language: 'zh-CN', theme: 'light' })
    await client.invalidateQueries({ queryKey: ['user', 'preferences', 'A'] })
    expect((screen.getByLabelText('accountPreferences.theme') as HTMLSelectElement).value).toBe('dark')
    vi.mocked(updateAccountPreferences).mockRejectedValueOnce(error)
    await submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`accountPreferences.${message}`))
    expect(updateAccountPreferences).toHaveBeenCalledWith({ language: 'en', theme: 'dark', expectedUpdatedAt: original.updatedAt })
    expect((screen.getByLabelText('accountPreferences.theme') as HTMLSelectElement).value).toBe('dark')
  })
  it('keeps the editing snapshot through a failed background read and a non-discarding retry', async () => {
    const { client } = mount()
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await edit()
    vi.mocked(getAccountPreferences).mockRejectedValueOnce(new Error('offline'))
    await client.invalidateQueries({ queryKey: ['user', 'preferences', 'A'] })
    await screen.findByText('accountPreferences.loadFailed')
    const retrying = createDeferred<AccountPreferences>()
    vi.mocked(getAccountPreferences).mockReturnValue(retrying.promise)
    const retry = screen.getByTestId('account-preferences-retry')
    await Promise.all([fireEvent.click(retry), fireEvent.click(retry)])
    expect(getAccountPreferences).toHaveBeenCalledTimes(3)
    retrying.resolve({ ...saved, theme: 'light' })
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByLabelText('accountPreferences.theme') as HTMLSelectElement).value).toBe('dark')
    await submit()
    await waitFor(() => expect(updateAccountPreferences).toHaveBeenCalledWith({ language: 'en', theme: 'dark', expectedUpdatedAt: original.updatedAt }))
  })
  it('does not adopt a late reload after the account panel becomes inactive', async () => {
    vi.mocked(getAccountPreferences).mockRejectedValueOnce(new Error('offline'))
    const view = mount()
    await screen.findByTestId('account-preferences-retry')
    const retrying = createDeferred<AccountPreferences>()
    vi.mocked(getAccountPreferences).mockReturnValueOnce(retrying.promise)
    await fireEvent.click(screen.getByTestId('account-preferences-retry'))
    await view.rerender({ active: false })
    retrying.resolve(saved)
    await waitFor(() => expect(view.client.getQueriesData({ queryKey: ['user', 'preferences', 'A'] })[0]?.[1]).toEqual(saved))
    expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('accountPreferences.language') as HTMLSelectElement).value).toBe('browser')
  })
  it('retains conflict and draft after failed reload, then adopts the latest version only on reload success', async () => {
    vi.mocked(updateAccountPreferences).mockRejectedValueOnce(new ApiClientError(300104, 'private'))
    mount()
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await edit()
    await submit()
    await screen.findByTestId('account-preferences-reload')
    expect(toast.error).toHaveBeenCalledWith('accountPreferences.conflict')
    vi.mocked(getAccountPreferences).mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByTestId('account-preferences-reload'))
    await screen.findByText('accountPreferences.loadFailed')
    expect(screen.getByTestId('account-preferences-reload')).toBeTruthy()
    expect((screen.getByLabelText('accountPreferences.theme') as HTMLSelectElement).value).toBe('dark')
    vi.mocked(getAccountPreferences).mockResolvedValue({ ...saved, theme: 'light' })
    await fireEvent.click(screen.getByTestId('account-preferences-reload'))
    await waitFor(() => expect(screen.queryByTestId('account-preferences-reload')).toBeNull())
    expect((screen.getByLabelText('accountPreferences.theme') as HTMLSelectElement).value).toBe('light')
    await submit()
    await waitFor(() => expect(updateAccountPreferences).toHaveBeenLastCalledWith({ language: 'en', theme: 'light', expectedUpdatedAt: saved.updatedAt }))
  })
  it.each(['unmount', 'inactive', 'switch', 'relogin'])('ignores a pending successful write after %s', async (transition) => {
    const saving = createDeferred<AccountPreferences>()
    vi.mocked(updateAccountPreferences).mockReturnValue(saving.promise)
    const view = mount()
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await edit()
    await submit()
    if (transition === 'unmount') view.unmount()
    if (transition === 'inactive') await view.rerender({ active: false })
    if (transition === 'switch') view.client.setQueryData(['auth', 'me'], { user: { id: 'B', group: 'user' } })
    if (transition === 'relogin') {
      revokeAccountIdentity(view.client)
      view.client.setQueryData(['auth', 'me'], { user: { id: 'A', group: 'user' } })
    }
    saving.resolve(saved)
    await saving.promise
    await waitFor(() => expect(toast.success).not.toHaveBeenCalled())
    expect(view.client.getQueriesData({ queryKey: ['user', 'preferences'] }).some(([, value]) => (value as AccountPreferences)?.updatedAt === saved.updatedAt)).toBe(false)
  })
  it('ignores a late failed write after revocation and disables another submission', async () => {
    const saving = createDeferred<AccountPreferences>()
    vi.mocked(updateAccountPreferences).mockReturnValue(saving.promise)
    const { client } = mount()
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    await submit()
    revokeAccountIdentity(client)
    saving.reject(new Error('private'))
    await saving.promise.catch(() => undefined)
    expect(toast.error).not.toHaveBeenCalled()
    await submit()
    expect(updateAccountPreferences).toHaveBeenCalledTimes(1)
  })
})
