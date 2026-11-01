import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { toast } from 'vue-sonner'
import ProfilePage from '@/pages/ProfilePage.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } }) }))
const version = '2026-11-01T00:00:00.123456Z'
const clients: QueryClient[] = []
interface Preference { timeZone: string | null; updatedAt: string | null }
interface Options { initial?: Preference; read?: (id: string) => Promise<Preference>; save?: () => Promise<Response>; me?: () => Promise<Response> }
const ok = (preference: Preference) => new Response(JSON.stringify({ code: 0, message: '', data: { preference }, meta: {} }))
const failed = (code: number) => new Response(JSON.stringify({ code, message: '', data: null, meta: {} }))
/** Flushes already-settled HTTP and Vue promise work, without assuming an elapsed delay. */
async function settleRequests() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }

/** Mounts the production profile with real query identity and a strict HTTP boundary. */
function mount(options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  let user = { id: '00000000-0000-0000-0000-000000000701', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] as string[] }
  let preference: Preference = options.initial ?? { timeZone: 'UTC', updatedAt: version }
  const bodies: { timeZone: string | null; expectedUpdatedAt: string | null }[] = []
  client.setQueryData(['auth', 'me'], { user })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    let data: unknown
    if (url === '/api/v1/auth/me') {
      if (options.me) return options.me()
      data = { user }
    }
    else if (url === '/api/v1/user/time-zone-preference') data = { preference: options.read ? await options.read(user.id) : preference }
    else if (url === '/api/v1/user/time-zone-preference/update') {
      const body = JSON.parse(init.body as string) as typeof bodies[number]
      bodies.push(body)
      if (options.save) return options.save()
      if (body.expectedUpdatedAt !== preference.updatedAt) return failed(300104)
      preference = { timeZone: body.timeZone, updatedAt: '2026-11-01T00:00:01.123456Z' }
      return ok(preference)
    }
    else throw new Error('Unexpected request ' + url)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  const view = render(ProfilePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, RedirectPreferencePanel: true, PasswordChangePanel: true, AccountPreferencesPanel: true, DomainPreferencePanel: true, PreferenceSwitcher: true } } })
  return { ...view, client, bodies, options,
    setPreference(value: Preference) { preference = value },
    setUser(id: string) { user = { ...user, id }; client.setQueryData(['auth', 'me'], { user }) },
  }
}

