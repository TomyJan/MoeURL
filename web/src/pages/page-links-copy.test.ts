import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import type { AdminShortLink } from '@/entities/short-link/model'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
/** Supplies complete existing list records; public addresses differ from their private destinations. */
function rows(): AdminShortLink[] {
  return ['first', 'second'].map((slug, index) => ({
    id: slug, slug, url: index ? 'https://other.test/second' : 'https://sho.rt/first', targetUrl: `https://destination.test/private-${slug}`,
    title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
    expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
    createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', owner: { id: 'reader', username: 'reader', nickname: '' },
  }))
}
/** Exercises real parent/query/filter wiring while replacing only the HTTP and OS clipboard boundaries. */
function mount(admin: boolean, total = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'reader', username: 'reader', nickname: '', group: admin ? 'admin' : 'user', permissions: admin ? ['admin:access', 'short_link:read_all'] : ['short_link:read_own'] } })
  let clipboard = ''
  const writeText = vi.fn(async (text: string) => { clipboard = text })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input), 'http://localhost'), path = url.pathname
    const current = url.searchParams.get('page') === '2' ? rows().slice(1) : rows()
    const own = current.map(link => { const { owner, ...value } = link; void owner; return value })
    const data = path.endsWith('/user/list-preference') ? { preference: { pageSize: null, updatedAt: null } }
      : path.endsWith('/short-link/list') ? { items: admin ? current : own } : { items: [] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total } }))
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(admin ? AdminLinksPage : MyLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })], stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, ShortLinkBatchToolbar: true } } })
  return { ...view, client, fetcher, writeText, readClipboard: () => clipboard }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'clipboard'); vi.useRealTimers() })

describe('copy links from the current real list page', () => {
  // Omitting the parent action or copying targetUrl/all-query results must fail this behavior.
  it.each([false, true])('copies only ordered current public URLs without export permission, admin=%s', async admin => {
    const view = mount(admin)
    await screen.findByText('https://sho.rt/first')
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    const before = view.fetcher.mock.calls.length
    await fireEvent.click(screen.getByRole('button', { name: 'Copy links on this page' }))
    await waitFor(() => expect(view.readClipboard()).toBe('https://sho.rt/first\nhttps://other.test/second'))
    expect(view.readClipboard()).not.toContain('destination')
    expect(view.fetcher.mock.calls.length).toBe(before)
  })
  // Failing to include the immediate draft gate would copy a page for the previous filter.
  it.each([false, true])('blocks an unapplied keyword or private-note draft, admin=%s', async admin => {
    const view = mount(admin)
    await screen.findByText('https://sho.rt/first')
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    for (const label of ['Keyword', 'Note keyword']) {
      vi.useFakeTimers()
      await fireEvent.update(screen.getByLabelText(label), 'unapplied')
      const button = screen.getByRole('button', { name: 'Copy links on this page' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      button.click()
      expect(view.readClipboard()).toBe('')
      await fireEvent.update(screen.getByLabelText(label), '')
      await vi.advanceTimersByTimeAsync(500)
      vi.useRealTimers()
    }
  })
  // Taking items from the previous key or fetching all matches breaks the second-page payload.
  it.each([false, true])('copies the new page alone after explicit pagination, admin=%s', async admin => {
    const view = mount(admin, 22)
    await screen.findByText('https://sho.rt/first')
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    await fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.queryByText('https://sho.rt/first')).toBeNull())
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    await fireEvent.click(screen.getByRole('button', { name: 'Copy links on this page' }))
    expect(view.readClipboard()).toBe('https://other.test/second')
    expect(view.fetcher.mock.calls.filter(([input]) => String(input).includes('/short-link/list'))).toHaveLength(2)
  })
})
