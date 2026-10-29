import { cleanup, render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { publicAppearanceKey } from '@/entities/appearance/api'
import { publishAppearance, useSiteAppearance } from './useSiteAppearance'

const palettes = vi.hoisted(() => ({ value: {
  moeurlLight: { colors: { primary: '' }, variables: {} },
  moeurlDark: { colors: { primary: '' }, variables: {} },
} }))
vi.mock('vuetify', () => ({ useTheme: () => ({ themes: palettes }) }))
const response = (accentPreset: string) => new Response(JSON.stringify({ code: 0, message: 'OK', data: { accentPreset }, meta: {} }), { status: 200 })
let client: QueryClient
let controller: ReturnType<typeof useSiteAppearance>
function mount() {
  return render(defineComponent({ setup() { controller = useSiteAppearance(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
}
describe('public appearance commit/read generations', () => {
  beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }) })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })
  it('uses iris while initially pending, applies a success, retains it during refresh and falls back on failure', async () => {
    const first = createDeferred<Response>(), second = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    mount()
    expect(controller.appearance.value).toEqual({ accentPreset: 'iris' })
    expect(palettes.value.moeurlLight.colors.primary).toBe('#5c4dde')
    first.resolve(response('ocean'))
    await waitFor(() => expect(palettes.value.moeurlLight.colors.primary).toBe('#075eae'))
    const pending = controller.read()
    expect(controller.appearance.value).toEqual({ accentPreset: 'ocean' })
    second.reject(new Error('offline')); await pending
    expect(controller.error.value).toBe(true)
    expect(controller.loading.value).toBe(false)
    expect(palettes.value.moeurlLight.colors.primary).toBe('#5c4dde')
  })
  it.each(['resolve', 'reject'] as const)('old public %s/error/finally cannot overwrite a save or finish a newer pending read', async (outcome) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise))
    mount()
    publishAppearance(client, { accentPreset: 'forest' })
    expect(controller.appearance.value).toEqual({ accentPreset: 'forest' })
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' })
    const pending = controller.read()
    if (outcome === 'resolve') old.resolve(response('ocean'))
    else old.reject(new Error('old failure'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(controller.appearance.value).toEqual({ accentPreset: 'forest' })
    expect(controller.loading.value).toBe(true)
    expect(controller.error.value).toBe(false)
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' })
    current.resolve(response('iris')); await pending
    expect(controller.appearance.value).toEqual({ accentPreset: 'iris' })
    expect(controller.loading.value).toBe(false)
  })
  it('remounts with an actual read and does not apply an old unmounted response', async () => {
    const old = createDeferred<Response>(), fresh = createDeferred<Response>()
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('fetch', fetcher)
    mount().unmount(); mount()
    old.resolve(response('ocean')); await old.promise; await nextTick()
    expect(controller.appearance.value).toEqual({ accentPreset: 'iris' })
    fresh.resolve(response('forest'))
    await waitFor(() => expect(palettes.value.moeurlDark.colors.primary).toBe('#8dd9a3'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' })
  })
  it('does not apply a read after a commit occurs inside its successful cache notification', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('ocean')))
    let committed = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!committed && event.query.queryKey[0] === 'system' && event.query.state.data) {
        committed = true
        publishAppearance(client, { accentPreset: 'forest' })
      }
    })
    mount()
    await waitFor(() => expect(controller.loading.value).toBe(false))
    expect(controller.appearance.value).toEqual({ accentPreset: 'forest' })
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' })
    unsubscribe()
  })
})
