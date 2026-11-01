import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { batchCreateShortLinks, BulkCreateUnknownError, parseBulkCreateLines, type BulkCreateInput } from '@/entities/short-link/bulk-create'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Owns an in-memory batch, binding every asynchronous completion to current confirmed authority. */
export function useBulkCreate() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, retry: false, staleTime: Infinity })
  const { t } = useI18n()
  const opened = ref(false), draft = ref(''), pending = ref(false), unknown = ref(false), closing = ref(false), errorKey = ref('')
  const snapshot = shallowRef<BulkCreateInput | null>(null)
  let generation = 0, alive = true, scope = identity.scope.value
  const mutation = useMutation({ mutationFn: batchCreateShortLinks, retry: false })
  /** Reads the cache synchronously so batched renders cannot retain revoked grants. */
  function canUseNow() {
    const user = client.getQueryData<UserResponse>(['auth', 'me'])?.user
    return client.getQueryState(['auth', 'me'])?.status === 'success' && !!user?.id && user.group !== 'guest' && user.username !== 'guest'
      && user.permissions.includes('short_link:create') && user.permissions.includes('domain:use_default')
  }
  const allowed = computed(() => auth.isSuccess.value && !!auth.data.value?.user && auth.data.value.user.group !== 'guest'
    && auth.data.value.user.username !== 'guest' && !!auth.data.value.user.id
    && auth.data.value.user.permissions.includes('short_link:create') && auth.data.value.user.permissions.includes('domain:use_default'))
  /** Retires private input immediately, without letting old finally blocks unlock a newer batch. */
  function reset() {
    generation++; opened.value = false; draft.value = ''; snapshot.value = null; pending.value = false
    unknown.value = false; closing.value = false; errorKey.value = ''
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me' && (!identity.isCurrent(scope) || !canUseNow())) reset()
  })
  /** Opens a new draft only under the currently confirmed account and grants. */
  function begin() {
    if (!canUseNow() || pending.value) return
    reset(); scope = identity.scope.value; opened.value = true
  }
  /** Freezes one ordered payload before generating its unique request identifier. */
  function preview() {
    if (!opened.value || pending.value || unknown.value || !canUseNow()) return
    const parsed = parseBulkCreateLines(draft.value)
    if (!parsed.success) { errorKey.value = 'bulkCreate.invalid'; return }
    snapshot.value = Object.freeze({ requestId: crypto.randomUUID(), targetUrls: Object.freeze([...parsed.data]) })
    errorKey.value = ''
  }
  /** Allows changes only before an unknown result; another preview makes an explicit new batch. */
  function edit() { if (!pending.value && !unknown.value) { snapshot.value = null; errorKey.value = '' } }
  /** Checks both login epoch and the operation generation immediately before any side effect. */
  function isCurrent(token: number, candidate: typeof scope) { return alive && token === generation && identity.isCurrent(candidate) && canUseNow() }
  /** Sends exactly one explicit attempt; retry keeps the same immutable payload and key. */
  async function submit() {
    if (!opened.value || pending.value || closing.value || !snapshot.value || !isCurrent(generation, scope)) return
    const token = generation, candidate = scope, input = snapshot.value
    pending.value = true; errorKey.value = ''
    try {
      const result = await mutation.mutateAsync(input)
      await nextTick()
      if (!isCurrent(token, candidate)) return
      for (const key of ['short-link', 'short-link-overview']) void client.invalidateQueries({ queryKey: [key] })
      toast.success(t('bulkCreate.success', { count: result.createdCount }, result.createdCount)); reset()
    } catch (error) {
      await nextTick()
      if (!isCurrent(token, candidate)) return
      if (error instanceof ApiClientError && [120001, 401, 403].includes(error.code)) {
        toast.error(t('bulkCreate.accessChanged')); reset()
        void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
      } else {
        // A definite failure on a later attempt cannot disprove an earlier unknown commit.
        unknown.value = unknown.value || error instanceof BulkCreateUnknownError
        errorKey.value = unknown.value ? 'bulkCreate.unknown' : error instanceof ApiClientError && error.code === 200120 ? 'bulkCreate.conflict' : 'bulkCreate.failed'
      }
    } finally { if (isCurrent(token, candidate)) pending.value = false }
  }
  /** Keeps unknown batches visible until an explicit discard warning is acknowledged. */
  function close() { if (!opened.value || pending.value) return; if (unknown.value) closing.value = true; else reset() }
  function cancelClose() { closing.value = false }
  function discard() { if (closing.value && !pending.value) reset() }
  /** Warns on native reload/close; drafts are never promised to survive navigation. */
  function beforeUnload(event: BeforeUnloadEvent) {
    if (opened.value && (pending.value || unknown.value)) { event.preventDefault(); event.returnValue = '' }
  }
  window.addEventListener('beforeunload', beforeUnload)
  onBeforeUnmount(() => { alive = false; generation++; unsubscribe(); window.removeEventListener('beforeunload', beforeUnload) })
  return { allowed, opened, draft, snapshot, pending, unknown, closing, errorKey, begin, preview, edit, submit, close, cancelClose, discard }
}