async function ready() {
  await waitFor(() => expect((screen.getByLabelText('timeZonePreference.zone') as HTMLSelectElement).disabled).toBe(false))
  return screen.getByLabelText('timeZonePreference.zone') as HTMLSelectElement
}
const submit = () => fireEvent.submit(screen.getByTestId('time-zone-preference-form'))

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('account time-zone preference', () => {
  it.each([false, true])('restores same-user editing after authentication recovery without replacing its cached preference, dirty=%s', async dirty => {
    const view = mount()
    const select = await ready()
    if (dirty) await fireEvent.update(select, 'Asia/Tokyo')
    const cached = view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] })[0]?.[1]
    view.options.me = async () => failed(900000)
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    await waitFor(() => expect(view.client.getQueryState(['auth', 'me'])?.status).toBe('error'))
    expect(view.client.getQueryData(['auth', 'me'])).toMatchObject({ user: { id: '00000000-0000-0000-0000-000000000701' } })
    expect(screen.queryByTestId('time-zone-preference-panel')).toBeNull()
    expect(view.bodies).toEqual([])
    view.options.me = undefined
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    const recovered = await ready()
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] })[0]?.[1]).toBe(cached)
    expect(recovered.value).toBe(dirty ? 'Asia/Tokyo' : 'UTC')
    if (!dirty) await fireEvent.update(recovered, 'Europe/Paris')
    await submit()
    await waitFor(() => expect(view.bodies).toEqual([{ timeZone: dirty ? 'Asia/Tokyo' : 'Europe/Paris', expectedUpdatedAt: version }]))
  })
  it('adopts an initial read that finishes while authentication is temporarily unavailable', async () => {
    const loading = createDeferred<Preference>()
    const view = mount({ read: () => loading.promise })
    await screen.findByTestId('time-zone-preference-form')
    view.options.me = async () => failed(900000)
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    await waitFor(() => expect(screen.queryByTestId('time-zone-preference-panel')).toBeNull())
    loading.resolve({ timeZone: 'Europe/Paris', updatedAt: version })
    await settleRequests()
    view.options.me = undefined
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    expect((await ready()).value).toBe('Europe/Paris')
    expect(view.bodies).toEqual([])
  })
  it.each([true, false])('releases an interrupted save without applying its hidden result or retrying, success=%s', async success => {
    const saving = createDeferred<Response>()
    const okToast = vi.spyOn(toast, 'success')
    const badToast = vi.spyOn(toast, 'error')
    const view = mount({ save: () => saving.promise })
    await fireEvent.update(await ready(), 'Asia/Tokyo')
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(1))
    view.options.me = async () => failed(900000)
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    await waitFor(() => expect(screen.queryByTestId('time-zone-preference-panel')).toBeNull())
    saving.resolve(success ? ok({ timeZone: 'Asia/Tokyo', updatedAt: '2026-11-01T00:00:01Z' }) : failed(300104))
    await settleRequests()
    expect(okToast).not.toHaveBeenCalled()
    expect(badToast).not.toHaveBeenCalled()
    view.options.me = undefined
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    expect((await ready()).value).toBe('Asia/Tokyo')
    await waitFor(() => expect((screen.getByTestId('time-zone-preference-save') as HTMLButtonElement).disabled).toBe(false))
    expect(view.bodies).toHaveLength(1)
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] })[0]?.[1]).toMatchObject({ preference: { timeZone: 'UTC', updatedAt: version } })
    view.options.save = async () => failed(300104)
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    expect(view.bodies[1]).toEqual({ timeZone: 'Asia/Tokyo', expectedUpdatedAt: version })
  })
  it('releases an interrupted conflict reload while preserving the draft and requiring another explicit reload', async () => {
    const loading = createDeferred<Preference>()
    const view = mount({ save: async () => failed(300104) })
    await fireEvent.update(await ready(), 'Asia/Tokyo')
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    view.options.read = () => loading.promise
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    view.options.me = async () => failed(900000)
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    await waitFor(() => expect(screen.queryByTestId('time-zone-preference-panel')).toBeNull())
    loading.resolve({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await settleRequests()
    view.options.me = undefined
    await view.client.refetchQueries({ queryKey: ['auth', 'me'] })
    expect((await ready()).value).toBe('Asia/Tokyo')
    expect(screen.getByText('timeZonePreference.conflict')).not.toBeNull()
    const reload = screen.getByText('timeZonePreference.reload')
    await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(false))
    view.options.read = async () => ({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await fireEvent.click(reload)
    await waitFor(() => expect((screen.getByLabelText('timeZonePreference.zone') as HTMLSelectElement).value).toBe('Europe/London'))
    expect(view.bodies).toHaveLength(1)
  })
  it('shows browser fallback without silently changing the saved selection', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { throw new RangeError('unsupported zone') })
    const view = mount()
    await screen.findByText('timeZonePreference.unsupported')
    expect((await ready()).value).toBe('UTC')
    expect(view.bodies).toEqual([])
  })
  it('blocks premature and duplicate submission, and rejects an invalid selector value locally', async () => {
    const loading = createDeferred<Preference>()
    const saving = createDeferred<Response>()
    const view = mount({ read: () => loading.promise, save: () => saving.promise })
    await screen.findByTestId('time-zone-preference-form')
    await submit()
    expect(view.bodies).toEqual([])
    loading.resolve({ timeZone: 'UTC', updatedAt: version })
    const select = await ready()
    select.add(new Option('Untrusted zone', 'Europe/Berlin'))
    await fireEvent.update(select, 'Europe/Berlin')
    await submit()
    await screen.findByText('timeZonePreference.invalid')
    expect(view.bodies).toEqual([])
    await fireEvent.update(select, 'Europe/Paris')
    await submit()
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(1))
    saving.resolve(ok({ timeZone: 'Europe/Paris', updatedAt: '2026-11-01T00:00:01Z' }))
    await settleRequests()
  })
  it('does not discard a draft edited during an explicit read-error retry', async () => {
    const view = mount()
    const select = await ready()
    await fireEvent.update(select, 'Asia/Tokyo')
    view.options.read = async () => { throw new Error('refresh failed') }
    await view.client.invalidateQueries({ queryKey: ['user', 'time-zone-preference'] })
    await screen.findByText('timeZonePreference.loadFailed')
    const pending = createDeferred<Preference>()
    view.options.read = () => pending.promise
    await fireEvent.click(screen.getByText('timeZonePreference.retry'))
    await fireEvent.click(screen.getByText('timeZonePreference.retry'))
    await fireEvent.update(select, 'Europe/Paris')
    pending.resolve({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await settleRequests()
    expect(select.value).toBe('Europe/Paris')
    view.options.save = async () => failed(300104)
    await submit()
    await waitFor(() => expect(view.bodies[0]?.expectedUpdatedAt).toBe(version))
  })
  it.each(['account', 'unmount'] as const)('ignores a late explicit reload after %s invalidation', async transition => {
    const view = mount({ save: async () => failed(300104) })
    await ready()
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    const pending = createDeferred<Preference>()
    view.options.read = () => pending.promise
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    if (transition === 'account') {
      view.options.read = undefined
      view.setUser('00000000-0000-0000-0000-000000000702')
      await ready()
    } else view.unmount()
    pending.resolve({ timeZone: 'Europe/Paris', updatedAt: '2026-11-01T00:00:09Z' })
    await settleRequests()
    if (transition === 'account') expect((await ready()).value).toBe('UTC')
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] }).some(([, value]) => JSON.stringify(value).includes('Europe/Paris'))).toBe(false)
  })
  it('exposes the independent time-zone selector on the real authenticated profile', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'page.profile' })).not.toBeNull()
    const select = await screen.findByLabelText('timeZonePreference.zone')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('UTC'))
  })
  it('clears only this preference using the untouched full revision', async () => {
    const { bodies, client } = mount()
    const select = await ready()
    await fireEvent.update(select, '')
    await submit()
    await waitFor(() => expect(bodies).toEqual([{ timeZone: null, expectedUpdatedAt: version }]))
    await waitFor(() => expect(client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] })[0]?.[1]).toMatchObject({ preference: { timeZone: null, updatedAt: '2026-11-01T00:00:01.123456Z' } }))
    expect(client.getQueriesData({ queryKey: ['user', 'preferences'] })).toEqual([])
    expect(client.getQueriesData({ queryKey: ['user', 'domain-preference'] })).toEqual([])
  })
  it('loads an unset document and creates a preference at the null revision', async () => {
    const view = mount({ initial: { timeZone: null, updatedAt: null } })
    const select = await ready()
    await waitFor(() => expect(select.value).toBe(''))
    await fireEvent.update(select, 'Asia/Tokyo')
    await submit()
    await waitFor(() => expect(view.bodies).toEqual([{ timeZone: 'Asia/Tokyo', expectedUpdatedAt: null }]))
  })
  it('keeps a dirty draft and its original revision over a background server change', async () => {
    const view = mount()
    const select = await ready()
    await fireEvent.update(select, 'Asia/Tokyo')
    view.setPreference({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await view.client.invalidateQueries({ queryKey: ['user', 'time-zone-preference'] })
    expect(select.value).toBe('Asia/Tokyo')
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    expect(view.bodies).toEqual([{ timeZone: 'Asia/Tokyo', expectedUpdatedAt: version }])
  })
  it('does not let a late background read overwrite an edit made while it was pending', async () => {
    const view = mount()
    const select = await ready()
    const pending = createDeferred<Preference>()
    view.options.read = () => pending.promise
    const refresh = view.client.invalidateQueries({ queryKey: ['user', 'time-zone-preference'] })
    await fireEvent.update(select, 'Europe/Paris')
    pending.resolve({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await refresh
    expect(select.value).toBe('Europe/Paris')
  })
  it('preserves a newer edit during save but advances the authoritative revision for the next save', async () => {
    const pending = createDeferred<Response>()
    const view = mount({ save: () => pending.promise })
    const select = await ready()
    await fireEvent.update(select, 'Asia/Tokyo')
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(1))
    await fireEvent.update(select, 'Europe/Paris')
    const saved = { timeZone: 'Asia/Tokyo', updatedAt: '2026-11-01T00:00:01.123456Z' }
    view.setPreference(saved)
    pending.resolve(ok(saved))
    await settleRequests()
    expect(select.value).toBe('Europe/Paris')
    view.options.save = undefined
    await submit()
    await waitFor(() => expect(view.bodies[1]).toEqual({ timeZone: 'Europe/Paris', expectedUpdatedAt: saved.updatedAt }))
  })
  it('keeps a conflict draft through failed reload and replaces it only after successful explicit reload', async () => {
    const view = mount({ save: async () => failed(300104) })
    const select = await ready()
    await fireEvent.update(select, 'Asia/Tokyo')
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    view.options.read = async () => { throw new Error('offline') }
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    await screen.findByText('timeZonePreference.loadFailed')
    expect(select.value).toBe('Asia/Tokyo')
    view.options.read = async () => ({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    await waitFor(() => expect(select.value).toBe('Europe/London'))
    expect(view.bodies).toHaveLength(1)
  })
  it('retains an edit made after an explicit conflict reload began', async () => {
    const view = mount({ save: async () => failed(300104) })
    const select = await ready()
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    const pending = createDeferred<Preference>()
    view.options.read = () => pending.promise
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    await fireEvent.update(select, 'Europe/Paris')
    pending.resolve({ timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02Z' })
    await settleRequests()
    expect(select.value).toBe('Europe/Paris')
    expect(view.bodies).toHaveLength(1)
  })
  it('advances the revision after a successful conflict reload while preserving an edit made during it', async () => {
    const view = mount({ save: async () => failed(300104) })
    const select = await ready()
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    const pending = createDeferred<Preference>()
    view.options.read = () => pending.promise
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    await fireEvent.update(select, 'Europe/Paris')
    const fresh = { timeZone: 'Europe/London', updatedAt: '2026-11-01T00:00:02.123456Z' }
    pending.resolve(fresh)
    view.setPreference(fresh)
    await settleRequests()
    view.options.save = undefined
    await submit()
    await waitFor(() => expect(view.bodies[1]).toEqual({ timeZone: 'Europe/Paris', expectedUpdatedAt: fresh.updatedAt }))
  })
  it('recovers a read error only on explicit retry', async () => {
    const view = mount({ read: async () => { throw new Error('offline') } })
    await screen.findByText('timeZonePreference.loadFailed')
    expect((screen.getByTestId('time-zone-preference-save') as HTMLButtonElement).disabled).toBe(true)
    view.options.read = undefined
    await fireEvent.click(screen.getByText('timeZonePreference.retry'))
    await waitFor(() => expect((screen.getByLabelText('timeZonePreference.zone') as HTMLSelectElement).value).toBe('UTC'))
    expect(view.bodies).toEqual([])
  })
  it.each([120001, 900000])('keeps the draft on save error %s without automatic retry', async code => {
    const view = mount({ save: async () => failed(code) })
    const select = await ready()
    await fireEvent.update(select, 'Europe/Paris')
    await submit()
    await settleRequests()
    expect(select.value).toBe('Europe/Paris')
    expect(view.bodies).toHaveLength(1)
    view.options.save = undefined
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(2))
  })
  it.each([true, false])('rejects a late save after A to B to guest to A, success=%s', async success => {
    const pending = createDeferred<Response>()
    const okToast = vi.spyOn(toast, 'success')
    const badToast = vi.spyOn(toast, 'error')
    const view = mount({ save: () => pending.promise })
    const select = await ready()
    await fireEvent.update(select, 'Europe/Paris')
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(1))
    view.setUser('00000000-0000-0000-0000-000000000702')
    await nextTick()
    void revokeAccountIdentity(view.client)
    view.setUser('00000000-0000-0000-0000-000000000701')
    await ready()
    pending.resolve(success ? ok({ timeZone: 'Europe/Paris', updatedAt: '2026-11-01T00:00:09Z' }) : failed(300104))
    await settleRequests()
    expect((screen.getByLabelText('timeZonePreference.zone') as HTMLSelectElement).value).toBe('UTC')
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference', '00000000-0000-0000-0000-000000000701'] }).map(([, value]) => value)).toEqual([expect.objectContaining({ preference: { timeZone: 'UTC', updatedAt: version } })])
    expect(okToast).not.toHaveBeenCalled()
    expect(badToast).not.toHaveBeenCalled()
  })
  it.each([true, false])('ignores save success and failure after unmount, success=%s', async success => {
    const pending = createDeferred<Response>()
    const okToast = vi.spyOn(toast, 'success')
    const badToast = vi.spyOn(toast, 'error')
    const view = mount({ save: () => pending.promise })
    await ready()
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(1))
    view.unmount()
    pending.resolve(success ? ok({ timeZone: 'Europe/Paris', updatedAt: '2026-11-01T00:00:09Z' }) : failed(300104))
    await settleRequests()
    expect(okToast).not.toHaveBeenCalled()
    expect(badToast).not.toHaveBeenCalled()
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] })[0]?.[1]).toMatchObject({ preference: { timeZone: 'UTC', updatedAt: version } })
  })
})
