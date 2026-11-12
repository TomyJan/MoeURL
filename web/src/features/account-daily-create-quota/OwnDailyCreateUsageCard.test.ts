import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { setImmediate } from 'node:timers'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import OwnDailyCreateUsageCard from './OwnDailyCreateUsageCard.vue'
import { useOwnDailyCreateUsage } from './useOwnDailyCreateUsage'

const actor = '55ac4abf-b6fe-4e7d-ae50-aa2965fe276e'
const other = '85ac4abf-b6fe-4e7d-ae50-aa2965fe276e'
const finite = { usageDay: '2026-11-12', used: '7', dailyLimit: 10, remaining: 3 }
const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))
function user(id = actor, permissions = ['short_link:create']) {
  return { user: { id, username: id ? 'creator' : 'guest', nickname: 'Creator', group: id ? 'user' : 'guest', permissions } }
}
function deferred() {
  let resolve!: (value: Response) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function response(data: unknown, code = 0) {
  return new Response(JSON.stringify({ code, message: 'Result', data, meta: {} }))
}
let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals() })
function setup(initial = user(), locale: 'keys' | 'en' | 'zh-CN' = 'keys', control = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['auth', 'me'], initial)
  const reads: ReturnType<typeof deferred>[] = []
  const auth: ReturnType<typeof deferred>[] = []
  const fetcher = vi.fn((path: string) => {
    const pending = deferred()
    if (path === '/api/v1/account/daily-create-usage') reads.push(pending)
    else if (path === '/api/v1/auth/me') auth.push(pending)
    else throw Error('Unexpected transport: ' + path)
    return pending.promise
  })
  vi.stubGlobal('fetch', fetcher)
  let controls!: ReturnType<typeof useOwnDailyCreateUsage>
  const controller = defineComponent({ setup() { controls = useOwnDailyCreateUsage(); return controls }, template: '<output>{{ data?.used ?? state }}</output>' })
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, missingWarn: false, fallbackWarn: false, messages: locale === 'keys' ? {} : messages })
  const view = render(control ? controller : OwnDailyCreateUsageCard, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
  return { view, reads, auth, fetcher, controls }
}
async function expectReads(reads: unknown[], count: number) {
  await waitFor(() => expect(reads).toHaveLength(count))
}

