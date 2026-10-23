import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { componentStubs } from '@/test/component-stubs'
import AdminUsersPage from './AdminUsersPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const clients: QueryClient[] = []
const member = { id: '00000000-0000-0000-0000-000000000002', username: 'member', nickname: 'Member', group: 'user', status: 'active', builtin: false, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00.123456Z' }
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals() })

it('opens a frozen account snapshot, preserves it across refetch and hides protected targets', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'self', username: 'manager', group: 'admin', permissions: ['admin:access'] } })
  const items = [member, { ...member, id: 'self', username: 'manager' }, { ...member, id: 'builtin', username: 'root', builtin: true }]
  client.setQueryData(['admin-user'], { items, meta: { page: 1, pageSize: 20, total: 3 } })
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: member }, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  render(AdminUsersPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  const rows = screen.getAllByTestId('console-user-row')
  await fireEvent.click(within(rows[1]!).getByRole('button', { name: 'adminUsers.actions.more' }))
  expect(screen.queryByRole('button', { name: 'membership.title' })).toBeNull()
  await fireEvent.click(within(rows[0]!).getByRole('button', { name: 'adminUsers.actions.more' }))
  await fireEvent.click(screen.getByRole('button', { name: 'membership.title' }))
  const dialog = screen.getByRole('dialog')
  // A repeated underlying action cannot replace the opening snapshot.
  await fireEvent.click(screen.getByRole('button', { name: 'membership.title' }))
  client.setQueryData(['admin-user'], { items: [{ ...member, updatedAt: '2026-10-23T12:00:00Z' }], meta: { page: 1, pageSize: 20, total: 1 } })
  await fireEvent.update(within(dialog).getByLabelText('membership.group'), 'admin')
  await fireEvent.click(within(dialog).getByLabelText('membership.confirm'))
  await fireEvent.click(within(dialog).getByRole('button', { name: 'membership.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const mutation = fetcher.mock.calls.find(([path]) => String(path).includes('change-group'))
  expect(mutation).toBeTruthy()
  expect(JSON.parse(mutation![1]!.body as string).expectedUpdatedAt).toBe('2026-10-23T00:00:00.123456Z')
})
