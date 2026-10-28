import { computed, onBeforeUnmount, reactive, shallowRef, watch, type Ref } from 'vue'
import type { UserSummary } from '@/entities/user/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { batchChangeUserGroup } from '@/entities/user/batch-group'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ApiClientError } from '@/shared/api/client'
import { useQueryClient } from '@tanstack/vue-query'
import { me } from '@/entities/auth/api'

interface BatchOptions {
  users: Ref<UserSummary[]>
  allowed: Ref<boolean>
  blocked: Ref<boolean>
  onSelect: () => void
  read: () => Promise<unknown>
}

/** Creates private UI state for one identity; old requests may finish only against their old state. */
function createBatchState() {
  return reactive({ selected: [] as string[], snapshot: null as UserSummary[] | null, pending: false, barrier: false, authRequired: false })
}

/** Selects only eligible visible accounts and pins the exact opening versions for confirmation. */
export function useUserBatchGroupChange(options: BatchOptions) {
  const { t } = useI18n()
  const identity = useAccountIdentity()
  const client = useQueryClient()
  let alive = true
  const state = shallowRef(createBatchState())
  const eligible = computed(() => options.users.value.filter(item => !item.builtin && item.id !== identity.scope.value.userId && (item.group === 'user' || item.group === 'admin')))
  const selected = computed(() => state.value.selected)
  const snapshot = computed(() => state.value.snapshot)
  const pending = computed(() => state.value.pending)
  const barrier = computed(() => state.value.barrier)
  const unavailable = computed(() => !options.allowed.value || options.blocked.value || pending.value || barrier.value)
  const allSelected = computed(() => eligible.value.length > 0 && eligible.value.every(item => selected.value.includes(item.id)))
  const indeterminate = computed(() => selected.value.length > 0 && !allSelected.value)
  watch([identity.scope, options.allowed], () => { state.value = createBatchState() }, { flush: 'sync' })
  watch([eligible, snapshot], ([items, frozen]) => { if (!frozen && !pending.value) state.value.selected = selected.value.filter(id => items.some(item => item.id === id)) }, { flush: 'sync' })
  onBeforeUnmount(() => { alive = false; state.value = createBatchState() })

  /** Requires a genuinely successful current-identity read before enabling another write. */
  async function reload() {
    const current = state.value
    const scope = identity.scope.value
    current.barrier = true
    try {
      if (current.authRequired) {
        const response = await me()
        if (!alive || state.value !== current || !identity.isCurrent(scope)) return
        current.authRequired = false
        client.setQueryData(['auth', 'me'], response)
        if (state.value !== current || !options.allowed.value) return
      }
      await options.read()
      if (alive && state.value === current && identity.isCurrent(scope) && options.allowed.value) current.barrier = false
    } catch { /* The persistent barrier offers an explicit read retry without replaying the write. */ }
  }

  /** Submits the immutable opening versions once and releases controls only after committed readback. */
  async function submit(groupKey: 'user' | 'admin') {
    const current = state.value
    const scope = identity.scope.value
    if (unavailable.value || !current.snapshot || !current.snapshot.some(item => item.group !== groupKey)) return
    current.pending = true
    try {
      const result = await batchChangeUserGroup({ items: current.snapshot.map(item => ({ id: item.id, expectedUpdatedAt: item.updatedAt })), groupKey })
      if (!alive || state.value !== current || !identity.isCurrent(scope) || !options.allowed.value) return
      toast.success(t('batchMembership.success', { changed: result.changedCount, unchanged: result.unchangedCount }))
      current.snapshot = null
      current.selected = []
      await reload()
    } catch (error) {
      if (!alive || state.value !== current || !identity.isCurrent(scope) || !options.allowed.value) return
      if (error instanceof ApiClientError && [120001, 401, 403].includes(error.code)) {
        current.snapshot = null
        current.selected = []
        current.barrier = true
        current.authRequired = true
        toast.error(t('batchMembership.denied'))
        await reload()
      } else if (error instanceof ApiClientError && ([300105, 300103, 300102, 300106].includes(error.code)
        || (error.code === 100001 && !('status' in error.meta) && !error.meta.invalidBatchResponse))) {
        toast.error(t('batchMembership.rejected'))
        current.snapshot = null
        current.selected = []
        await reload()
      } else toast.error(t('batchMembership.failed'))
    } finally { current.pending = false }
  }

  /** Closes competing row panels before the first current-list selection, retaining same-identity drafts. */
  function toggle(id: string, checked: boolean) {
    if (unavailable.value || snapshot.value || !eligible.value.some(item => item.id === id)) return
    if (!checked) state.value.selected = selected.value.filter(value => value !== id)
    else if (!selected.value.includes(id) && selected.value.length < 100) {
      if (!selected.value.length) options.onSelect()
      state.value.selected = [...selected.value, id]
    }
  }
  /** Limits select-all to the currently visible eligible accounts and the server's batch cap. */
  function toggleAll(checked: boolean) {
    if (unavailable.value || snapshot.value) return
    if (checked && !selected.value.length && eligible.value.length) options.onSelect()
    state.value.selected = checked ? eligible.value.slice(0, 100).map(item => item.id) : []
  }
  /** Cancels selection only while no privileged attempt or required readback is outstanding. */
  function clear() { if (!pending.value && !barrier.value && !snapshot.value) state.value.selected = [] }
  /** Copies visible selected records once; subsequent list reads cannot replace this confirmation. */
  function open() {
    if (unavailable.value || snapshot.value || !selected.value.length) return
    state.value.snapshot = eligible.value.filter(item => selected.value.includes(item.id)).map(item => ({ ...item }))
  }
  /** Cancels the frozen draft and reconciles selection against the current eligible list. */
  function close() { if (!pending.value) state.value.snapshot = null }
  return { selected, snapshot, pending, barrier, unavailable, eligible, allSelected, indeterminate, toggle, toggleAll, clear, open, close, submit, reload }
}