describe('own daily usage card', () => {
  it.each(['zh-CN', 'en'] as const)('renders real %s labels and UTC dates', async locale => {
    const { reads } = setup(user(), locale)
    await expectReads(reads, 1)
    reads[0]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.getByRole('heading', { name: locale === 'en' ? 'Today’s creation usage' : '今日创建用量' })).toBeTruthy()
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Refresh usage' : '刷新用量' })).toBeTruthy()
    expect(screen.getByText('2026-11-12').parentElement?.textContent).toContain('UTC')
  })
  it.each([user('', []), user(actor, []), user('not-a-uuid')])('does not read or display private usage for an ineligible identity', async initial => {
    const { reads } = setup(initial)
    await flushPromises()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(reads).toHaveLength(0)
  })
  it('shows a UTC snapshot, hides it during refresh and keeps a failed refresh local', async () => {
    const { reads } = setup()
    await expectReads(reads, 1)
    expect(screen.getByTestId('own-usage-loading')).toBeTruthy()
    reads[0]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('2026-11-12')).toBeTruthy()
    expect(screen.getByText('ownDailyCreateUsage.snapshot')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.refresh' }))
    await expectReads(reads, 2)
    expect(screen.queryByText('7')).toBeNull()
    reads[1]!.reject(Error('offline'))
    await waitFor(() => expect(screen.getByTestId('own-usage-error')).toBeTruthy())
    expect(screen.queryByText('7')).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.retry' }))
    await expectReads(reads, 3)
    reads[2]!.resolve(response({ ...finite, used: '9223372036854775807', dailyLimit: null, remaining: null }))
    await waitFor(() => expect(screen.getByText('9223372036854775807')).toBeTruthy())
    expect(screen.getAllByText('ownDailyCreateUsage.unlimited')).toHaveLength(2)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(reads).toHaveLength(3)
  })
  it('shows exhausted zero without treating the snapshot as permission to create', async () => {
    const { reads } = setup()
    await expectReads(reads, 1)
    reads[0]!.resolve(response({ ...finite, used: '11', dailyLimit: 0, remaining: 0 }))
    await waitFor(() => expect(screen.getByText('11')).toBeTruthy())
    expect(screen.getByTestId('own-usage-remaining').textContent).toContain('0')
    expect(screen.getByRole('button', { name: 'ownDailyCreateUsage.refresh' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByText('ownDailyCreateUsage.snapshot')).toBeTruthy()
  })
  it.each([120001, 401, 403])('stops after denial %s and explicitly restores authorization before reading again', async code => {
    const { reads, auth } = setup()
    await expectReads(reads, 1)
    reads[0]!.resolve(code === 120001 ? response(null, code) : new Response('', { status: code }))
    await waitFor(() => expect(screen.getByTestId('own-usage-denied')).toBeTruthy())
    await flushPromises()
    expect(reads).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.recover' }))
    await waitFor(() => expect(auth).toHaveLength(1))
    expect(reads).toHaveLength(1)
    auth[0]!.resolve(response(user()))
    await expectReads(reads, 2)
    reads[1]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
  })
  it('keeps denied state when authorization recovery fails or confirms removed grants', async () => {
    const { reads, auth } = setup()
    await expectReads(reads, 1)
    reads[0]!.resolve(response(null, 120001))
    await waitFor(() => expect(screen.getByTestId('own-usage-denied')).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.recover' }))
    await waitFor(() => expect(auth).toHaveLength(1))
    auth[0]!.reject(Error('offline'))
    await waitFor(() => expect(screen.getByTestId('own-usage-denied')).toBeTruthy())
    expect(reads).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.recover' }))
    await waitFor(() => expect(auth).toHaveLength(2))
    auth[1]!.resolve(response(user(actor, [])))
    await waitFor(() => expect(screen.getByTestId('own-usage-denied')).toBeTruthy())
    expect(reads).toHaveLength(1)
  })
  it('retires a late success across A to guest to A without reusing its private cache', async () => {
    const { reads } = setup()
    await expectReads(reads, 1)
    client.setQueryData(['auth', 'me'], user('', []))
    client.setQueryData(['auth', 'me'], user())
    await expectReads(reads, 2)
    reads[0]!.resolve(response({ ...finite, used: '8', remaining: 2 }))
    await flushPromises()
    expect(screen.queryByText('8')).toBeNull()
    reads[1]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    const cached = client.getQueryCache().findAll({ queryKey: ['account-daily-create-usage'] })
    expect(cached.some(query => (query.state.data as { used?: string } | undefined)?.used === '8')).toBe(false)
  })
  it('ignores late errors after changing account and clears data on same-account revocation', async () => {
    const { reads } = setup()
    await expectReads(reads, 1)
    client.setQueryData(['auth', 'me'], user(other))
    await expectReads(reads, 2)
    reads[0]!.reject(Error('old account offline'))
    reads[1]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.queryByTestId('own-usage-error')).toBeNull()
    client.setQueryData(['auth', 'me'], user(other, []))
    await flushPromises()
    expect(screen.queryByText('7')).toBeNull()
    expect(client.getQueryCache().findAll({ queryKey: ['account-daily-create-usage'] })).toHaveLength(0)
  })
  it('retires pending usage and authorization reads on unmount or a newer identity', async () => {
    const { view, reads } = setup()
    await expectReads(reads, 1)
    view.unmount()
    reads[0]!.resolve(response(finite))
    await flushPromises()
    expect(client.getQueryCache().findAll({ queryKey: ['account-daily-create-usage'] })).toHaveLength(0)
  })
  it('does not let a late authorization reply replace a newer account', async () => {
    const { reads, auth } = setup()
    await expectReads(reads, 1)
    reads[0]!.resolve(response(null, 120001))
    await waitFor(() => expect(screen.getByTestId('own-usage-denied')).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.recover' }))
    await waitFor(() => expect(auth).toHaveLength(1))
    client.setQueryData(['auth', 'me'], user(other))
    await expectReads(reads, 2)
    auth[0]!.resolve(response(user()))
    reads[1]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(client.getQueryData(['auth', 'me'])).toEqual(user(other))
    expect(reads).toHaveLength(2)
  })
  it('does not restore grants after the initiating card unmounts', async () => {
    const { view, reads, auth } = setup()
    await expectReads(reads, 1)
    reads[0]!.resolve(response(null, 120001))
    await waitFor(() => expect(screen.getByTestId('own-usage-denied')).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: 'ownDailyCreateUsage.recover' }))
    await waitFor(() => expect(auth).toHaveLength(1))
    view.unmount()
    auth[0]!.resolve(response(user()))
    await flushPromises()
    expect(client.getQueryData(['auth', 'me'])).toEqual(user(actor, []))
    expect(client.getQueryCache().findAll({ queryKey: ['account-daily-create-usage'] })).toHaveLength(0)
  })
  it('ignores repeated and ineligible actions without transport, including retired callbacks', async () => {
    const { controls, reads, auth, view } = setup(user('', []), 'keys', true)
    await controls.refresh(); await controls.recover()
    expect(reads).toHaveLength(0); expect(auth).toHaveLength(0)
    client.setQueryData(['auth', 'me'], user())
    await expectReads(reads, 1)
    await controls.refresh()
    expect(reads).toHaveLength(1)
    reads[0]!.resolve(response(null, 120001))
    await waitFor(() => expect(screen.getByText('denied')).toBeTruthy())
    client.setQueryData(['auth', 'me'], user())
    await controls.refresh()
    expect(reads).toHaveLength(1)
    const pending = controls.recover()
    await controls.recover()
    await waitFor(() => expect(auth).toHaveLength(1))
    auth[0]!.resolve(response(user()))
    await pending
    await expectReads(reads, 2)
    reads[1]!.resolve(response(finite))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    client.setQueryData(['auth', 'me'], user())
    await flushPromises()
    expect(reads).toHaveLength(2)
    view.unmount()
    await controls.refresh(); await controls.recover()
    expect(reads).toHaveLength(2); expect(auth).toHaveLength(1)
  })
  it('rejects a scope revoked exactly when query cache publication completes', async () => {
    const { reads } = setup()
    await expectReads(reads, 1)
    const stop = client.getQueryCache().subscribe(event => {
      if (event.query.queryKey[0] === 'account-daily-create-usage' && event.query.state.status === 'success') {
        stop()
        client.setQueryData(['auth', 'me'], user('', []))
      }
    })
    reads[0]!.resolve(response(finite))
    await flushPromises()
    expect(screen.queryByText('7')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(client.getQueryCache().findAll({ queryKey: ['account-daily-create-usage'] })).toHaveLength(0)
  })
})
