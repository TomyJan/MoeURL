import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import ListPreferencePanel from './ListPreferencePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const version = '2026-11-09T00:00:00.123456789Z'
function response(size: number | null, code = 0) {
  return new Response(JSON.stringify({ code, message: '', data: code ? null : { preference: { pageSize: size, updatedAt: version } } }))
}
function mount(initial?: Promise<Response>, active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'alice', group: 'user', nickname: '', permissions: [] } })
  const state = { read: undefined as (() => Promise<Response>) | undefined, writeCode: 0, writes: [] as unknown[] }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/update')) {
      const input = JSON.parse(init.body as string)
      state.writes.push(input)
      return response(input.pageSize, state.writeCode)
    }
    return state.read ? state.read() : initial ?? response(null)
  }))
  const view = render(ListPreferencePanel, { props: { userId: 'A', active }, global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { ...view, client, state }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

// Omitting the retry action or enabling save before a successful read breaks recovery.
it('shows loading, then a read failure, and retries without an implicit write', async () => {
  const pending = createDeferred<Response>()
  const view = mount(pending.promise)
  expect(screen.getByRole('progressbar')).toBeDefined()
  expect(screen.getByTestId('list-preference-save')).toHaveProperty('disabled', true)
  pending.reject(new Error('offline'))
  expect(await screen.findByText('listPreference.loadFailed')).toBeDefined()
  view.state.read = async () => response(50)
  await fireEvent.click(screen.getByRole('button', { name: 'listPreference.retry' }))
  await waitFor(() => expect(screen.getByLabelText('listPreference.pageSize')).toHaveProperty('value', '50'))
  expect(screen.queryByText('listPreference.loadFailed')).toBeNull()
  expect(view.state.writes).toEqual([])
})

// A conflict must preserve the selected draft and prevent a second blind write.
it('keeps a conflict draft until the user explicitly reloads', async () => {
  const view = mount()
  const select = screen.getByLabelText('listPreference.pageSize')
  await waitFor(() => expect(select).toHaveProperty('disabled', false))
  await fireEvent.update(select, '100')
  view.state.writeCode = 300104
  await fireEvent.submit(screen.getByTestId('list-preference-form'))
  expect(await screen.findByText('listPreference.conflict')).toBeDefined()
  expect(select).toHaveProperty('value', '100')
  expect(screen.getByTestId('list-preference-save')).toHaveProperty('disabled', true)
  const pending = createDeferred<Response>()
  view.state.read = () => pending.promise
  await fireEvent.click(screen.getByRole('button', { name: 'listPreference.reload' }))
  expect(screen.getByRole('button', { name: 'listPreference.reload' })).toHaveProperty('disabled', true)
  pending.resolve(response(50))
  await waitFor(() => expect(select).toHaveProperty('value', '50'))
  expect(screen.queryByText('listPreference.conflict')).toBeNull()
  expect(view.state.writes).toEqual([{ pageSize: 100, expectedUpdatedAt: version }])
})

it('shows validation instead of posting an unsupported selector value', async () => {
  const view = mount()
  const select = screen.getByLabelText('listPreference.pageSize') as HTMLSelectElement
  await waitFor(() => expect(select).toHaveProperty('disabled', false))
  const tampered = document.createElement('option'); tampered.value = '30'; tampered.text = '30'; select.add(tampered)
  await fireEvent.update(select, '30')
  await fireEvent.submit(screen.getByTestId('list-preference-form'))
  expect(screen.getByText('listPreference.invalid')).toBeDefined()
  expect(view.state.writes).toEqual([])
  await fireEvent.update(select, '20')
  expect(screen.queryByText('listPreference.invalid')).toBeNull()
})

it('hides the personal resource for an inactive identity', () => {
  const view = mount(undefined, false)
  expect(screen.queryByTestId('list-preference-panel')).toBeNull()
  expect(view.state.writes).toEqual([])
})
