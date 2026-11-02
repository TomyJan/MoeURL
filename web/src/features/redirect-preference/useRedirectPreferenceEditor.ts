import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { redirectModes, updateRedirectPreference, type RedirectPreference, type UpdateRedirectPreferenceInput } from '@/entities/redirect-preference/api'
import { useRedirectPreference } from '@/shared/preferences/useRedirectPreference'
import { ApiClientError } from '@/shared/api/client'
import type { RedirectMode } from '@/entities/short-link/model'
import type { UserResponse } from '@/entities/auth/api'

/** An editor owns its draft, revision and queued sends independently of other personal settings. */
export function useRedirectPreferenceEditor(props: { userId: string; active: boolean; permissions: readonly string[] }, t: (key: string) => string) {
  const client = useQueryClient()
  const resource = useRedirectPreference(computed(() => props.active && !!props.userId))
  const { scope, isCurrent, query, preference, readError, publish } = resource
  const original = shallowRef<RedirectPreference>()
  const draft = ref('')
  const editRevision = ref(0)
  const pending = ref(false)
  const reloading = ref(false)
  const conflict = ref(false)
  const invalid = ref(false)
  let alive = true
  let generation = 0
  const eligible = computed(() => props.active && !!props.userId && scope.value.userId === props.userId)
  const busy = computed(() => pending.value || reloading.value || query.isFetching.value)
  const locked = computed(() => !eligible.value || !original.value || busy.value || readError.value || conflict.value)
  const draftSchema = z.union([z.literal(''), z.enum(redirectModes)])
  /** Clearing and direct need no enhanced capability; saved modes never grant their own permission. */
  function allowed(mode: string | null, permissions = props.permissions) {
    return mode === null || mode === '' || mode === 'direct' || permissions.includes(mode === 'intermediate' ? 'short_link:use_intermediate' : 'short_link:use_confirmation')
  }
  const unavailable = computed(() => !!original.value?.redirectMode && !allowed(original.value.redirectMode))
  type Intent = { owner: typeof scope.value; generation: number; input: UpdateRedirectPreferenceInput }
  const owns = (intent: Pick<Intent, 'owner' | 'generation'>) => alive && eligible.value && isCurrent(intent.owner) && generation === intent.generation
  const mutation = useMutation({
    retry: false,
    /** Rechecks the captured owner and current cached authority when an offline intent actually sends. */
    mutationFn(intent: Intent) {
      // TanStack may resume an offline mutation after a different identity is active.
      const currentUser = client.getQueryData<UserResponse>(['auth', 'me'])?.user
      if (!owns(intent) || !currentUser || client.getQueryState(['auth', 'me'])?.status === 'error' || !allowed(intent.input.redirectMode) || !allowed(intent.input.redirectMode, currentUser.permissions)) return Promise.reject(new Error('Redirect preference intent expired'))
      return updateRedirectPreference(intent.input, intent.owner.userId)
    },
  })
  onBeforeUnmount(() => { alive = false; generation++ })
  watch([scope, () => props.userId], () => {
    generation++; original.value = undefined; draft.value = ''; editRevision.value++; pending.value = false; reloading.value = false; conflict.value = false; invalid.value = false; mutation.reset()
  }, { flush: 'sync' })
  watch(eligible, value => {
    if (!value) { generation++; pending.value = false; reloading.value = false; mutation.reset() }
    else {
      const intent = { owner: scope.value, generation }
      // Wait for the observer to move to its new identity key before rereading.
      void nextTick().then(() => { if (owns(intent)) void query.refetch() })
    }
  }, { flush: 'sync' })
  watch([preference, eligible], ([value]) => {
    if (!value || !eligible.value || pending.value || reloading.value) return
    if (!original.value) adopt(value)
    else if (original.value.updatedAt !== value.updatedAt) conflict.value = true
  }, { immediate: true })
  /** Replaces both the confirmed CAS baseline and its draft after an authorized adoption. */
  function adopt(value: RedirectPreference) { original.value = value; draft.value = value.redirectMode ?? ''; conflict.value = false; invalid.value = false }
  /** Records user edits so pending reads and saves cannot replace a newer draft. */
  function edit(value: string) { draft.value = value; editRevision.value++; invalid.value = false }
  /** Ordinary retries preserve an existing CAS baseline; only explicit discard adopts a changed version. */
  async function reload(discard: boolean) {
    if (!eligible.value || busy.value) return
    const intent = { owner: scope.value, generation }
    const revision = editRevision.value
    reloading.value = true
    try {
      const result = await query.refetch({ throwOnError: true })
      if (!owns(intent) || !result.data || result.data.userId !== intent.owner.userId || result.data.epoch !== intent.owner.epoch) return
      if (discard || !original.value) {
        if (revision === editRevision.value) adopt(result.data.preference)
        else { original.value = result.data.preference; conflict.value = false }
      }
      else if (original.value.updatedAt !== result.data.preference.updatedAt) conflict.value = true
    } catch { /* The owned read error offers retry while preserving the draft. */ }
    finally { if (owns(intent)) reloading.value = false }
  }
  /** Saves the captured draft/version once, publishing feedback only to its surviving owner and generation. */
  async function submit() {
    if (locked.value) return
    const parsed = draftSchema.safeParse(draft.value)
    if (!parsed.success || !allowed(parsed.data)) { invalid.value = true; return }
    const intent: Intent = { owner: scope.value, generation, input: { redirectMode: parsed.data === '' ? null : parsed.data as RedirectMode, expectedUpdatedAt: original.value!.updatedAt } }
    const revision = editRevision.value
    pending.value = true
    try {
      const saved = await mutation.mutateAsync(intent)
      if (!owns(intent)) return
      original.value = saved; conflict.value = false; publish(intent.owner, saved)
      if (revision === editRevision.value) adopt(saved)
      toast.success(t('redirectPreference.saved'))
    } catch (error) {
      if (!owns(intent)) return
      conflict.value = error instanceof ApiClientError && error.code === 300104
      toast.error(t(conflict.value ? 'redirectPreference.conflict' : error instanceof ApiClientError && error.code === 120001 ? 'redirectPreference.unavailable' : 'redirectPreference.saveFailed'))
    } finally { if (owns(intent)) pending.value = false }
  }
  return { eligible, query, original, draft, pending, busy, locked, readError, conflict, invalid, unavailable, allowed, edit, reload, submit }
}
