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
  selection?: Readonly<Ref<readonly string[]>>
  selectionItems?: Readonly<Ref<readonly SelectionCopyItem[]>>
  format?: 'markdown'
  lock?: Ref<symbol | null>
}
type SelectionCopyItem = Pick<ShortLinkListResponse['items'][number], 'id' | 'url'>
  & Partial<Pick<ShortLinkListResponse['items'][number], 'title'>>

/** Copies only the currently authorized, successful page without reading another server resource. */
export function usePageLinksCopy(options: PageLinksCopyOptions) {
  const client = useQueryClient()
  const { t } = useI18n()
  const pending = ref(false)
  const cacheRevision = ref(0)
  let generation = 0
  let alive = true
  const owner = Symbol('links-copy')
  /** Releases only this instance's ownership, never another copy's outstanding attempt. */
  function release() { if (options.lock?.value === owner) options.lock.value = null }
  /** Retires old callbacks while allowing a new context to start its own explicit copy. */
  function retire() { generation++; pending.value = false; release() }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' && event.type !== 'removed') return
    if ((event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me')
      || hashKey(event.query.queryKey) === hashKey(options.queryKey.value)) {
      cacheRevision.value++
      retire()
    }
  })
  watch([options.queryKey, options.context, options.blocked, options.access.identity.scope], retire, { flush: 'sync', deep: true })
  if (options.selection) watch(options.selection, retire, { flush: 'sync', deep: true })
  onBeforeUnmount(() => { alive = false; unsubscribe(); retire() })
  const page = computed(() => {
    void cacheRevision.value
    const state = client.getQueryState<ShortLinkListResponse>(options.queryKey.value)
    return state?.status === 'success' && state.fetchStatus === 'idle' && !state.isInvalidated ? state.data : undefined
  })
  const visible = computed(() => options.access.canRead.value)
  const targets = computed(() => {
    const currentPage = page.value
    if (!currentPage || (options.format === 'markdown' && !options.selection)) return undefined
    const currentPageIds = currentPage.items.map(link => link.id)
    if (currentPage.items.length < 1 || currentPage.items.length > 100
      || currentPageIds.some(id => !id) || new Set(currentPageIds).size !== currentPageIds.length) return undefined
    if (!options.selection) return currentPage.items
    const ids = options.selection.value
    if (ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !id)) return undefined
    const items = options.selectionItems?.value ?? currentPage.items.filter(link => ids.includes(link.id))
    const itemIds = items.map(link => link.id)
    if (items.length !== ids.length || itemIds.some(id => !id) || new Set(itemIds).size !== itemIds.length
      || ids.some(id => !itemIds.includes(id))) return undefined
    const byId = new Map(items.map(link => [link.id, link]))
    if (ids.every(id => currentPageIds.includes(id))) return currentPage.items.filter(link => ids.includes(link.id))
    return ids.map(id => byId.get(id)!)
  })
  const disabled = computed(() => pending.value || options.blocked.value || !visible.value || !options.access.allows('read')
    || options.lock?.value != null || !targets.value
    || targets.value.some(link => !/^https?:\/\//.test(link.url) || /\p{Cc}/u.test(link.url)
      || (options.format === 'markdown' && (typeof link.title !== 'string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(link.title)))))

  /** Calls Clipboard before the first await so the browser retains the direct user activation. */
  async function copy() {
    if (!alive || disabled.value) return
    const scope = options.access.identity.scope.value
    const ownGeneration = generation
    const key = hashKey(options.queryKey.value)
    const snapshot = page.value!
    const links = targets.value!
    const text = links.map(link => {
      if (options.format !== 'markdown') return link.url
      const label = (link.title || link.url).replace(/&/g, '&amp;').replace(/[\\`*_[\]{}()#+.!|<>~-]/g, '\\$&')
      const destination = link.url.replace(/[\\<> ]/g, character => encodeURIComponent(character))
      return `- [${label}](<${destination}>)`
    }).join('\n')
    /** Suppresses only late interface feedback; an accepted OS clipboard write cannot be revoked. */
    const current = () => alive && generation === ownGeneration && options.access.identity.isCurrent(scope)
      && options.access.canRead.value && options.access.allows('read') && !options.blocked.value
      && hashKey(options.queryKey.value) === key && page.value === snapshot
      && (!options.lock || options.lock.value === owner)
    if (options.lock) options.lock.value = owner
    pending.value = true
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      await nextTick()
      if (current()) toast.success(t(options.format === 'markdown' ? 'selectedMarkdownCopy.copied' : options.selection ? 'selectedLinksCopy.copied' : 'pageLinksCopy.copied', { count: links.length }, links.length))
    } catch {
      await nextTick()
      if (current()) toast.error(t('pageLinksCopy.failed'))
    } finally {
      if (alive && generation === ownGeneration) { pending.value = false; release() }
    }
  }
  return { visible, disabled, pending, copy }
}

export type PageLinksCopyState = ReturnType<typeof usePageLinksCopy>
