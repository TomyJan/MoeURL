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
/** Complete public list records deliberately differ from their destinations. */
function rows(): AdminShortLink[] {
  return ['first', 'second', 'third'].map((slug, index) => ({
    id: slug, slug, url: index === 2 ? 'https://other.test/third' : `https://sho.rt/${slug}`, targetUrl: `https://destination.test/private-${slug}`,
    title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
    expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
    createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', owner: { id: 'reader', username: 'reader', nickname: '' },
  }))
}
/** Keeps the real parent, toolbar, access and cache; substitutes only HTTP and Clipboard. */
function mount(admin: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'reader', username: 'reader', nickname: '', group: admin ? 'admin' : 'user', permissions: admin ? ['admin:access', 'short_link:read_all'] : ['short_link:read_own'] } })
  let clipboard = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { clipboard = text } } })
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost'); requests.push(url.pathname)
    const current = url.searchParams.get('page') === '2' ? rows().slice(1, 2) : rows()
    const own = current.map(link => { const { owner, ...value } = link; void owner; return value })
    const data = url.pathname.endsWith('/user/list-preference') ? { preference: { pageSize: null, updatedAt: null } }
      : url.pathname.endsWith('/short-link/list') ? { items: admin ? current : own } : { items: [] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 23 } }))
  })
  const view = render(admin ? AdminLinksPage : MyLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })], stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true } } })
  return { ...view, client, requests, readClipboard: () => clipboard }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'clipboard') })

describe('copy selected links through real list parents', () => {
  // Gating selection on write permission or copying the whole page/destination must fail.
  it.each([false, true])('lets a read-only account copy exactly the selected public URLs in list order, admin=%s', async admin => {
    const view = mount(admin)
    await screen.findByText('https://sho.rt/first')
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(4)
    await fireEvent.click(checkboxes[3]!)
    await fireEvent.click(checkboxes[1]!)
    const before = view.requests.length
    await fireEvent.click(screen.getByRole('button', { name: 'Copy selected links' }))
    await waitFor(() => expect(view.readClipboard()).toBe('https://sho.rt/first\nhttps://other.test/third'))
    expect(view.requests).toHaveLength(before)
    for (const id of ['batch-enable', 'batch-disable', 'batch-delete', 'batch-tags', 'batch-transfer']) expect(screen.queryByTestId(id)).toBeNull()
    expect(view.readClipboard()).not.toContain('destination')
  })
})
