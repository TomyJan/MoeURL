import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
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
  function allows(action: 'read' | 'update' | 'delete', response = client.getQueryData<UserResponse>(['auth', 'me'])) {
    const user = response?.user
    if (!user?.id || user.group === 'guest' || user.username === 'guest') return false
    const permissions = user.permissions
    const suffix = context === 'own' ? 'own' : 'all'
    return (context === 'own' || permissions.includes('admin:access'))
      && permissions.includes(`short_link:read_${suffix}`)
      && permissions.includes(`short_link:${action}_${suffix}`)
  }
  const canRead = computed(() => auth.isSuccess.value && allows('read', auth.data.value))
  const canUpdate = computed(() => auth.isSuccess.value && allows('update', auth.data.value))
  const canDelete = computed(() => auth.isSuccess.value && allows('delete', auth.data.value))
  const canSelect = computed(() => canUpdate.value || canDelete.value)
  return { identity, canRead, canUpdate, canDelete, canSelect, allows, authPending: auth.isPending }
}

interface BatchOptions {
  context: 'own' | 'admin'
  access: ReturnType<typeof useShortLinkAccess>
  ids: Ref<string[]>
  blocked: Ref<boolean>
  filters: Ref<unknown>
}

/** Keeps selection local to one visible list and pins every write to its initiating context. */
export function useShortLinkBatch(options: BatchOptions) {
  const { t } = useI18n()
  const client = useQueryClient()
  const { access } = options
  const selected = ref<string[]>([])
  const deleteIds = ref<string[] | null>(null)
  const pending = ref(false)
  const unavailable = computed(() => pending.value || options.blocked.value || !access.canSelect.value)
  const allSelected = computed(() => options.ids.value.length > 0 && options.ids.value.every(id => selected.value.includes(id)))
  const indeterminate = computed(() => selected.value.length > 0 && !allSelected.value)
  let revision = 0
  let alive = true
  /** Drops context-bound targets without releasing a request that is still outstanding. */
  function clear() { revision++; selected.value = []; deleteIds.value = null }
  watch([options.filters, access.identity.scope, access.canSelect], clear, { flush: 'sync' })
  watch(options.ids, ids => { selected.value = selected.value.filter(id => ids.includes(id)) }, { flush: 'sync' })
  onBeforeUnmount(() => { alive = false; clear() })

  /** Changes only current-list IDs and never grows a selection past the API limit. */
  function toggle(id: string, checked: boolean) {
    if (unavailable.value || !options.ids.value.includes(id)) return
    if (!checked) selected.value = selected.value.filter(value => value !== id)
    else if (!selected.value.includes(id) && selected.value.length < 100) selected.value = [...selected.value, id]
  }
  /** Selects at most the first 100 distinct records currently returned by the list. */
  function toggleAll(checked: boolean) {
    if (!unavailable.value) selected.value = checked ? [...new Set(options.ids.value)].slice(0, 100) : []
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
  return { selected, deleteIds, pending, unavailable, allSelected, indeterminate, toggle, toggleAll, openDelete, closeDelete, confirmDelete, submit, clear }
}
