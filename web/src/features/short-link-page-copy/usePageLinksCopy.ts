import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { hashKey, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { ShortLinkListResponse } from '@/entities/short-link/api'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

interface PageLinksCopyOptions {
  access: ReturnType<typeof useShortLinkAccess>
  queryKey: Readonly<Ref<readonly unknown[]>>
  blocked: Readonly<Ref<boolean>>
  context: Readonly<Ref<unknown>>
}

/** Copies only the currently authorized, successful page without reading another server resource. */
export function usePageLinksCopy(options: PageLinksCopyOptions) {
  const client = useQueryClient()
  const { t } = useI18n()
  const pending = ref(false)
  const cacheRevision = ref(0)
  let generation = 0
  let alive = true
  /** Retires old callbacks while allowing a new context to start its own explicit copy. */
  function retire() { generation++; pending.value = false }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' && event.type !== 'removed') return
    if ((event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me')
      || hashKey(event.query.queryKey) === hashKey(options.queryKey.value)) {
      cacheRevision.value++
      retire()
    }
  })
  watch([options.queryKey, options.context, options.blocked, options.access.identity.scope], retire, { flush: 'sync', deep: true })
  onBeforeUnmount(() => { alive = false; unsubscribe(); retire() })
  const page = computed(() => {
    void cacheRevision.value
    const state = client.getQueryState<ShortLinkListResponse>(options.queryKey.value)
    return state?.status === 'success' && state.fetchStatus === 'idle' && !state.isInvalidated ? state.data : undefined
  })
  const visible = computed(() => options.access.canRead.value)
  const disabled = computed(() => pending.value || options.blocked.value || !visible.value || !options.access.allows('read')
    || !page.value || page.value.items.length < 1 || page.value.items.length > 100
    || page.value.items.some(link => !/^https?:\/\//.test(link.url) || /\p{Cc}/u.test(link.url)))

  /** Calls Clipboard before the first await so the browser retains the direct user activation. */
  async function copy() {
    if (!alive || disabled.value) return
    const scope = options.access.identity.scope.value
    const ownGeneration = generation
    const key = hashKey(options.queryKey.value)
    const snapshot = page.value!
    const urls = snapshot.items.map(link => link.url)
    /** Suppresses only late interface feedback; an accepted OS clipboard write cannot be revoked. */
    const current = () => alive && generation === ownGeneration && options.access.identity.isCurrent(scope)
      && options.access.canRead.value && options.access.allows('read') && !options.blocked.value
      && hashKey(options.queryKey.value) === key && page.value === snapshot
    pending.value = true
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(urls.join('\n'))
      await nextTick()
      if (current()) toast.success(t('pageLinksCopy.copied', { count: urls.length }, urls.length))
    } catch {
      await nextTick()
      if (current()) toast.error(t('pageLinksCopy.failed'))
    } finally {
      if (alive && generation === ownGeneration) pending.value = false
    }
  }
  return { visible, disabled, pending, copy }
}

export type PageLinksCopyState = ReturnType<typeof usePageLinksCopy>
