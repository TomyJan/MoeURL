import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import PersonalTagBrowser from './PersonalTagBrowser.vue'
import AdminTagBrowser from './AdminTagBrowser.vue'

const clients: QueryClient[] = []
/** Returns identical label text with intentionally different counts in the two scopes. */
function response(count: number) {
  return new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [{ tag: 'Shared', linkCount: count }], hasMore: false }, meta: {} }))
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

it('keeps fixed endpoints, cached counts and invalidations isolated even for the same account and label', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'A', nickname: '', group: 'operators', permissions: ['short_link:read_own', 'admin:access', 'short_link:read_all'] } })
  const fetcher = vi.fn<typeof fetch>(async url => response(String(url).includes('/admin/') ? 8 : 2))
  vi.stubGlobal('fetch', fetcher)
  const Harness = defineComponent({ setup() {
    const own = useShortLinkAccess('own'), admin = useShortLinkAccess('admin')
    // A stray attribute cannot override either fixed wrapper's context.
    return () => h('div', [h(PersonalTagBrowser, { access: own, context: 'admin' }), h(AdminTagBrowser, { access: admin, context: 'own' })])
  } })
  render(Harness, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })], stubs: componentStubs } })
  await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
  await fireEvent.click(screen.getByRole('button', { name: 'All-site tags' }))
  await screen.findByRole('button', { name: 'Shared · 2' })
  await screen.findByRole('button', { name: 'Shared · 8' })
  expect(fetcher.mock.calls.map(([url]) => String(url)).sort()).toEqual(['/api/v1/admin/short-link/tags?q=', '/api/v1/short-link/tags?q='])
  const ownRefresh = createDeferred<Response>()
  fetcher.mockImplementation(async url => String(url).includes('/admin/') ? response(8) : ownRefresh.promise)
  void client.invalidateQueries({ queryKey: ['short-link'] })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Shared · 2' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Shared · 8' })).toBeTruthy()
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/admin/'))).toHaveLength(1)
  ownRefresh.resolve(response(3))
  await screen.findByRole('button', { name: 'Shared · 3' })
  const adminRefresh = createDeferred<Response>()
  fetcher.mockImplementation(async url => String(url).includes('/admin/') ? adminRefresh.promise : response(3))
  void client.invalidateQueries({ queryKey: ['admin-short-link'] })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Shared · 8' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Shared · 3' })).toBeTruthy()
  adminRefresh.resolve(response(9))
  await screen.findByRole('button', { name: 'Shared · 9' })
  client.setQueryData(['auth', 'me'], { user: null })
  await nextTick()
  expect(screen.queryByText(/Shared/)).toBeNull()
})
