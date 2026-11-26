import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { componentStubs } from '@/test/component-stubs'
import SupplementalGroupMembershipDialog from './SupplementalGroupMembershipDialog.vue'
import type { UserGroup } from '@/entities/user-group/api'
import type { UserSummary } from '@/entities/user/api'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const target: UserSummary = {
  id: '22222222-2222-4222-8222-222222222222', username: 'member', nickname: 'Member', group: 'admin', status: 'active',
  builtin: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-26T01:02:03.123456789Z',
  supplementalGroups: [{ key: 'custom-ops', name: 'Operations' }],
}
const groups: UserGroup[] = [
  { key: 'guest', name: 'Guest', description: '', builtin: true, editable: false, memberCount: 0, permissions: [], updatedAt: '2026-01-01T00:00:00Z' },
  { key: 'user', name: 'User', description: '', builtin: true, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-01-01T00:00:00Z' },
  { key: 'admin', name: 'Administrator', description: '', builtin: true, editable: true, memberCount: 1, permissions: ['admin:access'], updatedAt: '2026-01-01T00:00:00Z' },
  { key: 'custom-ops', name: 'Operations (renamed)', description: '', builtin: false, editable: true, memberCount: 1, permissions: [], updatedAt: '2026-01-01T00:00:00Z' },
  { key: 'custom-support', name: 'Support', description: '', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-01-01T00:00:00Z' },
]
const clients: QueryClient[] = []

/** Mounts the actual membership dialog with a controlled HTTP boundary. */
function mount(props = { target, groups, groupsReady: true, groupsLoading: false, groupsError: false }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '11111111-1111-4111-8111-111111111111', username: 'manager', group: 'admin', permissions: ['admin:access'] } })
  const view = render(SupplementalGroupMembershipDialog, { props, global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { ...view, client }
}

afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('supplemental group membership dialog', () => {
  it('freezes target identity and full revision, changes only custom supplemental groups, and blocks duplicate pending writes', async () => {
    const pending = createDeferred<Response>()
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => pending.promise)
    vi.stubGlobal('fetch', fetcher)
    const view = mount()

    expect((screen.getByRole('checkbox', { name: 'Operations' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: 'Administrator' })).toBeNull()
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Operations' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'supplementalMembership.confirm' }))
    const save = screen.getByRole('button', { name: 'supplementalMembership.save' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await fireEvent.click(save)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await fireEvent.click(save)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      id: target.id, groupKeys: ['custom-support'], expectedUpdatedAt: '2026-11-26T01:02:03.123456789Z',
    })
    expect((screen.getByRole('button', { name: 'supplementalMembership.cancel' }) as HTMLButtonElement).disabled).toBe(true)
    pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: { ...target, updatedAt: '2026-11-26T01:02:04Z', supplementalGroups: [{ key: 'custom-support', name: 'Support' }] } }, meta: {} })))
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
    expect(view.emitted().refresh).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.cancel' }))
    expect(view.emitted().close).toHaveLength(2)
  })

  it('keeps the opening membership labels and version when the live group directory changes', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: { ...target, updatedAt: '2026-11-26T01:02:04Z', supplementalGroups: [{ key: 'custom-ops', name: 'Operations' }, { key: 'custom-support', name: 'Support' }] } }, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    const view = mount()
    await view.rerender({ target: { ...target, supplementalGroups: [...target.supplementalGroups] }, groups: groups.map(group => group.key === 'custom-ops' ? { ...group, name: 'Directory changed' } : group), groupsReady: true, groupsLoading: false, groupsError: false })
    expect(screen.getByText('Operations')).toBeTruthy()
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'supplementalMembership.confirm' }))
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.save' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ id: target.id, expectedUpdatedAt: target.updatedAt, groupKeys: ['custom-ops', 'custom-support'] })
  })

  it('clears the snapshot and asks the owner to read back after conflict without replaying the write', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 300105, message: 'private conflict detail', data: null, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    const view = mount()
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'supplementalMembership.confirm' }))
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.save' }))
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
    expect(view.emitted().refresh).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('private conflict detail')).toBeNull()
  })

  it('reports a non-conflict write failure without exposing server details and asks for readback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 900000, message: 'private server detail', data: null, meta: {} }))))
    const view = mount()
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'supplementalMembership.confirm' }))
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.save' }))
    await waitFor(() => expect(view.emitted().refresh).toHaveLength(1))
    expect(screen.queryByText('private server detail')).toBeNull()
  })

  it('does not submit when the group catalog is loading or unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn())
    mount({ target, groups: [], groupsReady: false, groupsLoading: true, groupsError: false })
    expect((screen.getByRole('button', { name: 'supplementalMembership.save' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.save' }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps a missing frozen custom group visible but unavailable until an explicit refresh', async () => {
    mount({ target, groups: groups.filter(group => group.key !== 'custom-ops'), groupsReady: true, groupsLoading: false, groupsError: false })
    expect(await screen.findByText('supplementalMembership.staleGroups')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Operations' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'supplementalMembership.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the group-directory error and requests the owning page retry', async () => {
    const view = mount({ target, groups: [], groupsReady: false, groupsLoading: false, groupsError: true })
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.retryGroups' }))
    expect(view.emitted()['retry-groups']).toHaveLength(1)
    expect((screen.getByRole('button', { name: 'supplementalMembership.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores a late success after the frozen account revision changes', async () => {
    const pending = createDeferred<Response>()
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => pending.promise)
    vi.stubGlobal('fetch', fetcher)
    const view = mount()
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'supplementalMembership.confirm' }))
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.save' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await view.rerender({ target: { ...target, updatedAt: '2026-11-26T01:03:00Z' }, groups, groupsReady: true, groupsLoading: false, groupsError: false })
    expect(view.emitted().close).toHaveLength(1)
    pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: target }, meta: {} })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'supplementalMembership.save' }) as HTMLButtonElement).disabled).toBe(true))
    expect(view.emitted().refresh).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(view.emitted().close).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.cancel' }))
    expect(view.emitted().close).toHaveLength(2)
  })

  it('ignores a late success after administrative permission is lost', async () => {
    const pending = createDeferred<Response>()
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => pending.promise)
    vi.stubGlobal('fetch', fetcher)
    const view = mount()
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'supplementalMembership.confirm' }))
    await fireEvent.click(screen.getByRole('button', { name: 'supplementalMembership.save' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    view.client.setQueryData(['auth', 'me'], { user: { id: '11111111-1111-4111-8111-111111111111', username: 'manager', group: 'user', permissions: [] } })
    await waitFor(() => expect(view.emitted().close).toHaveLength(1))
    pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: target }, meta: {} })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'supplementalMembership.save' }) as HTMLButtonElement).disabled).toBe(true))
    expect(view.emitted().refresh).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
