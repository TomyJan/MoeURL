import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { hashKey, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { UserResponse } from '@/entities/auth/api'
import { noteIdSchema } from '@/entities/short-link/note'
import type { ShortLinkListExportContext } from '@/entities/short-link/list-export'
import { exportSelectedShortLinkList } from '@/entities/short-link/selected-list-export'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { ApiClientError } from '@/shared/api/client'
import { downloadCsv } from '@/shared/download/csv'

interface SelectedListExportOptions {
  access: ReturnType<typeof useShortLinkAccess>
  context: Readonly<Ref<ShortLinkListExportContext>>
  queryKey: Readonly<Ref<readonly unknown[]>>
  selection: Readonly<Ref<readonly string[]>>
  collection: Readonly<Ref<unknown>>
  blocked: Readonly<Ref<boolean>>
  canStart?: () => boolean
}

/** Downloads only a complete live selection, retiring callbacks on every relevant synchronous transition. */
export function useSelectedListExport(options: SelectedListExportOptions) {
  const client = useQueryClient()
  const { t } = useI18n()
  const pending = ref(false), cacheRevision = ref(0)
  let alive = true, generation = 0
  let controller: AbortController | undefined
  /** Cancels this generation without allowing its finally to release a later request. */
  function retire() { generation++; controller?.abort(); controller = undefined; pending.value = false }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' && event.type !== 'removed') return
    if ((event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me')
      || hashKey(event.query.queryKey) === hashKey(options.queryKey.value)) {
      cacheRevision.value++
      retire()
    }
  })
  watch([options.context, options.queryKey, options.selection, options.collection, options.blocked,
    options.access.identity.scope, () => options.canStart?.()], retire, { flush: 'sync', deep: true })
  onBeforeUnmount(() => { alive = false; unsubscribe(); retire() })
  const visible = computed(() => {
    void cacheRevision.value
    const auth = client.getQueryState<UserResponse>(['auth', 'me'])
    const user = auth?.data?.user
    if (auth?.status !== 'success' || !user || user.group === 'guest' || user.username === 'guest' || !noteIdSchema.safeParse(user.id).success) return false
    const grants = user.permissions
    return grants.includes('short_link:export') && (options.context.value === 'own'
      ? grants.includes('short_link:read_own') : grants.includes('admin:access') && grants.includes('short_link:read_all'))
  })
  const page = computed(() => {
    void cacheRevision.value
    const state = client.getQueryState<{ items: { id: string }[] }>(options.queryKey.value)
    return state?.status === 'success' && state.fetchStatus === 'idle' && !state.isInvalidated ? state.data : undefined
  })
  const targets = computed(() => {
    const items = page.value?.items, selected = options.selection.value
    if (!items || items.length < 1 || items.length > 100 || selected.length < 1 || selected.length > 100 || new Set(selected).size !== selected.length) return undefined
    const ids = items.map(item => item.id)
    if (ids.some(id => !noteIdSchema.safeParse(id).success) || new Set(ids).size !== ids.length
      || selected.some(id => !noteIdSchema.safeParse(id).success)) return undefined
    return [...selected]
  })
  const disabled = computed(() => pending.value || !visible.value || options.blocked.value || (options.canStart !== undefined && !options.canStart()) || !targets.value)

  /** Pins identity, page and generation before acquiring the independent export lock. */
  async function submit() {
    if (!alive || disabled.value) return
    const scope = options.access.identity.scope.value, ownGeneration = generation
    const snapshot = page.value, key = hashKey(options.queryKey.value)
    const ids = targets.value!, context = options.context.value
    const request = new AbortController()
    controller = request
    /** Rechecks the synchronous cache before and after the parent has rendered pending changes. */
    const current = () => alive && generation === ownGeneration && options.access.identity.isCurrent(scope)
      && visible.value && !options.blocked.value && (options.canStart === undefined || options.canStart())
      && hashKey(options.queryKey.value) === key && page.value === snapshot
    pending.value = true
    try {
      const file = await exportSelectedShortLinkList({ ids }, context, scope.userId, request.signal)
      if (!current()) return
      await nextTick()
      if (!current()) return
      downloadCsv(file)
      toast.success(t('listExport.started'))
    } catch (error) {
      if (!current()) return
      await nextTick()
      if (current()) toast.error(t(error instanceof ApiClientError && error.code === 200118 ? 'selectedListExport.limitExceeded' : 'listExport.failed'))
    } finally {
      if (alive && generation === ownGeneration) { pending.value = false; controller = undefined }
    }
  }
  return { visible, disabled, pending, submit }
}

export type SelectedListExportState = ReturnType<typeof useSelectedListExport>
