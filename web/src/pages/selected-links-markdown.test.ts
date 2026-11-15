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
/** Complete list DTOs contain private fields that must never enter the clipboard. */
function rows(): AdminShortLink[] {
  return ['first', 'second', 'third'].map((slug, index) => ({
    id: slug, slug, url: `https://sho.rt/${slug}`, targetUrl: `https://destination.test/private-${slug}`,
    title: index === 0 ? 'Docs [a] & b' : '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
    expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
    createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z', owner: { id: 'reader', username: 'reader', nickname: '' },
  }))
}
/** Runs both real parents with real cache/access/selection and substitutes only HTTP and Clipboard. */
function mount(admin: boolean, locale: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const user = { id: 'reader', username: 'reader', nickname: '', group: admin ? 'admin' : 'user', permissions: admin ? ['admin:access', 'short_link:read_all'] : ['short_link:read_own'] }
  client.setQueryData(['auth', 'me'], { user })
  let clipboard = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { clipboard = text } } })
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost'); requests.push(url.pathname)
    const current = rows(), own = current.map(link => { const { owner, ...value } = link; void owner; return value })
    const data = url.pathname.endsWith('/user/list-preference') ? { preference: { pageSize: null, updatedAt: null } }
      : url.pathname.endsWith('/short-link/list') ? { items: admin ? current : own } : { items: [] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 3 } }))
  })
  const view = render(admin ? AdminLinksPage : MyLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })], stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true } } })
  return { ...view, client, user, requests, readClipboard: () => clipboard }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'clipboard') })

describe('Markdown selection through real list parents', () => {
  // Omitting either parent entry, broadening permissions, exporting all rows or using click order breaks this behavior.
  it.each([{ admin: false, locale: 'en' }, { admin: true, locale: 'en' }, { admin: false, locale: 'zh-CN' }, { admin: true, locale: 'zh-CN' }])('copies selected titles and public URLs only, admin=$admin locale=$locale', async ({ admin, locale }) => {
    const view = mount(admin, locale)
    await screen.findByText('https://sho.rt/first')
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    const button = screen.getByTestId('short-link-selected-markdown-copy') as HTMLButtonElement
    expect(button.textContent?.trim()).toBe(locale === 'en' ? 'Copy selected Markdown' : '复制所选 Markdown')
    expect(button.disabled).toBe(true)
    const checkboxes = screen.getAllByRole('checkbox')
    await fireEvent.click(checkboxes[3]!); await fireEvent.click(checkboxes[1]!)
    const before = view.requests.length
    await fireEvent.click(button)
    await waitFor(() => expect(view.readClipboard()).toBe('- [Docs \\[a\\] &amp; b](<https://sho.rt/first>)\n- [https://sho\\.rt/third](<https://sho.rt/third>)'))
    await fireEvent.click(screen.getByTestId('short-link-selected-copy'))
    await waitFor(() => expect(view.readClipboard()).toBe('https://sho.rt/first\nhttps://sho.rt/third'))
    await fireEvent.click(screen.getByTestId('short-link-page-copy'))
    await waitFor(() => expect(view.readClipboard()).toBe('https://sho.rt/first\nhttps://sho.rt/second\nhttps://sho.rt/third'))
    expect(view.requests).toHaveLength(before)
    for (const id of ['batch-enable', 'batch-disable', 'batch-delete', 'batch-tags', 'batch-transfer']) expect(screen.queryByTestId(id)).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, permissions: [] } })
    await waitFor(() => expect(screen.queryByTestId('short-link-selected-markdown-copy')).toBeNull())
    expect(view.readClipboard()).not.toContain('destination')
  })
})
