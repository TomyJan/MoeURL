import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from '@/pages/ProfilePage.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { toast } from 'vue-sonner'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const id = '22222222-2222-4222-8222-222222222222'
const version = '2026-10-27T00:00:00.123456Z'
const clients: QueryClient[] = []
/** Exercises Profile wiring and the real independent editor over a controlled HTTP boundary. */
function mount(options: { unavailable?: boolean; domainError?: boolean; read?: () => Promise<unknown>; save?: () => Promise<Response> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  const user = { id: 'A', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] }
  client.setQueryData(['auth', 'me'], { user })
  const bodies: unknown[] = []
  let preference = { domainId: id as string | null, updatedAt: version }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    let data: unknown
    if (url === '/api/v1/auth/me') data = { user }
    else if (url === '/api/v1/domain/available') {
      if (options.domainError) throw new Error('offline')
      data = { items: options.unavailable ? [] : [{ id, host: 'personal.example', displayName: 'Personal', isDefault: false }] }
    } else if (url === '/api/v1/user/domain-preference') data = { preference: options.read ? await options.read() : preference }
    else if (url === '/api/v1/user/domain-preference/update') {
      bodies.push(JSON.parse(init.body as string))
      if (options.save) return options.save()
      preference = { domainId: (bodies.at(-1) as { domainId: string | null }).domainId, updatedAt: '2026-10-27T00:00:01.123456Z' }
      data = { preference }
    } else throw new Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  const view = render(ProfilePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, PasswordChangePanel: true, AccountPreferencesPanel: true, PreferenceSwitcher: true } } })
  return { ...view, client, bodies, user, options }
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('independent domain preference editor', () => {
  it('clears only this preference with its exact version and synchronizes the cache', async () => {
    const { bodies, client } = mount()
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    await fireEvent.update(select, '')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toEqual([{ domainId: null, expectedUpdatedAt: version }]))
    await waitFor(() => expect(client.getQueriesData({ queryKey: ['user', 'domain-preference', 'A'] })[0]?.[1]).toEqual({ domainId: null, updatedAt: '2026-10-27T00:00:01.123456Z' }))
    expect(client.getQueriesData({ queryKey: ['user', 'preferences'] })).toEqual([])
  })
  it.each([{ unavailable: true }, { domainError: true }])('allows clearing without available domains %j', async (options) => {
    const { bodies } = mount(options)
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((screen.getByTestId('domain-preference-save') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.update(select, '')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toEqual([{ domainId: null, expectedUpdatedAt: version }]))
    expect(screen.queryByText('Personal (personal.example)')).toBeNull()
  })
  it('keeps a conflict draft until explicit successful reload and never retries the write', async () => {
    const { bodies } = mount({ save: async () => new Response(JSON.stringify({ code: 300104, message: '', data: null, meta: {} })) })
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    await fireEvent.update(select, '')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await screen.findByText('domainPreference.conflict')
    expect((select as HTMLSelectElement).value).toBe('')
    expect(bodies).toHaveLength(1)
    await fireEvent.click(screen.getByText('domainPreference.reload'))
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    expect(bodies).toHaveLength(1)
  })
  it('ignores a late save after A to B to A without cache or Toast contamination', async () => {
    const pending = createDeferred<Response>()
    const success = vi.spyOn(toast, 'success')
    const { bodies, client, user } = mount({ save: () => pending.promise })
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    await fireEvent.update(select, '')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    client.setQueryData(['auth', 'me'], { user: { ...user, id: 'B' } })
    revokeAccountIdentity(client)
    client.setQueryData(['auth', 'me'], { user })
    pending.resolve(new Response(JSON.stringify({ code: 0, message: '', meta: {}, data: { preference: { domainId: null, updatedAt: '2026-10-27T00:00:02Z' } } })))
    await waitFor(() => expect((screen.getByTestId('domain-preference-save') as HTMLButtonElement).disabled).toBe(false))
    expect(success).not.toHaveBeenCalled()
    expect(client.getQueriesData({ queryKey: ['user', 'domain-preference', 'A'] })[0]?.[1]).toEqual({ domainId: id, updatedAt: version })
  })
  it('loads a previously unset value and saves an explicit current authorized domain', async () => {
    const { bodies } = mount({ read: async () => ({ domainId: null, updatedAt: null }) })
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false))
    await fireEvent.update(select, id)
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toEqual([{ domainId: id, expectedUpdatedAt: null }]))
  })
  it('keeps a dirty draft over background reads and recovers a read failure explicitly', async () => {
    const { client, options, bodies } = mount({ read: async () => { throw new Error('offline') } })
    await screen.findByText('domainPreference.loadFailed')
    expect((screen.getByTestId('domain-preference-save') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    options.read = async () => ({ domainId: id, updatedAt: version })
    await fireEvent.click(screen.getByText('domainPreference.retry'))
    const select = screen.getByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    await fireEvent.update(select, '')
    options.read = async () => ({ domainId: id, updatedAt: '2026-10-27T00:00:03Z' })
    await client.invalidateQueries({ queryKey: ['user', 'domain-preference'] })
    expect((select as HTMLSelectElement).value).toBe('')
    options.read = async () => { throw new Error('offline again') }
    await client.invalidateQueries({ queryKey: ['user', 'domain-preference'] })
    await screen.findByText('domainPreference.loadFailed')
    options.read = async () => ({ domainId: id, updatedAt: '2026-10-27T00:00:04Z' })
    await fireEvent.click(screen.getByText('domainPreference.retry'))
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false))
    expect((select as HTMLSelectElement).value).toBe('')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toEqual([{ domainId: null, expectedUpdatedAt: version }]))
  })
  it('retains a conflict draft and original snapshot when reload fails', async () => {
    const { bodies, options } = mount({ save: async () => new Response(JSON.stringify({ code: 300104, message: '', data: null, meta: {} })) })
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    await fireEvent.update(select, '')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await screen.findByText('domainPreference.conflict')
    options.read = async () => { throw new Error('offline') }
    await fireEvent.click(screen.getByText('domainPreference.reload'))
    await screen.findByText('domainPreference.loadFailed')
    expect((select as HTMLSelectElement).value).toBe('')
    expect(bodies).toHaveLength(1)
  })
  it.each([120001, 900000])('preserves the draft on save error %s and permits explicit retry', async (code) => {
    const { bodies, options } = mount({ save: async () => new Response(JSON.stringify({ code, message: '', data: null, meta: {} })) })
    const select = await screen.findByLabelText('domainPreference.domain')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(id))
    await fireEvent.update(select, '')
    const errorToast = vi.spyOn(toast, 'error')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(code === 120001 ? 'domainPreference.unavailable' : 'domainPreference.saveFailed'))
    expect((select as HTMLSelectElement).value).toBe('')
    options.save = undefined
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual({ domainId: null, expectedUpdatedAt: version })
  })
  it('recovers available domains without ever including an unavailable saved domain', async () => {
    const { options, bodies } = mount({ domainError: true })
    await screen.findByText('shortLinkCreate.domainLoadFailed')
    options.domainError = false
    await fireEvent.click(screen.getByText('shortLinkCreate.retryDomains'))
    await screen.findByText('Personal (personal.example)')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toEqual([{ domainId: id, expectedUpdatedAt: version }]))
  })
  it('rejects saving an unavailable original domain until the user chooses a safe value', async () => {
    const { bodies } = mount({ unavailable: true })
    await screen.findByText('domainPreference.unavailable')
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await screen.findByText('domainPreference.invalid')
    expect(bodies).toEqual([])
  })
  it('does not publish a late failed save after the editor unmounts', async () => {
    const pending = createDeferred<Response>()
    const errorToast = vi.spyOn(toast, 'error')
    const { bodies, unmount } = mount({ save: () => pending.promise })
    await waitFor(() => expect((screen.getByTestId('domain-preference-save') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.submit(screen.getByTestId('domain-preference-form'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    unmount()
    pending.resolve(new Response(JSON.stringify({ code: 300104, message: '', data: null, meta: {} })))
    await pending.promise
    await waitFor(() => expect(errorToast).not.toHaveBeenCalled())
  })
  it('blocks repeated reload events and discards a read completed after identity revocation', async () => {
    const { options, client, user } = mount({ read: async () => { throw new Error('offline') } })
    await screen.findByText('domainPreference.loadFailed')
    const pending = createDeferred<unknown>()
    const read = vi.fn(() => pending.promise)
    options.read = read
    const retry = screen.getByText('domainPreference.retry')
    const firstClick = fireEvent.click(retry)
    const secondClick = fireEvent.click(retry)
    await Promise.all([firstClick, secondClick])
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await fireEvent.click(retry)
    expect(read).toHaveBeenCalledTimes(1)
    revokeAccountIdentity(client)
    options.read = async () => ({ domainId: null, updatedAt: null })
    client.setQueryData(['auth', 'me'], { user })
    pending.resolve({ domainId: id, updatedAt: version })
    await waitFor(() => expect((screen.getByTestId('domain-preference-save') as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByLabelText('domainPreference.domain') as HTMLSelectElement).value).toBe('')
    expect(client.getQueriesData({ queryKey: ['user', 'domain-preference', 'A'] }).map((entry) => entry[1])).toEqual([{ domainId: null, updatedAt: null }])
  })
})
