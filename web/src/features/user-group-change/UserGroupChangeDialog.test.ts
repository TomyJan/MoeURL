import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import UserGroupChangeDialog from './UserGroupChangeDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const member = { id: '00000000-0000-0000-0000-000000000002', username: 'member', nickname: 'Member', group: 'user', status: 'active' as const, builtin: false, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00.123456Z' }
const clients: QueryClient[] = []
/** Mounts the actual dialog and HTTP client with a controllable network boundary. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000000001', username: 'manager', group: 'admin', permissions: ['admin:access'] } })
  const view = render(UserGroupChangeDialog, { props: { target: member }, global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { ...view, client }
}
/** Chooses a changed group and acknowledges session revocation. */
async function confirm() {
  await fireEvent.update(screen.getByLabelText('membership.group'), 'admin')
  await fireEvent.click(screen.getByLabelText('membership.confirm'))
}
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals() })

describe('membership dialog', () => {
  it('requires change and confirmation, preserves the version and blocks duplicate pending writes', async () => {
    const pending = createDeferred<Response>()
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => pending.promise)
    vi.stubGlobal('fetch', fetcher)
    const view = mount()
    const save = screen.getByRole('button', { name: 'membership.save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    // Synthetic queued activation must still be rejected by the submission guard.
    await fireEvent.click(save)
    expect(fetcher).not.toHaveBeenCalled()
    await confirm(); await fireEvent.click(save)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ id: member.id, groupKey: 'admin', expectedUpdatedAt: '2026-10-23T00:00:00.123456Z' })
    expect((screen.getByRole('button', { name: 'membership.cancel' }) as HTMLButtonElement).disabled).toBe(true)
    expect(save.disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'membership.cancel' }))
    expect(view.emitted().close).toBeUndefined()
    pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: { ...member, group: 'admin' } }, meta: {} })))
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
  })
  it.each([300105, 900000])('handles conflict or failure %s without automatically retrying', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code, message: 'private', data: null, meta: {} }))))
    const view = mount()
    await confirm(); await fireEvent.click(screen.getByRole('button', { name: 'membership.save' }))
    await waitFor(() => code === 300105 ? expect(view.emitted().close).toHaveLength(1) : expect((screen.getByRole('button', { name: 'membership.save' }) as HTMLButtonElement).disabled).toBe(false))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('private')).toBeNull()
  })
  it('closes on identity loss and prevents stale submission', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const view = mount(); await confirm()
    view.client.setQueryData(['auth', 'me'], { user: { id: '', username: 'guest', group: 'guest', permissions: [] } })
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
    expect((screen.getByRole('button', { name: 'membership.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    view.client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000000001', username: 'manager', group: 'admin', permissions: ['admin:access'] } })
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
  })
  it('resets state on target changes and supports cancel', async () => {
    const view = mount(); await confirm()
    await view.rerender({ target: { ...member, id: '00000000-0000-0000-0000-000000000003', username: 'other', group: 'admin' } })
    expect((screen.getByLabelText('membership.group') as HTMLSelectElement).value).toBe('admin')
    expect((screen.getByLabelText('membership.confirm') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'membership.save' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'membership.cancel' }))
    expect(view.emitted().close).toHaveLength(1)
  })
  it.each([true, false])('ignores a late %s result after switching the target', async (success) => {
    const pending = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const view = mount(); await confirm()
    await fireEvent.click(screen.getByRole('button', { name: 'membership.save' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await view.rerender({ target: { ...member, id: '00000000-0000-0000-0000-000000000003' } })
    pending.resolve(new Response(JSON.stringify({ code: success ? 0 : 300105, message: 'OK', data: success ? { user: member } : null, meta: {} })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'membership.cancel' }) as HTMLButtonElement).disabled).toBe(false))
    expect(view.emitted().close).toBeUndefined()
  })
  it.each([true, false])('ignores a late %s result after losing the administrative permission', async (success) => {
    const pending = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const view = mount(); await confirm()
    await fireEvent.click(screen.getByRole('button', { name: 'membership.save' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    view.client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000000001', username: 'manager', group: 'user', permissions: [] } })
    pending.resolve(new Response(JSON.stringify({ code: success ? 0 : 300105, message: 'OK', data: success ? { user: member } : null, meta: {} })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'membership.cancel' }) as HTMLButtonElement).disabled).toBe(false))
    expect(view.emitted().close).toHaveLength(1)
    view.client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000000001', username: 'manager', group: 'admin', permissions: ['admin:access'] } })
    await waitFor(() => expect((screen.getByRole('button', { name: 'membership.save' }) as HTMLButtonElement).disabled).toBe(false))
  })
})
