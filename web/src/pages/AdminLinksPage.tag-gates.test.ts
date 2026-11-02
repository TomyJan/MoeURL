import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick, type Component } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AdminLinksPage from './AdminLinksPage.vue'

const clients: QueryClient[] = []
const actor = { id: 'A', username: 'A', nickname: '', group: 'operators', permissions: ['admin:access', 'short_link:read_all'] }
/** Deliberately emits a previously queued child event even after the parent has blocked its control. */
const QueuedCatalog: Component = { props: { blocked: Boolean }, emits: ['select'], template: '<button data-testid="queued-tag" :data-blocked="blocked" @click="$emit(\'select\', \'Picked\')">Queued tag</button>' }
const ExportControl: Component = { emits: ['pending'], template: '<div><button @click="$emit(\'pending\', true)">Start export</button><button @click="$emit(\'pending\', false)">Finish export</button></div>' }
/** Uses the real page and QueryClient; child stubs only expose their public event contracts. */
function mount(catalog: Component = QueuedCatalog) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: actor })
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [] }, meta: { total: 0 } })))
  vi.stubGlobal('fetch', fetcher)
  return { ...render(AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })], stubs: { ...componentStubs, AdminTagBrowser: catalog, ShortLinkListExportButton: ExportControl, ShortLinkBatchToolbar: true } } }), client, fetcher }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

it('rejects a queued selection immediately when export starts and accepts it only after export finishes', async () => {
  const view = mount()
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  await fireEvent.click(screen.getByRole('button', { name: 'Start export' }))
  await fireEvent.click(screen.getByTestId('queued-tag'))
  expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('')
  await fireEvent.click(screen.getByRole('button', { name: 'Finish export' }))
  await fireEvent.click(screen.getByTestId('queued-tag'))
  expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('Picked')
})

it('rejects a queued selection while the live list is invalidated, absent or no longer authorized', async () => {
  const view = mount()
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  const refresh = createDeferred<Response>()
  view.fetcher.mockReturnValueOnce(refresh.promise)
  void view.client.invalidateQueries({ queryKey: ['admin-short-link'] })
  await fireEvent.click(screen.getByTestId('queued-tag'))
  expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('')
  refresh.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [] }, meta: { total: 0 } })))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  view.client.removeQueries({ queryKey: ['admin-short-link'] })
  await fireEvent.click(screen.getByTestId('queued-tag'))
  expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('')
  view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } })
  await nextTick()
  await fireEvent.click(screen.getByTestId('queued-tag'))
  expect((screen.getByLabelText('Tag') as HTMLInputElement).value).toBe('')
})
