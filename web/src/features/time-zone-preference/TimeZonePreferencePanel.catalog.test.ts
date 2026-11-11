import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { toast } from 'vue-sonner'
import { vuetify } from '@/app/vuetify'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import TimeZonePreferencePanel from './TimeZonePreferencePanel.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { zone?: string }) => values?.zone ? key + ': ' + values.zone : key, locale: { value: 'en' } }) }))
const version = '2026-11-11T00:00:00.123456Z'
const clients: QueryClient[] = []
interface Preference { timeZone: string | null; updatedAt: string | null }
interface Options { initial?: Preference; save?: () => Promise<Response>; read?: () => Promise<Preference> }
const ok = (preference: Preference) => new Response(JSON.stringify({ code: 0, message: '', data: { preference }, meta: {} }))

/** Runs the actual registered Vuetify selector, preference owner and HTTP adapter. */
function mount(options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  let user = { id: '00000000-0000-0000-0000-000000000701', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] as string[] }
  let preference: Preference = options.initial ?? { timeZone: 'UTC', updatedAt: version }
  const bodies: { timeZone: string | null; expectedUpdatedAt: string | null }[] = []
  client.setQueryData(['auth', 'me'], { user })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/v1/auth/me') return new Response(JSON.stringify({ code: 0, message: '', data: { user }, meta: {} }))
    if (url === '/api/v1/user/time-zone-preference') return ok(options.read ? await options.read() : preference)
    if (url === '/api/v1/user/time-zone-preference/update') {
      const body = JSON.parse(init.body as string) as typeof bodies[number]
      bodies.push(body)
      if (options.save) return options.save()
      preference = { timeZone: body.timeZone, updatedAt: '2026-11-11T00:00:01.123456Z' }
      return ok(preference)
    }
    throw new Error('Unexpected request ' + url)
  }))
  const view = render(TimeZonePreferencePanel, { props: { userId: user.id, active: true }, global: { plugins: [vuetify, [VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client, bodies, options,
    async setUser(id: string) { user = { ...user, id }; client.setQueryData(['auth', 'me'], { user }); await view.rerender({ userId: id, active: true }) },
  }
}

beforeEach(() => {
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function ready() {
  const input = await screen.findByRole('combobox', { name: 'timeZonePreference.zone' }) as HTMLInputElement
  await waitFor(() => expect(input.disabled).toBe(false))
  return input
}
const submit = () => fireEvent.submit(screen.getByTestId('time-zone-preference-form'))
const selection = () => screen.getByTestId('time-zone-preference-selection').textContent
async function selectZone(input: HTMLInputElement, value: string) {
  await fireEvent.focus(input)
  await fireEvent.click(input)
  await fireEvent.update(input, value)
  await fireEvent.click(await screen.findByRole('option', { name: value }))
  await waitFor(() => expect(selection()).toContain(value))
}
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }

describe('searchable time-zone catalog with actual Vuetify', () => {
  // A fixed readonly selector or a missing catalog choice must fail this user flow.
  it('CatalogSearchAndSave searches Chatham, selects by keyboard and saves its exact identifier', async () => {
    const view = mount()
    const input = await ready()
    expect(input.readOnly).toBe(false)
    await fireEvent.focus(input)
    await fireEvent.click(input)
    await fireEvent.update(input, 'Chatham')
    await screen.findByRole('option', { name: 'Pacific/Chatham' })
    expect(view.bodies).toEqual([])
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await nextTick()
    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    await submit()
    await waitFor(() => expect(view.bodies).toEqual([{ timeZone: 'Pacific/Chatham', expectedUpdatedAt: version }]))
    await waitFor(() => expect(input.value).toContain('Pacific/Chatham'))
  })

  it('SearchIsNotSavedValue preserves the selected zone through free text, Enter and clearing; only the device option saves null', async () => {
    const view = mount({ initial: { timeZone: 'Pacific/Chatham', updatedAt: version } })
    const input = await ready()
    await fireEvent.focus(input)
    await fireEvent.click(input)
    await fireEvent.update(input, 'NoSuchCity')
    await screen.findByText('timeZonePreference.noMatches')
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(selection()).toContain('Pacific/Chatham')
    expect(view.bodies).toEqual([])
    await fireEvent.update(input, '')
    expect(selection()).toContain('Pacific/Chatham')
    await submit()
    await waitFor(() => expect(view.bodies).toEqual([{ timeZone: 'Pacific/Chatham', expectedUpdatedAt: version }]))
    await waitFor(() => expect(screen.getByTestId('time-zone-preference-save')).toHaveProperty('disabled', false))
    await fireEvent.focus(input)
    await fireEvent.update(input, 'timeZonePreference.device')
    await fireEvent.click(await screen.findByRole('option', { name: 'timeZonePreference.device' }))
    expect(selection()).toContain('timeZonePreference.device')
    expect(view.bodies).toHaveLength(1)
    await submit()
    await waitFor(() => expect(view.bodies[1]).toEqual({ timeZone: null, expectedUpdatedAt: '2026-11-11T00:00:01.123456Z' }))
  })

  it.each([true, false])('CatalogIdentityRace ignores a late result after same-account relogin without unlocking its new save, success=%s', async success => {
    const oldSave = createDeferred<Response>()
    const newSave = createDeferred<Response>()
    const okToast = vi.spyOn(toast, 'success')
    const badToast = vi.spyOn(toast, 'error')
    const view = mount({ save: () => oldSave.promise })
    await selectZone(await ready(), 'Pacific/Chatham')
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(1))
    await revokeAccountIdentity(view.client)
    await view.setUser('00000000-0000-0000-0000-000000000701')
    const input = await ready()
    expect(selection()).toContain('UTC')
    await selectZone(input, 'Asia/Katmandu')
    view.options.save = () => newSave.promise
    await submit()
    await waitFor(() => expect(view.bodies).toHaveLength(2))
    oldSave.resolve(success ? ok({ timeZone: 'Pacific/Chatham', updatedAt: '2026-11-11T00:00:09Z' }) : new Response(JSON.stringify({ code: 300104, message: '', data: null, meta: {} })))
    await settle()
    expect(selection()).toContain('Asia/Katmandu')
    expect(screen.getByTestId('time-zone-preference-save')).toHaveProperty('disabled', true)
    expect(okToast).not.toHaveBeenCalled()
    expect(badToast).not.toHaveBeenCalled()
    // A disabled guest observer may exist, but it must contain no private data.
    expect(view.client.getQueriesData({ queryKey: ['user', 'time-zone-preference'] }).map(([, data]) => data).filter(data => data !== undefined)).toEqual([expect.objectContaining({ preference: { timeZone: 'UTC', updatedAt: version } })])
    newSave.resolve(ok({ timeZone: 'Asia/Katmandu', updatedAt: '2026-11-11T00:00:02Z' }))
    await waitFor(() => expect(okToast).toHaveBeenCalledTimes(1))
    expect(view.bodies[1]).toEqual({ timeZone: 'Asia/Katmandu', expectedUpdatedAt: version })
  })

  it('CatalogIdentityRace preserves a newer catalog draft through conflict and an explicit reload started before that edit', async () => {
    const reload = createDeferred<Preference>()
    const view = mount({ save: async () => new Response(JSON.stringify({ code: 300104, message: '', data: null, meta: {} })) })
    const input = await ready()
    await selectZone(input, 'Pacific/Chatham')
    await submit()
    await screen.findByText('timeZonePreference.conflict')
    expect(selection()).toContain('Pacific/Chatham')
    view.options.read = () => reload.promise
    await fireEvent.click(screen.getByText('timeZonePreference.reload'))
    await selectZone(input, 'Asia/Katmandu')
    reload.resolve({ timeZone: 'Europe/Berlin', updatedAt: '2026-11-11T00:00:03.123456789Z' })
    await waitFor(() => expect(screen.getByTestId('time-zone-preference-save')).toHaveProperty('disabled', false))
    expect(selection()).toContain('Asia/Katmandu')
    view.options.save = undefined
    await submit()
    await waitFor(() => expect(view.bodies[1]).toEqual({ timeZone: 'Asia/Katmandu', expectedUpdatedAt: '2026-11-11T00:00:03.123456789Z' }))
  })
})
