import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { batchCreateShortLinks, batchCreateShortLinksWithTitles, batchCreateShortLinksWithMetadata, batchCreateShortLinksWithCustomSlugs, BulkCreateUnknownError, parseBulkCreateLines, type BulkCreateInput, type BulkCreateTitlesInput, type BulkCreateMetadataInput, type BulkCreateCustomSlugsInput, type BulkCreateCustomSlugItem, type BulkCreateItem, type BulkCreateMetadataItem } from '@/entities/short-link/bulk-create'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { BULK_CSV_MAX_BYTES, parseBulkCreateImportCsv } from '@/entities/short-link/bulk-create-csv'

/** Owns an in-memory batch, binding every asynchronous completion to current confirmed authority. */
export function useBulkCreate() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, retry: false, staleTime: Infinity })
  const { t } = useI18n()
  const opened = ref(false), draft = ref(''), pending = ref(false), unknown = ref(false), closing = ref(false), errorKey = ref('')
  type Protocol = 'targets' | 'titles' | 'metadata' | 'custom-slugs'
  type StructuredItem = BulkCreateItem | BulkCreateMetadataItem | BulkCreateCustomSlugItem
  type Snapshot = BulkCreateInput | BulkCreateTitlesInput | BulkCreateMetadataInput | BulkCreateCustomSlugsInput
  const snapshot = shallowRef<Snapshot | null>(null)
  const importedItems = shallowRef<readonly StructuredItem[] | null>(null)
  const importedMode = ref<Protocol>('targets'), snapshotMode = ref<Protocol>('targets')
  const previewItems = computed<readonly StructuredItem[]>(() => !snapshot.value ? [] : 'items' in snapshot.value ? snapshot.value.items : snapshot.value.targetUrls.map(targetUrl => ({ targetUrl, title: '' })))
  const reading = ref(false)
  let generation = 0, alive = true, scope = identity.scope.value
  let fileSequence = 0, draftRevision = 0, metadataEpoch = 0, customSlugEpoch = 0
  watch(draft, () => { draftRevision++; fileSequence++; reading.value = false }, { flush: 'sync' })
  const mutation = useMutation({
    mutationFn: (attempt: { input: Snapshot; mode: Protocol; token: number; candidate: typeof scope }) => {
      if (!isCurrent(attempt.token, attempt.candidate) || ('items' in attempt.input && !canTitleNow())) throw new Error('Batch context retired')
      if (attempt.mode === 'custom-slugs') {
        if (!canCustomSlugNow()) throw new Error('Batch context retired')
        return batchCreateShortLinksWithCustomSlugs(attempt.input as BulkCreateCustomSlugsInput, attempt.candidate.userId)
      }
      if (attempt.mode === 'metadata') return batchCreateShortLinksWithMetadata(attempt.input as BulkCreateMetadataInput, attempt.candidate.userId)
      return 'items' in attempt.input ? batchCreateShortLinksWithTitles(attempt.input, attempt.candidate.userId) : batchCreateShortLinks(attempt.input, attempt.candidate.userId)
    },
    networkMode: 'always',
    retry: false,
  })
  /** Reads the cache synchronously so batched renders cannot retain revoked grants. */
  function canUseNow() {
    const user = client.getQueryData<UserResponse>(['auth', 'me'])?.user
    return client.getQueryState(['auth', 'me'])?.status === 'success' && !!user?.id && user.group !== 'guest' && user.username !== 'guest'
      && user.permissions.includes('short_link:create') && user.permissions.includes('domain:use_default')
  }
  const allowed = computed(() => auth.isSuccess.value && !!auth.data.value?.user && auth.data.value.user.group !== 'guest'
    && auth.data.value.user.username !== 'guest' && !!auth.data.value.user.id
    && auth.data.value.user.permissions.includes('short_link:create') && auth.data.value.user.permissions.includes('domain:use_default'))
  function canTitleNow() { return canUseNow() && !!client.getQueryData<UserResponse>(['auth', 'me'])?.user.permissions.includes('short_link:set_metadata') }
  function canCustomSlugNow() { return canTitleNow() && !!client.getQueryData<UserResponse>(['auth', 'me'])?.user.permissions.includes('short_link:custom_slug') }
  /** Retires private input immediately, without letting old finally blocks unlock a newer batch. */
  function reset() {
    generation++; opened.value = false; draft.value = ''; importedItems.value = null; snapshot.value = null; pending.value = false
    importedMode.value = 'targets'; snapshotMode.value = 'targets'
    unknown.value = false; closing.value = false; errorKey.value = ''; fileSequence++; reading.value = false
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'me') return
    if (!identity.isCurrent(scope) || !canUseNow()) reset()
    if (!canTitleNow()) {
      metadataEpoch++
      if (importedItems.value || (snapshot.value && 'items' in snapshot.value)) reset()
    }
    if (!canCustomSlugNow()) {
      customSlugEpoch++
      if (importedMode.value === 'custom-slugs' || snapshotMode.value === 'custom-slugs') reset()
    }
  })
  /** Opens a new draft only under the currently confirmed account and grants. */
  function begin() {
    if (!canUseNow() || pending.value) return
    reset(); scope = identity.scope.value; opened.value = true
  }
  /** Freezes one ordered payload before generating its unique request identifier. */
  function preview() {
    if (!opened.value || pending.value || unknown.value || reading.value || !canUseNow()) return
    if (importedItems.value) {
      if (!canTitleNow()) { reset(); return }
      if (importedMode.value === 'custom-slugs' && !canCustomSlugNow()) { reset(); return }
      snapshot.value = Object.freeze({ requestId: crypto.randomUUID(), items: importedItems.value })
      snapshotMode.value = importedMode.value
    } else {
      const parsed = parseBulkCreateLines(draft.value)
      if (!parsed.success) { errorKey.value = 'bulkCreate.invalid'; return }
      snapshot.value = Object.freeze({ requestId: crypto.randomUUID(), targetUrls: Object.freeze([...parsed.data]) })
      snapshotMode.value = 'targets'
    }
    errorKey.value = ''
  }
  /** Allows changes only before an unknown result; another preview makes an explicit new batch. */
  function edit() { if (!pending.value && !unknown.value) { snapshot.value = null; errorKey.value = '' } }
  /** Explicitly discards the entire structured import before returning to manual input. */
  function clearImport() {
    if (!opened.value || snapshot.value || pending.value || unknown.value) return
    importedItems.value = null; importedMode.value = 'targets'; draft.value = ''; draftRevision++; fileSequence++; reading.value = false; errorKey.value = ''
  }
  /** Checks both login epoch and the operation generation immediately before any side effect. */
  function isCurrent(token: number, candidate: typeof scope) { return alive && token === generation && identity.isCurrent(candidate) && canUseNow() }
  /** Binds local file reads to both authority and the latest explicit draft intent. */
  async function importFile(file: File | undefined) {
    if (!file || !opened.value || snapshot.value || pending.value || unknown.value || !isCurrent(generation, scope)) return
    const token = generation, candidate = scope, sequence = ++fileSequence, revision = draftRevision, titleEpoch = metadataEpoch, slugEpoch = customSlugEpoch
    const current = () => isCurrent(token, candidate) && sequence === fileSequence && revision === draftRevision
    reading.value = true; errorKey.value = ''
    try {
      if (file.size > BULK_CSV_MAX_BYTES) { errorKey.value = 'bulkCreate.csvTooLarge'; return }
      const bytes = await file.arrayBuffer()
      if (!current()) return
      if (bytes.byteLength > BULK_CSV_MAX_BYTES) { errorKey.value = 'bulkCreate.csvTooLarge'; return }
      // Keep BOMs visible to the parser, which accepts only one opening marker.
      const parsed = parseBulkCreateImportCsv(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
      if (!parsed.success) { errorKey.value = 'bulkCreate.csvInvalid'; return }
      if (parsed.mode !== 'targets') {
        if (!canTitleNow() || titleEpoch !== metadataEpoch) { errorKey.value = 'bulkCreate.metadataRequired'; return }
        if (parsed.mode === 'custom-slugs' && (!canCustomSlugNow() || slugEpoch !== customSlugEpoch)) { errorKey.value = 'bulkCreate.customSlugRequired'; return }
        draft.value = ''
        importedItems.value = Object.freeze(parsed.data.map(item => Object.freeze('tags' in item ? { ...item, tags: Object.freeze([...item.tags]) } : { ...item })))
        importedMode.value = parsed.mode
      } else { importedItems.value = null; importedMode.value = 'targets'; draft.value = parsed.data.join('\n') }
      draftRevision++; fileSequence++; reading.value = false; errorKey.value = ''
    } catch {
      if (current()) errorKey.value = 'bulkCreate.csvReadFailed'
    } finally { if (current()) reading.value = false }
  }
  /** Sends exactly one explicit attempt; retry keeps the same immutable payload and key. */
  async function submit() {
    if (!opened.value || pending.value || closing.value || !snapshot.value || !isCurrent(generation, scope)) return
    const token = generation, candidate = scope, input = snapshot.value, mode = snapshotMode.value
    pending.value = true; errorKey.value = ''
    try {
      const result = await mutation.mutateAsync({ input, mode, token, candidate })
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
  return { allowed, opened, draft, importedItems, importedMode, previewItems, snapshot, snapshotMode, pending, unknown, closing, errorKey, reading, importFile, clearImport, begin, preview, edit, submit, close, cancelClose, discard }
}
