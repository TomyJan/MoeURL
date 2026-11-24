import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { userGroupQueryKey } from '@/entities/user-group/api'
import CreateUserPage from './CreateUserPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let client: QueryClient
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

it('uses current server groups when assigning a group to a new user', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const manager = { id: 'manager-id', username: 'manager', nickname: '', group: 'admin', permissions: ['admin:access'] }
  client.setQueryData(['auth', 'me'], { user: manager })
  const key = '52ef11fc-95a4-4a8d-8f72-1f707b5c6a80'
  client.setQueryData([...userGroupQueryKey, manager.id, 1], { groups: [
    { key: 'guest', name: 'Guest', description: '', builtin: true, editable: false, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
    { key: 'user', name: 'User', description: '', builtin: true, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
    { key: 'admin', name: 'Administrator', description: '', builtin: true, editable: true, memberCount: 1, permissions: ['admin:access'], updatedAt: '2026-10-23T00:00:00Z' },
    { key, name: 'Operations', description: '', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
  ], permissions: [{ key: 'admin:access', category: 'administration', protected: true }], presets: ['restricted', 'basic', 'standard'].map((preset) => ({ key: preset, applicableGroups: ['user', 'admin'], permissions: [] })) })
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: { id: 'new-user', username: 'ops-user', nickname: 'Ops', group: key, status: 'active' } }, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  render(CreateUserPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })

  await fireEvent.update(screen.getByLabelText('createUser.username'), 'ops-user')
  await fireEvent.update(screen.getByLabelText('createUser.password'), 'secure-password')
  await fireEvent.update(screen.getByLabelText('createUser.nickname'), 'Ops')
  await fireEvent.update(screen.getByLabelText('createUser.group'), key)
  await fireEvent.click(screen.getByRole('button', { name: 'createUser.submit' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ username: 'ops-user', password: 'secure-password', nickname: 'Ops', groupKey: key, status: 'active' })
})

it('disables pending user creation and fails closed if the group catalog empties before success', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const manager = { id: 'manager-id', username: 'manager', nickname: '', group: 'admin', permissions: ['admin:access'] }
  client.setQueryData(['auth', 'me'], { user: manager })
  client.setQueryData([...userGroupQueryKey, manager.id, 1], { groups: [
    { key: 'guest', name: 'Guest', description: '', builtin: true, editable: false, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
    { key: 'user', name: 'User', description: '', builtin: true, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
    { key: 'admin', name: 'Administrator', description: '', builtin: true, editable: true, memberCount: 1, permissions: ['admin:access'], updatedAt: '2026-10-23T00:00:00Z' },
  ], permissions: [{ key: 'admin:access', category: 'administration', protected: true }], presets: ['restricted', 'basic', 'standard'].map((preset) => ({ key: preset, applicableGroups: ['user', 'admin'], permissions: [] })) })
  const pending = createDeferred<Response>()
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => pending.promise)
  vi.stubGlobal('fetch', fetcher)
  render(CreateUserPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })

  const submit = screen.getByRole('button', { name: 'createUser.submit' })
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
  await fireEvent.update(screen.getByLabelText('createUser.username'), 'pending-user')
  await fireEvent.update(screen.getByLabelText('createUser.password'), 'secure-password')
  await fireEvent.click(submit)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(submit).toHaveProperty('disabled', true)

  client.setQueryData([...userGroupQueryKey, manager.id, 1], { groups: [], permissions: [], presets: ['restricted', 'basic', 'standard'].map((key) => ({ key, applicableGroups: ['user'], permissions: [] })) })
  pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: { id: 'new-user', username: 'pending-user', nickname: '', group: 'user', status: 'active' } }, meta: {} })))
  await screen.findByText('feedback.created · pending-user')
  await waitFor(() => expect((screen.getByLabelText('createUser.group') as HTMLSelectElement).value).toBe(''))
  expect(screen.getByRole('button', { name: 'createUser.submit' })).toHaveProperty('disabled', true)
})

it('allows retrying the current group catalog after a transient read failure', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const manager = { id: 'manager-id', username: 'manager', nickname: '', group: 'admin', permissions: ['admin:access'] }
  client.setQueryData(['auth', 'me'], { user: manager })
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 900000, message: 'offline', data: null, meta: {} })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'OK', data: { groups: [
      { key: 'guest', name: 'Guest', description: '', builtin: true, editable: false, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
      { key: 'user', name: 'User', description: '', builtin: true, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
      { key: 'admin', name: 'Administrator', description: '', builtin: true, editable: true, memberCount: 1, permissions: ['admin:access'], updatedAt: '2026-10-23T00:00:00Z' },
      { key: 'operations-key', name: 'Operations', description: '', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-10-23T00:00:00Z' },
    ], permissions: [{ key: 'admin:access', category: 'administration', protected: true }], presets: ['restricted', 'basic', 'standard'].map((preset) => ({ key: preset, applicableGroups: ['user', 'admin'], permissions: [] })) }, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  render(CreateUserPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })

  await screen.findByText('createUser.groupsLoadFailed')
  expect((screen.getByLabelText('createUser.group') as HTMLSelectElement).disabled).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: 'createUser.retryGroups' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('option', { name: 'Operations' })).toBeTruthy()
  expect((screen.getByLabelText('createUser.group') as HTMLSelectElement).disabled).toBe(false)
})

it('keeps account creation unavailable when the server catalog has no assignable groups', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const manager = { id: 'manager-id', username: 'manager', nickname: '', group: 'admin', permissions: ['admin:access'] }
  client.setQueryData(['auth', 'me'], { user: manager })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { groups: [], permissions: [], presets: ['restricted', 'basic', 'standard'].map((preset) => ({ key: preset, applicableGroups: ['user'], permissions: [] })) }, meta: {} }))))
  render(CreateUserPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })

  await waitFor(() => expect((screen.getByLabelText('createUser.group') as HTMLSelectElement).value).toBe(''))
  expect(await screen.findByText('createUser.noAssignableGroups')).toBeTruthy()
  expect((screen.getByLabelText('createUser.group') as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'createUser.submit' })).toHaveProperty('disabled', true)
})
