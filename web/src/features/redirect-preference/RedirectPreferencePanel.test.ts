import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { onlineManager, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import RedirectPreferencePanel from './RedirectPreferencePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import type { RedirectPreference } from '@/entities/redirect-preference/api'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const version = '2026-11-02T00:00:00.123456789Z'
const nextVersion = '2026-11-02T00:00:01.987654321Z'
const clients: QueryClient[] = []
const ok = (preference: RedirectPreference) => new Response(JSON.stringify({ code: 0, message: '', data: { preference }, meta: {} }))
const failed = (code: number) => new Response(JSON.stringify({ code, message: '', data: null, meta: {} }))
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }
interface Options { initial?: RedirectPreference; read?: () => Promise<Response>; save?: () => Promise<Response> }

/** Keeps identity, queries, paused mutations and the editor real; controls only HTTP. */
function mount(options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  const user = (id: string) => ({ id, username: id, nickname: '', group: 'user', permissions: ['short_link:use_intermediate', 'short_link:use_confirmation'] })
  client.setQueryData(['auth', 'me'], { user: user('A') })
  const props = reactive({ userId: 'A', active: true, permissions: user('A').permissions })
  let preference = options.initial ?? { redirectMode: 'direct' as const, updatedAt: version }
  const writes: Array<{ redirectMode: string | null; expectedUpdatedAt: string | null }> = []
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    if (path === '/api/v1/user/redirect-preference') { reads++; return options.read ? options.read() : ok(preference) }
    if (path === '/api/v1/user/redirect-preference/update') {
      const input = JSON.parse(init.body as string)
      writes.push(input)
      if (options.save) return options.save()
      preference = { redirectMode: input.redirectMode, updatedAt: nextVersion }
      return ok(preference)
    }
    throw new Error('Unexpected request ' + path)
  }))
  const root = defineComponent({ setup: () => () => h(RedirectPreferencePanel, props) })
  const view = render(root, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { ...view, client, props, writes, options, reads: () => reads,
    setPreference(value: RedirectPreference) { preference = value },
    setUser(id: string) { client.setQueryData(['auth', 'me'], { user: user(id) }); props.userId = id },
  }
}
async function ready() {
  const select = await screen.findByLabelText('redirectPreference.mode') as HTMLSelectElement
  await waitFor(() => expect(select.disabled).toBe(false))
  return select
}
const submit = () => fireEvent.submit(screen.getByTestId('redirect-preference-form'))
afterEach(() => { cleanup(); onlineManager.setOnline(true); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each([null, 'direct', 'intermediate', 'confirmation'] as const)('saves %s with its exact independent version', async redirectMode => {
  const view = mount()
  await fireEvent.update(await ready(), redirectMode ?? '')
  await submit()
  await waitFor(() => expect(view.writes).toEqual([{ redirectMode, expectedUpdatedAt: version }]))
  await waitFor(() => expect(view.client.getQueriesData({ queryKey: ['user', 'redirect-preference'] })[0]?.[1]).toMatchObject({ preference: { redirectMode, updatedAt: nextVersion } }))
})
it('reads and clears a saved revoked mode without granting that capability', async () => {
  const view = mount({ initial: { redirectMode: 'confirmation', updatedAt: version } })
  view.props.permissions = []
  const select = await ready()
  expect(select.value).toBe('confirmation')
  expect(screen.getByText('redirectPreference.unavailable')).toBeTruthy()
  await fireEvent.update(select, '')
  await submit()
  await waitFor(() => expect(view.writes).toEqual([{ redirectMode: null, expectedUpdatedAt: version }]))
})
it('checks authoritative cached permissions before sending even while old props still allow the mode', async () => {
  const view = mount()
  await fireEvent.update(await ready(), 'confirmation')
  view.client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'A', nickname: '', group: 'user', permissions: [] } })
  await submit()
  await settle()
  expect(view.writes).toEqual([])
})
it('preserves a dirty draft across a temporary authentication failure', async () => {
  const view = mount()
  await fireEvent.update(await ready(), 'confirmation')
  view.props.active = false
  await nextTick()
  expect(screen.queryByTestId('redirect-preference-panel')).toBeNull()
  view.props.active = true
  expect((await ready()).value).toBe('confirmation')
  await waitFor(() => expect(view.reads()).toBe(2))
  await waitFor(() => expect(screen.getByTestId('redirect-preference-save')).toHaveProperty('disabled', false))
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
})
it.each(['identity', 'unmount', 'inactive', 'permission'] as const)('does not send an offline queued save after %s changes', async change => {
  const view = mount()
  await fireEvent.update(await ready(), 'confirmation')
  onlineManager.setOnline(false)
  await submit()
  await waitFor(() => expect(view.client.getMutationCache().getAll().some(mutation => mutation.state.isPaused)).toBe(true))
  if (change === 'identity') view.setUser('B')
  else if (change === 'unmount') view.unmount()
  else if (change === 'inactive') view.props.active = false
  else view.props.permissions = []
  await nextTick()
  onlineManager.setOnline(true)
  await view.client.resumePausedMutations()
  await waitFor(() => expect(view.client.getMutationCache().getAll().every(mutation => mutation.state.status !== 'pending')).toBe(true))
  expect(view.writes).toEqual([])
})
it.each([true, false])('ignores an old identity save result including feedback, success=%s', async success => {
  const pending = createDeferred<Response>()
  const successToast = vi.spyOn(toast, 'success')
  const errorToast = vi.spyOn(toast, 'error')
  const view = mount({ save: () => pending.promise })
  await fireEvent.update(await ready(), 'confirmation')
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
  view.setUser('B')
  expect((await ready()).value).toBe('direct')
  pending.resolve(success ? ok({ redirectMode: 'confirmation', updatedAt: nextVersion }) : failed(300104))
  await settle()
  expect((await ready()).value).toBe('direct')
  expect(successToast).not.toHaveBeenCalled()
  expect(errorToast).not.toHaveBeenCalled()
  expect(view.client.getQueriesData({ queryKey: ['user', 'redirect-preference', 'A'] })).toEqual([])
})
it.each([true, false])('does not leak a late read across logout and same-account login, success=%s', async success => {
  const pending = createDeferred<Response>()
  const view = mount({ read: () => pending.promise })
  await waitFor(() => expect(view.reads()).toBe(1))
  await revokeAccountIdentity(view.client)
  await nextTick()
  view.options.read = undefined
  view.setUser('A')
  expect((await ready()).value).toBe('direct')
  pending.resolve(success ? ok({ redirectMode: 'confirmation', updatedAt: nextVersion }) : failed(900000))
  await settle()
  expect((await ready()).value).toBe('direct')
  expect(screen.queryByText('redirectPreference.loadFailed')).toBeNull()
})
it('keeps a dirty draft on background change and adopts a fresh version without losing newer reload edits', async () => {
  const view = mount()
  await fireEvent.update(await ready(), 'intermediate')
  view.setPreference({ redirectMode: 'confirmation', updatedAt: nextVersion })
  await view.client.refetchQueries({ queryKey: ['user', 'redirect-preference'] })
  await screen.findByText('redirectPreference.conflict')
  expect((await ready()).value).toBe('intermediate')
  const pending = createDeferred<Response>()
  view.options.read = () => pending.promise
  await fireEvent.click(screen.getByText('redirectPreference.reload'))
  await fireEvent.update(screen.getByLabelText('redirectPreference.mode'), 'direct')
  pending.resolve(ok({ redirectMode: 'confirmation', updatedAt: nextVersion }))
  await waitFor(() => expect(screen.queryByText('redirectPreference.conflict')).toBeNull())
  expect((await ready()).value).toBe('direct')
  await submit()
  await waitFor(() => expect(view.writes).toEqual([{ redirectMode: 'direct', expectedUpdatedAt: nextVersion }]))
})
it.each([300104, 120001, 900000])('preserves a rejected write draft without automatic retry %s', async code => {
  const view = mount({ save: async () => failed(code) })
  await fireEvent.update(await ready(), 'confirmation')
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
  await settle()
  expect((await ready()).value).toBe('confirmation')
  expect(view.writes).toHaveLength(1)
  if (code === 300104) expect(screen.getByText('redirectPreference.conflict')).toBeTruthy()
})
it('retries a failed initial read and never writes until its version is known', async () => {
  const view = mount({ read: async () => failed(900000) })
  await screen.findByText('redirectPreference.loadFailed')
  await submit()
  expect(view.writes).toEqual([])
  view.options.read = undefined
  await fireEvent.click(screen.getByText('redirectPreference.retry'))
  expect((await ready()).value).toBe('direct')
})
it('rejects selecting a revoked enhancement and keeps the input invalid until another edit', async () => {
  const view = mount()
  const select = await ready()
  view.props.permissions = []
  await fireEvent.update(select, 'confirmation')
  await submit()
  await screen.findByText('redirectPreference.invalid')
  expect(view.writes).toEqual([])
  await fireEvent.update(select, '')
  expect(screen.queryByText('redirectPreference.invalid')).toBeNull()
})
it('preserves an edit made during a save while advancing its original revision', async () => {
  const pending = createDeferred<Response>()
  const view = mount({ save: () => pending.promise })
  await fireEvent.update(await ready(), 'confirmation')
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
  await fireEvent.update(screen.getByLabelText('redirectPreference.mode'), 'intermediate')
  pending.resolve(ok({ redirectMode: 'confirmation', updatedAt: nextVersion }))
  await waitFor(() => expect(screen.getByTestId('redirect-preference-save')).toHaveProperty('disabled', false))
  expect((await ready()).value).toBe('intermediate')
  view.options.save = undefined
  await submit()
  await waitFor(() => expect(view.writes[1]).toEqual({ redirectMode: 'intermediate', expectedUpdatedAt: nextVersion }))
})
it('adopts an explicit conflict reload, preserves a failed reload draft, and ignores a stale owner reload', async () => {
  const view = mount({ save: async () => failed(300104) })
  await fireEvent.update(await ready(), 'intermediate')
  await submit()
  await screen.findByText('redirectPreference.conflict')
  view.options.read = async () => failed(900000)
  await fireEvent.click(screen.getByText('redirectPreference.reload'))
  await screen.findByText('redirectPreference.loadFailed')
  expect((await ready()).value).toBe('intermediate')
  view.options.read = undefined
  view.setPreference({ redirectMode: 'confirmation', updatedAt: nextVersion })
  await fireEvent.click(screen.getByText('redirectPreference.reload'))
  await waitFor(() => expect(screen.queryByText('redirectPreference.conflict')).toBeNull())
  expect((await ready()).value).toBe('confirmation')
  await submit()
  await screen.findByText('redirectPreference.conflict')
  const pending = createDeferred<Response>()
  view.options.read = () => pending.promise
  await fireEvent.click(screen.getByText('redirectPreference.reload'))
  view.options.read = undefined
  view.setPreference({ redirectMode: 'direct', updatedAt: version })
  view.setUser('B')
  expect((await ready()).value).toBe('direct')
  pending.resolve(ok({ redirectMode: 'confirmation', updatedAt: nextVersion }))
  await settle()
  expect((await ready()).value).toBe('direct')
})
