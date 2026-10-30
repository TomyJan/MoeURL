import { onScopeDispose, ref } from 'vue'
import { QueryClient, useQueryClient } from '@tanstack/vue-query'
import { getPublicFooterLinks, publicFooterLinksKey, type FooterLinks } from '@/entities/footer-links/api'

const coordinators = new WeakMap<QueryClient, ReturnType<typeof createCoordinator>>()
/** Shares public navigation reads and management publications within one app. */
function createCoordinator(client: QueryClient) {
  const footerLinks = ref<FooterLinks>({ links: [] })
  const loading = ref(false), error = ref(false)
  let generation = 0
  /** Retires every old continuation before cancellation can synchronously notify. */
  function retire() {
    generation++
    void client.cancelQueries({ queryKey: publicFooterLinksKey, exact: true })
  }
  /** Keeps the last success only while pending; current failures clear navigation. */
  async function read() {
    retire()
    const token = generation
    loading.value = true; error.value = false
    try {
      const value = await client.fetchQuery({ queryKey: publicFooterLinksKey, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getPublicFooterLinks()
          if (token !== generation) throw new Error('Obsolete footer links read')
          return value
        },
      })
      if (token === generation) footerLinks.value = value
    } catch {
      if (token === generation) {
        client.setQueryData(publicFooterLinksKey, { links: [] })
        if (token === generation) { footerLinks.value = { links: [] }; error.value = true }
      }
    } finally {
      if (token === generation) loading.value = false
    }
  }
  /** Publishes a current management server result without permitting old cache writes. */
  function publish(value: FooterLinks) {
    retire()
    client.setQueryData(publicFooterLinksKey, value)
    footerLinks.value = value; loading.value = false; error.value = false
  }
  return { footerLinks, loading, error, read, publish, retire }
}
/** Obtains state without starting public reads from a private editor. */
function coordinator(client: QueryClient) {
  let value = coordinators.get(client)
  if (!value) { value = createCoordinator(client); coordinators.set(client, value) }
  return value
}
/** Applies only an identity-guarded, successfully saved server projection. */
export function publishFooterLinks(client: QueryClient, value: FooterLinks) {
  coordinator(client).publish(value)
}
/** Starts empty on every mount and performs an actual current public read. */
export function useSiteFooterLinks() {
  const state = coordinator(useQueryClient())
  state.footerLinks.value = { links: [] }
  void state.read()
  onScopeDispose(state.retire)
  return state
}
