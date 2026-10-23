import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import ShortLinkTransferDialog from './ShortLinkTransferDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const target = { id: '00000000-0000-0000-0000-000000000020', url: 'https://short.example/handoff', owner: { id: 'old', username: 'original', nickname: 'Original' }, updatedAt: '2026-10-23T00:00:00.123456Z' }
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'manager', group: 'admin', permissions: ['admin:access', 'short_link:update_all'] }
const clients: QueryClient[] = []
/** Mounts the real dialog and HTTP boundary with one administrative identity. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  return { ...render(ShortLinkTransferDialog, { props: { target }, global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } }), client }
}
/** Supplies an exact recipient and acknowledges the history handoff. */
async function confirm() {
  await fireEvent.update(screen.getByLabelText('transfer.recipient'), 'recipient')
  await fireEvent.click(screen.getByLabelText('transfer.confirm'))
}
/** Builds a valid response preserving the request's identity. */
function response(code = 0) { return new Response(JSON.stringify({ code, message: 'private diagnostic', data: code === 0 ? { id: target.id, ownerId: '00000000-0000-0000-0000-000000000002', updatedAt: '2026-10-23T00:00:00.123457Z' } : null, meta: {} })) }
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('ownership transfer dialog', () => {
  it('requires an exact recipient and confirmation, preserves the opening version and blocks duplicate writes or close', async () => {
    const pending = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const view = mount()
    const save = screen.getByRole('button', { name: 'transfer.save' }) as HTMLButtonElement
    await fireEvent.click(save)
    expect(fetch).not.toHaveBeenCalled()
    await confirm()
    await fireEvent.update(screen.getByLabelText('transfer.recipient'), ' recipient')
    expect(save.disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('transfer.recipient'), 'recipient')
    await fireEvent.click(save)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ id: target.id, newOwnerUsername: 'recipient', expectedUpdatedAt: target.updatedAt })
    expect(save.disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.cancel' }))
    await fireEvent.click(save)
    expect(view.emitted().close).toBeUndefined()
    pending.resolve(response())
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
    expect(toast.success).toHaveBeenCalledWith('transfer.success')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([200116, 200117, 900000])('handles %s without retrying or losing an ordinary-error draft', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(code)))
    const view = mount(); await confirm()
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(code === 200116 ? 'transfer.conflict' : code === 200117 ? 'transfer.recipientUnavailable' : 'transfer.failed'))
    expect(fetch).toHaveBeenCalledTimes(1)
    if (code === 200116) expect(view.emitted().close).toHaveLength(1)
    else {
      expect(view.emitted().close).toBeUndefined()
      expect((screen.getByLabelText('transfer.recipient') as HTMLInputElement).value).toBe('recipient')
    }
    expect(screen.queryByText('private diagnostic')).toBeNull()
  })
  it.each([
    ['identity', 0], ['permission', 0], ['unmount', 0], ['identity', 200116], ['permission', 200116], ['unmount', 900000],
  ] as const)('ignores late responses after %s loss (%s)', async (reason, code) => {
    const pending = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const view = mount(); await confirm()
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    if (reason === 'unmount') view.unmount()
    else view.client.setQueryData(['auth', 'me'], { user: reason === 'identity' ? { ...actor, id: 'other' } : { ...actor, permissions: ['admin:access'] } })
    pending.resolve(response(code))
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    if (reason !== 'unmount') expect(view.emitted().close).toHaveLength(1)
  })
  it('can cancel without writing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const view = mount()
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.cancel' }))
    expect(view.emitted().close).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
