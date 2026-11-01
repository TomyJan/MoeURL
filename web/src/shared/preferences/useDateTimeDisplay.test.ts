import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { provideDateTimeDisplay, useDateTimeDisplay } from './useDateTimeDisplay'
import { revokeAccountIdentity } from './useAccountPreferences'
import { createDeferred } from '@/test/deferred'
import type { TimeZonePreference } from '@/entities/time-zone-preference/api'

const locale = ref('en-US')
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale, t: (key: string) => key }) }))
type Preference = TimeZonePreference
interface Options { guest?: boolean; unconfirmed?: boolean; read?: (id: string) => Promise<Preference> }
const clients: QueryClient[] = []
const instant = '2026-01-01T00:30:00.123456789Z'
const saved = (timeZone: Preference['timeZone']): Preference => ({ timeZone, updatedAt: '2026-11-01T00:00:00.123456Z' })
const device = () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(instant))
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }

/** Exercises the actual observer, identity cache and HTTP parser together. */
function mount(options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  clients.push(client)
  let userId = options.guest ? '' : 'alice'
  const requests: string[] = []
  const authReady = ref(!options.unconfirmed)
  let observer!: ReturnType<typeof provideDateTimeDisplay>
  let display!: ReturnType<typeof useDateTimeDisplay>
  function setUser(id: string) {
    userId = id
    client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', nickname: '', group: id ? 'user' : 'guest', permissions: [] } })
  }
  setUser(userId)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== '/api/v1/user/time-zone-preference') throw new Error('Unexpected request ' + url)
    const id = userId
    requests.push(id)
    const preference = options.read ? await options.read(id) : saved(id === 'bob' ? 'Asia/Tokyo' : 'America/New_York')
    return new Response(JSON.stringify({ code: 0, message: '', data: { preference }, meta: {} }))
  }))
  const Consumer = {
    setup() {
      display = useDateTimeDisplay()
      return () => h('time', { datetime: instant, 'data-testid': 'display' }, display.format(instant) ?? '')
    },
  }
  const Provider = defineComponent({
    setup() { observer = provideDateTimeDisplay(authReady); return () => h(Consumer) },
  })
  const view = render(Provider, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client, authReady, observer, display, requests, options, setUser }
}

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); locale.value = 'en-US' })

