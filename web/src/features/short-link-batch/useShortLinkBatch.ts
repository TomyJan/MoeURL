import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { batchShortLinks, type BatchAction } from '@/entities/short-link/batch'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Shares the existing account epoch and confirmed permission view with private list reads. */
export function useShortLinkAccess(context: 'own' | 'admin') {
  const identity = useAccountIdentity()
  const client = useQueryClient()
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
  /** Rechecks the current cache rather than trusting a previous render's grants. */
  function allows(action: 'read' | 'update' | 'delete' | 'tags', response = client.getQueryData<UserResponse>(['auth', 'me'])) {
    const user = response?.user
    if (!user?.id || user.group === 'guest' || user.username === 'guest') return false
    const permissions = user.permissions
    const suffix = context === 'own' ? 'own' : 'all'
    return (context === 'own' || permissions.includes('admin:access'))
      && permissions.includes(`short_link:read_${suffix}`)
      && permissions.includes(`short_link:${action === 'tags' ? 'update' : action}_${suffix}`)
      && (action !== 'tags' || permissions.includes('short_link:set_metadata'))
  }
  const canRead = computed(() => auth.isSuccess.value && allows('read', auth.data.value))
  const canUpdate = computed(() => auth.isSuccess.value && allows('update', auth.data.value))
  const canDelete = computed(() => auth.isSuccess.value && allows('delete', auth.data.value))
  const canTag = computed(() => auth.isSuccess.value && allows('tags', auth.data.value))
  const canSelect = computed(() => canRead.value)
  const permissionScope = computed(() => {
    const user = auth.data.value?.user
    return user ? `${user.group}:${[...user.permissions].sort().join('\0')}` : ''
  })
  return { identity, canRead, canUpdate, canDelete, canTag, canSelect, permissionScope, allows, authPending: auth.isPending }
}

interface BatchOptions<T extends { id: string } = { id: string }> {
  context: 'own' | 'admin'
  access: ReturnType<typeof useShortLinkAccess>
  ids: Ref<string[]>
  items?: Ref<readonly T[]>
  pageKey: Ref<string>
  ready: Ref<boolean>
  blocked: Ref<boolean>
  filters: Ref<unknown>
}

/** Keeps selection local to one visible list and pins every write to its initiating context. */
export function useShortLinkBatch<T extends { id: string } = { id: string }>(options: BatchOptions<T>) {
  const { t } = useI18n()
  const client = useQueryClient()
  const { access } = options
  const selected = ref<string[]>([])
  const snapshots = shallowRef(new Map<string, T>())
  const pageItems = options.items ?? computed(() => options.ids.value.map(id => ({ id }) as T))
  const selectedItems = computed(() => selected.value.flatMap(id => {
    const item = snapshots.value.get(id)
    return item ? [item] : []
  }))
  const deleteIds = ref<string[] | null>(null)
  const pending = ref(false)
  const unavailable = computed(() => pending.value || options.blocked.value || !access.canSelect.value)
  const allSelected = computed(() => options.ids.value.length > 0 && options.ids.value.every(id => selected.value.includes(id)))
  const indeterminate = computed(() => options.ids.value.some(id => selected.value.includes(id)) && !allSelected.value)
  let revision = 0
  let alive = true
  let pageAwaitingRead = !options.ready.value
  let lastVisibleIds = options.ready.value ? [...new Set(options.ids.value)] : []
  /** Drops context-bound targets without releasing a request that is still outstanding. */
  function clear() { revision++; selected.value = []; deleteIds.value = null }
  watch([options.filters, access.identity.scope, access.canSelect, access.permissionScope], clear, { flush: 'sync' })
  watch(options.pageKey, () => {
    pageAwaitingRead = true
    lastVisibleIds = []
  }, { flush: 'sync' })
  watch([options.ready, options.ids], ([ready, ids]) => {
    if (!ready) return
    const visibleIds = [...new Set(ids)]
    if (pageAwaitingRead) {
      lastVisibleIds = visibleIds
      pageAwaitingRead = false
      return
    }
    const previousPageIds = new Set(lastVisibleIds)
    const nextPageIds = new Set(visibleIds)
    selected.value = selected.value.filter(id => !previousPageIds.has(id) || nextPageIds.has(id))
    lastVisibleIds = visibleIds
  }, { flush: 'sync' })
  /** Retains only authorized selection snapshots from pages already read in this filter scope. */
  watch([options.ready, pageItems, selected], ([ready, items, ids]) => {
    const selectedIds = new Set(ids)
    const next = new Map([...snapshots.value].filter(([id]) => selectedIds.has(id)))
    if (ready) for (const item of items) if (selectedIds.has(item.id)) next.set(item.id, item)
    if (next.size !== snapshots.value.size || [...next].some(([id, item]) => snapshots.value.get(id) !== item)) snapshots.value = next
  }, { flush: 'sync' })
  onBeforeUnmount(() => { alive = false; clear() })

  /** Changes only current-list IDs and never grows a selection past the API limit. */
  function toggle(id: string, checked: boolean) {
    if (unavailable.value || !options.ids.value.includes(id)) return
    if (!checked) selected.value = selected.value.filter(value => value !== id)
    else if (!selected.value.includes(id) && selected.value.length < 100) selected.value = [...selected.value, id]
  }
  /** Adds or removes only current-page IDs and rejects an over-limit addition atomically. */
  function toggleAll(checked: boolean) {
    if (unavailable.value) return
    const pageIds = [...new Set(options.ids.value)]
    if (!checked) {
      const currentIds = new Set(pageIds)
      selected.value = selected.value.filter(id => !currentIds.has(id))
      return
    }
    const combined = [...selected.value, ...pageIds.filter(id => !selected.value.includes(id))]
    if (combined.length > 100) {
      toast.error(t('batch.limit'))
      return
    }
    selected.value = combined
  }
  /** Captures the delete target once, independently of subsequent checkbox changes. */
  function openDelete() {
    if (!unavailable.value && access.allows('delete') && selected.value.length) deleteIds.value = [...selected.value]
  }
  /** Dismisses confirmation without altering the current selection. */
  function closeDelete() { deleteIds.value = null }
  /** Submits the fixed confirmation snapshot, including when selection has changed. */
  async function confirmDelete() {
    if (deleteIds.value) await submit('delete', deleteIds.value)
  }
  /** Performs one explicit attempt, suppressing late feedback after page, filter or identity changes. */
  async function submit(action: BatchAction, ids = selected.value) {
    if (unavailable.value || !ids.length || !access.allows(action === 'delete' ? 'delete' : 'update')) return
    const scope = access.identity.scope.value
    const requestRevision = revision
    const snapshot = [...ids]
    const isCurrent = () => alive && revision === requestRevision && access.identity.isCurrent(scope)
      && access.allows(action === 'delete' ? 'delete' : 'update')
    pending.value = true
    try {
      const result = await batchShortLinks({ ids: snapshot, action }, options.context)
      // Parent state may change in the same tick as the request settles.
      await nextTick()
      void client.invalidateQueries({ queryKey: ['short-link'] })
      void client.invalidateQueries({ queryKey: ['admin-short-link'] })
      if (!isCurrent()) return
      clear()
      toast.success(t('batch.success', { count: result.affectedCount }, result.affectedCount))
    } catch {
      await nextTick()
      if (isCurrent()) toast.error(t('batch.failed'))
    } finally { pending.value = false }
  }
  return { selected, selectedItems, deleteIds, pending, unavailable, allSelected, indeterminate, toggle, toggleAll, openDelete, closeDelete, confirmDelete, submit, clear }
}
