import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { updateListPreference, type ListPreference, type UpdateListPreferenceInput } from '@/entities/list-preference/api'
import { useListPreference } from '@/shared/preferences/useListPreference'
import { ApiClientError } from '@/shared/api/client'
import { isShortLinkPageSize } from '@/features/short-link-pagination/pageSize'
import type { UserResponse } from '@/entities/auth/api'

/** Owns an independent draft and CAS baseline for the current personal settings panel. */
export function useListPreferenceEditor(props: { userId: string; active: boolean }, t: (key: string) => string) {
  const client = useQueryClient()
  const resource = useListPreference(computed(() => props.active && !!props.userId))
  const { scope, isCurrent, query, preference, readError, publish } = resource
  const original = shallowRef<ListPreference>()
  const draft = ref('')
  const pending = ref(false)
  const reloading = ref(false)
  const conflict = ref(false)
  const invalid = ref(false)
  let editRevision = 0
  let alive = true
  let generation = 0
  const eligible = computed(() => props.active && !!props.userId && scope.value.userId === props.userId)
  const busy = computed(() => pending.value || reloading.value || query.isFetching.value)
  const locked = computed(() => !eligible.value || !original.value || busy.value || readError.value || conflict.value)
  type Intent = { owner: typeof scope.value; generation: number; input: UpdateListPreferenceInput }
  const owns = (intent: Pick<Intent, 'owner' | 'generation'>) => alive && eligible.value && isCurrent(intent.owner) && generation === intent.generation
  const mutation = useMutation({
    retry: false,
    /** A queued offline save must still belong to an active, confirmed Cookie identity when it sends. */
    mutationFn(intent: Intent) {
      const user = client.getQueryData<UserResponse>(['auth', 'me'])?.user
      if (!owns(intent) || !user || user.id !== intent.owner.userId || user.group === 'guest' || user.username === 'guest' || client.getQueryState(['auth', 'me'])?.status === 'error') return Promise.reject(new Error('List preference intent expired'))
      return updateListPreference(intent.input, intent.owner.userId)
    },
  })
  onBeforeUnmount(() => { alive = false; generation++ })
  watch([scope, () => props.userId], () => {
    generation++; original.value = undefined; draft.value = ''; editRevision = 0; pending.value = false; reloading.value = false; conflict.value = false; invalid.value = false; mutation.reset()
  }, { flush: 'sync' })
  watch(eligible, value => {
    if (!value) { generation++; pending.value = false; reloading.value = false; mutation.reset() }
    else {
      const intent = { owner: scope.value, generation }
      void nextTick().then(() => { if (owns(intent)) void query.refetch() })
    }
  }, { flush: 'sync' })
  watch([preference, eligible], ([value]) => {
    if (!value || !eligible.value || pending.value || reloading.value) return
    if (!original.value) {
      original.value = value
      if (editRevision === 0) draft.value = value.pageSize === null ? '' : String(value.pageSize)
    } else if (original.value.updatedAt !== value.updatedAt) conflict.value = true
  }, { immediate: true })
  /** Explicit adoption replaces the baseline and draft together. */
  function adopt(value: ListPreference) {
    original.value = value; draft.value = value.pageSize === null ? '' : String(value.pageSize); conflict.value = false; invalid.value = false
  }
  /** Edits stay local, including edits made while a previous load or save is outstanding. */
  function edit(value: string) { draft.value = value; editRevision++; invalid.value = false }
  /** Only explicit discard may replace an existing draft after a conflict. */
  async function reload(discard: boolean) {
    if (!eligible.value || busy.value) return
    const intent = { owner: scope.value, generation }
    const revision = editRevision
    reloading.value = true
    try {
      const result = await query.refetch({ throwOnError: true })
      if (!owns(intent) || !result.data || result.data.userId !== intent.owner.userId || result.data.epoch !== intent.owner.epoch) return
      if (discard || !original.value) {
        if (revision === editRevision) adopt(result.data.preference)
        else { original.value = result.data.preference; conflict.value = false }
      } else if (original.value.updatedAt !== result.data.preference.updatedAt) conflict.value = true
    } catch { /* The owned read error exposes retry without discarding the draft. */ }
    finally { if (owns(intent)) reloading.value = false }
  }
  /** Captures one explicit draft/version; old outcomes cannot touch a new identity or operation. */
  async function submit() {
    if (locked.value) return
    const size = draft.value === '' ? null : Number(draft.value)
    if (size !== null && (!isShortLinkPageSize(size) || String(size) !== draft.value)) { invalid.value = true; return }
    const intent: Intent = { owner: scope.value, generation, input: { pageSize: size, expectedUpdatedAt: original.value!.updatedAt } }
    const revision = editRevision
    pending.value = true
    try {
      const saved = await mutation.mutateAsync(intent)
      if (!owns(intent)) return
      original.value = saved; conflict.value = false; publish(intent.owner, saved)
      if (revision === editRevision) adopt(saved)
      toast.success(t('listPreference.saved'))
    } catch (error) {
      if (!owns(intent)) return
      conflict.value = error instanceof ApiClientError && error.code === 300104
      toast.error(t(conflict.value ? 'listPreference.conflict' : error instanceof ApiClientError && error.code === 120001 ? 'listPreference.unavailable' : 'listPreference.saveFailed'))
    } finally { if (owns(intent)) pending.value = false }
  }
  return { eligible, query, original, draft, pending, busy, locked, readError, conflict, invalid, edit, reload, submit }
}