describe('account-owned date and time display', () => {
  it('cannot publish an old write into a new login epoch', async () => {
    const view = mount()
    await waitFor(() => expect(view.display.timeZone.value).toBe('America/New_York'))
    const previous = view.observer.scope.value
    void revokeAccountIdentity(view.client)
    view.options.read = async () => saved('Asia/Tokyo')
    view.setUser('alice')
    await waitFor(() => expect(view.display.timeZone.value).toBe('Asia/Tokyo'))
    view.observer.publish(previous, saved('Europe/Paris'))
    expect(view.display.timeZone.value).toBe('Asia/Tokyo')
    expect(view.client.getQueryData(['user', 'time-zone-preference', 'alice', previous.epoch])).toBeUndefined()
  })
  it('keeps a standalone display component independent of QueryClient and HTTP', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const Consumer = { setup() { const display = useDateTimeDisplay(); return () => h('span', display.format(instant) ?? '') } }
    render(Consumer)
    expect(screen.getByText(device())).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('starts with the device, then formats the saved zone without mutating the protocol instant', async () => {
    const pending = createDeferred<Preference>()
    const view = mount({ read: () => pending.promise })
    expect(view.display.timeZone.value).toBeNull()
    expect(view.display.fallback.value).toBe('loading')
    pending.resolve(saved('America/New_York'))
    await waitFor(() => expect(screen.getByTestId('display').textContent).toBe('Dec 31, 2025, 19:30'))
    expect(screen.getByTestId('display').getAttribute('datetime')).toBe(instant)
    expect(view.display.fallback.value).toBeNull()
    expect(view.requests).toEqual(['alice'])
    view.authReady.value = false
    expect(view.display.timeZone.value).toBeNull()
    await nextTick()
    expect(screen.getByTestId('display').textContent).toBe(device())
  })
  it('does not read a guest preference and handles a saved device choice', async () => {
    const view = mount({ guest: true, read: async () => saved(null) })
    await settle()
    expect(view.requests).toEqual([])
    expect(view.display.fallback.value).toBe('device')
    view.setUser('alice')
    await waitFor(() => expect(view.requests).toEqual(['alice']))
    await waitFor(() => expect(view.observer.preference.value).toEqual(saved(null)))
    expect(view.display.timeZone.value).toBeNull()
    expect(view.display.fallback.value).toBe('device')
  })
  it('does not start private preference reads until the shared authentication is confirmed', async () => {
    const view = mount({ unconfirmed: true })
    await settle()
    expect(view.requests).toEqual([])
    expect(view.display.timeZone.value).toBeNull()
    view.authReady.value = true
    await waitFor(() => expect(view.display.timeZone.value).toBe('America/New_York'))
    expect(view.requests).toEqual(['alice'])
  })
  it('falls back after a failed refresh rather than continuing to display cached account time', async () => {
    const view = mount()
    await waitFor(() => expect(view.display.timeZone.value).toBe('America/New_York'))
    view.options.read = async () => { throw new Error('offline') }
    await view.client.invalidateQueries({ queryKey: ['user', 'time-zone-preference'] })
    await waitFor(() => expect(view.display.fallback.value).toBe('unavailable'))
    expect(view.display.timeZone.value).toBeNull()
    expect(view.observer.preference.value).toEqual(saved('America/New_York'))
    expect(screen.getByTestId('display').textContent).toBe(device())
  })
  it('reports an unsupported browser zone without changing the saved choice or writing it', async () => {
    const Original = Intl.DateTimeFormat
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
      if (options?.timeZone === 'America/New_York') throw new RangeError('unsupported zone')
      return new Original(locales, options)
    })
    const view = mount()
    await waitFor(() => expect(view.display.fallback.value).toBe('unsupported'))
    expect(view.display.timeZone.value).toBeNull()
    expect(view.observer.preference.value).toEqual(saved('America/New_York'))
    expect(screen.getByTestId('display').textContent).toBe(device())
    expect(view.requests).toEqual(['alice'])
  })
  it('reacts to language without refetching or writing the account preference', async () => {
    const view = mount()
    await waitFor(() => expect(view.display.timeZone.value).toBe('America/New_York'))
    locale.value = 'zh-CN'
    await nextTick()
    expect(screen.getByTestId('display').textContent).toBe('2025年12月31日 19:30')
    expect(view.requests).toEqual(['alice'])
    expect(view.observer.preference.value?.updatedAt).toBe(saved(null).updatedAt)
  })
  it.each([true, false])('rejects an old login read across A/B/guest/A, success=%s', async success => {
    const pending = createDeferred<Preference>()
    const view = mount({ read: () => pending.promise })
    await waitFor(() => expect(view.requests).toEqual(['alice']))
    const firstEpoch = view.observer.scope.value.epoch
    view.options.read = async () => saved('Asia/Tokyo')
    view.setUser('bob')
    expect(view.display.timeZone.value).toBeNull()
    await waitFor(() => expect(view.display.timeZone.value).toBe('Asia/Tokyo'))
    void revokeAccountIdentity(view.client)
    expect(view.display.timeZone.value).toBeNull()
    view.setUser('alice')
    expect(view.display.timeZone.value).toBeNull()
    await waitFor(() => expect(view.display.timeZone.value).toBe('Asia/Tokyo'))
    if (success) pending.resolve(saved('America/New_York'))
    else pending.reject(new Error('old login failed'))
    await settle()
    expect(view.display.timeZone.value).toBe('Asia/Tokyo')
    expect(view.display.fallback.value).toBeNull()
    expect(view.observer.scope.value.epoch).toBeGreaterThan(firstEpoch)
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference', 'alice', firstEpoch] })).toEqual([])
  })
  it.each([true, false])('cancels an unmounted observer before a late read, success=%s', async success => {
    const pending = createDeferred<Preference>()
    const view = mount({ read: () => pending.promise })
    await waitFor(() => expect(view.requests).toHaveLength(1))
    const key = view.observer.queryKey.value
    view.unmount()
    if (success) pending.resolve(saved('America/New_York'))
    else pending.reject(new Error('unmounted request failed'))
    await settle()
    expect(view.client.getQueryData(key)).toBeUndefined()
  })
})
