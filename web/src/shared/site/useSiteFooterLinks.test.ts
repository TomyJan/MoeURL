import { cleanup, render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { publicFooterLinksKey, type FooterLinks } from '@/entities/footer-links/api'
import { publishFooterLinks, useSiteFooterLinks } from './useSiteFooterLinks'

const docs: FooterLinks = { links: [{ label: 'Docs', url: 'https://example.com/docs' }] }
const policy: FooterLinks = { links: [{ label: 'Policy', url: 'http://localhost:8080/policy' }] }
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
let client: QueryClient
let controller: ReturnType<typeof useSiteFooterLinks>
function mount() {
  return render(defineComponent({ setup() { controller = useSiteFooterLinks(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
}
describe('footer links public read and commit generations', () => {
  beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }) })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })
  it('starts empty, retains last success during refresh and clears public data after a current failure', async () => {
    const first = createDeferred<Response>(), second = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    mount()
    expect(controller.footerLinks.value).toEqual({ links: [] })
    expect(controller.loading.value).toBe(true)
    first.resolve(response(docs))
    await waitFor(() => expect(controller.footerLinks.value).toEqual(docs))
    const pending = controller.read()
    expect(controller.footerLinks.value).toEqual(docs)
    expect(controller.loading.value).toBe(true)
    second.reject(new Error('offline')); await pending
    expect(controller.footerLinks.value).toEqual({ links: [] })
    expect(controller.error.value).toBe(true)
    expect(controller.loading.value).toBe(false)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual({ links: [] })
  })
  it.each(['resolve', 'reject'] as const)('old %s cannot overwrite a publish, poison cache or finish a newer pending read', async outcome => {
    const old = createDeferred<Response>(), fresh = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise))
    mount()
    publishFooterLinks(client, policy)
    expect(controller.footerLinks.value).toEqual(policy)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
    const pending = controller.read()
    if (outcome === 'resolve') old.resolve(response(docs))
    else old.reject(new Error('retired failure'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(controller.footerLinks.value).toEqual(policy)
    expect(controller.loading.value).toBe(true)
    expect(controller.error.value).toBe(false)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
    fresh.resolve(response({ links: [] })); await pending
    expect(controller.footerLinks.value).toEqual({ links: [] })
    expect(controller.loading.value).toBe(false)
  })
  it.each(['resolve', 'reject'] as const)('does not resurrect old data after unmount and remount when the old read will %s', async outcome => {
    const old = createDeferred<Response>(), fresh = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise))
    client.setQueryData(publicFooterLinksKey, docs)
    mount().unmount(); mount()
    expect(controller.footerLinks.value).toEqual({ links: [] })
    expect(controller.loading.value).toBe(true)
    if (outcome === 'resolve') old.resolve(response(docs))
    else old.reject(new Error('retired failure'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(controller.footerLinks.value).toEqual({ links: [] })
    expect(controller.loading.value).toBe(true)
    fresh.resolve(response(policy))
    await waitFor(() => expect(controller.footerLinks.value).toEqual(policy))
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
  })
  it('guards the await continuation when a save is published inside a successful cache notification', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(docs)))
    let committed = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!committed && event.query.queryKey[0] === 'footer-links' && event.query.state.data) {
        committed = true; publishFooterLinks(client, policy)
      }
    })
    mount()
    await waitFor(() => expect(controller.footerLinks.value).toEqual(policy))
    expect(controller.loading.value).toBe(false)
    expect(controller.error.value).toBe(false)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
    unsubscribe()
  })
  it('retains a publication between a completed query response and its awaiting continuation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(docs)))
    const actualFetch = client.fetchQuery.bind(client)
    // Observe the real, unmodified promise before the reader registers its await.
    const observe = (options: Parameters<typeof client.fetchQuery>[0]) => {
      const pending = actualFetch(options)
      void pending.then(() => publishFooterLinks(client, policy))
      return pending
    }
    vi.spyOn(client, 'fetchQuery').mockImplementation(observe as typeof client.fetchQuery)
    mount()
    await waitFor(() => expect(controller.footerLinks.value).toEqual(policy))
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
    expect(controller.loading.value).toBe(false); expect(controller.error.value).toBe(false)
  })
  it('keeps a newer publication when a failure cache notification publishes synchronously', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    let committed = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!committed && event.query.queryKey[0] === 'footer-links' && event.query.state.data) {
        committed = true; publishFooterLinks(client, policy)
      }
    })
    mount()
    await waitFor(() => expect(controller.footerLinks.value).toEqual(policy))
    expect(controller.error.value).toBe(false)
    expect(controller.loading.value).toBe(false)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
    unsubscribe()
  })
  it('keeps a publication between a completed query rejection and its awaiting catch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const actualFetch = client.fetchQuery.bind(client)
    const observe = (options: Parameters<typeof client.fetchQuery>[0]) => {
      const pending = actualFetch(options)
      void pending.catch(() => publishFooterLinks(client, policy))
      return pending
    }
    vi.spyOn(client, 'fetchQuery').mockImplementation(observe as typeof client.fetchQuery)
    mount()
    await waitFor(() => expect(controller.footerLinks.value).toEqual(policy))
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(policy)
    expect(controller.error.value).toBe(false); expect(controller.loading.value).toBe(false)
  })
  it('treats a malformed public management projection as a current failure, not public data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...docs, updatedAt: '2026-10-30T00:00:00Z' })))
    mount()
    await waitFor(() => expect(controller.error.value).toBe(true))
    expect(controller.footerLinks.value).toEqual({ links: [] })
  })
})
