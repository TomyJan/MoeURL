import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import MyLinksPage from './MyLinksPage.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
/** Exercises the actual page, queries, validation and filter wiring with controlled HTTP responses. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'tag-reader', username: 'tag-reader', nickname: '', group: 'user', permissions: ['short_link:read_own'] } })
  const fetcher = vi.fn<typeof fetch>(async input => {
    const tags = String(input).includes('/short-link/tags')
    return new Response(JSON.stringify({ code: 0, message: 'OK', data: tags ? { items: [{ tag: 'Release 计划', linkCount: 3 }], hasMore: false } : { items: [] }, meta: { total: 0 } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return { ...render(MyLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })], stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, ShortLinkBatchToolbar: true } } }), client, fetcher }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('personal tag browser page', () => {
  it('finds an owned tag and preserves other filters', async () => {
    const view = mount()
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    expect(view.fetcher.mock.calls.some(([url]) => String(url).includes('/short-link/tags'))).toBe(false)
    await fireEvent.update(screen.getByLabelText('Status'), 'disabled')
    vi.useFakeTimers()
    await fireEvent.update(screen.getByLabelText('Keyword'), ' project ')
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await fireEvent.click(await screen.findByRole('button', { name: 'Release 计划 · 3' }))
    expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('Release 计划')
    expect((screen.getByLabelText('Keyword') as HTMLInputElement).value).toBe(' project ')
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('disabled')
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()
    await waitFor(() => expect(view.fetcher.mock.calls.some(([input]) => {
      const url = new URL(String(input), 'http://localhost')
      return url.pathname.endsWith('/short-link/list') && url.searchParams.get('tag') === 'Release 计划' && url.searchParams.get('q') === 'project' && url.searchParams.get('status') === 'disabled'
    })).toBe(true))
  })
})
