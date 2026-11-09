import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { previewAdminNoteAppend, previewOwnNoteAppend, appendAdminNotes, appendOwnNotes, type BatchNoteAppendInput, type BatchNoteAppendPreviewInput, type BatchNoteAppendPreviewResult } from '@/entities/short-link/batch-note-append'
import { noteIdSchema, noteVersionSchema } from '@/entities/short-link/note'
import { shortLinkNoteSchema } from '@/shared/validation/shortLinkNote'
import { ApiClientError } from '@/shared/api/client'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

type Access = ReturnType<typeof useShortLinkAccess>
/** Owns one private approval and retains its exact payload/key until acknowledged or explicitly abandoned. */
export function useBatchNoteAppend(context: 'own' | 'admin', access: Access, onAppended: () => void) {
  const client = useQueryClient(), { t } = useI18n()
  const targets = shallowRef<BatchNoteAppendPreviewInput['items'] | null>(null)
  const data = shallowRef<BatchNoteAppendPreviewResult | null>(null)
  const pendingWrite = shallowRef<BatchNoteAppendInput | null>(null)
  const text = ref(''), draft = computed(() => text.value), requestId = computed(() => pendingWrite.value?.requestId ?? '')
  const loading = ref(false), saving = ref(false), unknown = ref(false), discardRequested = ref(false)
  const error = ref<'' | 'invalidNote' | 'loadFailed' | 'saveFailed'>('')
  let alive = true, generation = 0, operation = 0, discardRevision = 0, previewedNote = ''
  let focusRestorable = false, scope = access.identity.scope.value, grants = ''
  const read = context === 'own' ? previewOwnNoteAppend : previewAdminNoteAppend
  const write = context === 'own' ? appendOwnNotes : appendAdminNotes
  const listKey = [context === 'own' ? 'short-link' : 'admin-short-link']
  const normalized = computed(() => shortLinkNoteSchema.safeParse(text.value))
  /** Reads live cache status and exact grants synchronously, including revoke/restore ABA. */
  function signature() { return client.getQueryState(['auth', 'me'])?.status + ':' + access.allows('read') + ':' + access.allows('tags') }
  /** Erases private state and retires callbacks without claiming to cancel any server operation. */
  function reset() {
    generation++; operation++; discardRevision++; previewedNote = ''
    targets.value = null; data.value = null; pendingWrite.value = null; text.value = ''; loading.value = false; saving.value = false; unknown.value = false; discardRequested.value = false; error.value = ''
  }
  /** Pins an asynchronous operation to one current identity, grant signature and opening. */
  function capture() {
    const opening = generation, request = ++operation, account = scope
    return () => alive && generation === opening && operation === request && targets.value !== null
      && access.identity.isCurrent(account) && signature() === grants && access.allows('tags')
  }
  const canPreview = computed(() => targets.value !== null && normalized.value.success && normalized.value.data !== '' && !loading.value && !saving.value && !unknown.value && access.canTag.value)
  const canConfirm = computed(() => targets.value !== null && data.value !== null && data.value.overflowCount === 0 && data.value.appendableCount === targets.value.length && !loading.value && !saving.value && !unknown.value && access.canTag.value)
  const canRetry = computed(() => targets.value !== null && pendingWrite.value !== null && unknown.value && !saving.value && !discardRequested.value && access.canTag.value)
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if ((targets.value || focusRestorable) && event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me'
      && (!access.identity.isCurrent(scope) || signature() !== grants)) { focusRestorable = false; reset() }
  })
  onBeforeUnmount(() => { alive = false; focusRestorable = false; unsubscribe(); reset() })
  /** Every edit retires old previews, even when the user restores the same original text. */
  function setDraft(value: unknown) {
    if (!alive || targets.value === null || saving.value || unknown.value || typeof value !== 'string') return
    operation++; data.value = null; loading.value = false; previewedNote = ''; text.value = value
    error.value = normalized.value.success && normalized.value.data !== '' ? '' : 'invalidNote'
  }
  /** Retires unauthorized, invisible, conflicting or reused-key operations without a hidden new key. */
  function denied(cause: unknown, current: () => boolean) {
    if (!(cause instanceof ApiClientError) || ![200116, 200104, 120001, 401, 403, 200120].includes(cause.code)) return false
    toast.error(t(cause.code === 200120 ? 'batchNoteAppend.requestConflict' : cause.code === 200116 ? 'batchNoteAppend.conflict' : 'batchNoteAppend.accessChanged'))
    if (current()) {
      if (cause.code === 200116 || cause.code === 200104) void client.invalidateQueries({ queryKey: listKey })
      else if (cause.code !== 200120) void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
    }
    if (current()) reset()
    return true
  }
  /** Previews only editable drafts; it can never change an unknown operation's versions or key. */
  async function preview() {
    const value = normalized.value
    if (!value.success || !canPreview.value || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    const current = capture(), input = { items: targets.value!.map(item => ({ ...item })), note: value.data }, userId = scope.userId
    loading.value = true; data.value = null; previewedNote = ''; error.value = ''
    try {
      const result = await read(input, userId)
      await nextTick()
      if (!current()) return
      previewedNote = input.note; data.value = result
    } catch (cause) {
      await nextTick()
      if (current() && !denied(cause, current)) error.value = 'loadFailed'
    } finally { if (current()) loading.value = false }
  }
  /** Copies the authorized current-page selection without reading private old notes or sending a request. */
  function open(items: BatchNoteAppendPreviewInput['items']) {
    if (!alive || saving.value || unknown.value || client.getQueryState(['auth', 'me'])?.status !== 'success' || !access.allows('tags') || !noteIdSchema.safeParse(access.identity.scope.value.userId).success
      || items.length < 1 || items.length > 100 || new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => !noteIdSchema.safeParse(item.id).success || !noteVersionSchema.safeParse(item.expectedUpdatedAt).success)) return
    reset(); scope = access.identity.scope.value; grants = signature(); focusRestorable = true
    targets.value = items.map(item => ({ id: item.id, expectedUpdatedAt: item.expectedUpdatedAt }))
  }
  /** Requires a second explicit decision before abandoning an unknown server outcome. */
  function close() {
    if (saving.value) return
    if (unknown.value) { discardRevision++; discardRequested.value = true }
    else reset()
  }
  /** Returns from the warning without changing the original recoverable request. */
  function cancelDiscard() { discardRevision++; discardRequested.value = false }
  /** Discards only the exact unknown operation whose warning was rendered. */
  function discard(opening: number, revision: number, approved: BatchNoteAppendInput | null) {
    if (alive && generation === opening && discardRevision === revision && approved === pendingWrite.value && unknown.value && discardRequested.value && !saving.value) reset()
  }
  /** Sends exactly one immutable snapshot; every completion checks its live authority again. */
  async function attempt(input: BatchNoteAppendInput) {
    const current = capture(), userId = scope.userId
    saving.value = true; error.value = ''
    try {
      const result = await write(input, userId)
      await nextTick()
      if (!current()) return
      onAppended()
      if (current()) void client.invalidateQueries({ queryKey: listKey })
      if (current()) toast.success(t('batchNoteAppend.saved', { count: result.appendedCount }, result.appendedCount))
      if (current()) reset()
    } catch (cause) {
      await nextTick()
      if (!current() || denied(cause, current)) return
      if (cause instanceof ApiClientError && cause.code === 100001 && !cause.meta.invalidBatchNoteResponse && !('status' in cause.meta)) {
        unknown.value = false; pendingWrite.value = null; data.value = null; previewedNote = ''; error.value = 'saveFailed'
      } else unknown.value = true
    } finally { if (current()) saving.value = false }
  }
  /** Creates a secure key only for the exact still-rendered approval, never for a network retry. */
  async function confirm(opening: number, request: number, approved: BatchNoteAppendPreviewResult | null) {
    if (!canConfirm.value || generation !== opening || operation !== request || approved !== data.value
      || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    let key: string
    try { key = crypto.randomUUID(); if (!noteIdSchema.safeParse(key).success) throw new Error('Invalid generated key') }
    catch { error.value = 'saveFailed'; return }
    const input = Object.freeze({ requestId: key, items: Object.freeze(targets.value!.map((item, index) => Object.freeze({ ...item, expectedNoteUpdatedAt: approved!.items[index]!.expectedNoteUpdatedAt }))), note: previewedNote })
    pendingWrite.value = input
    await attempt(input)
  }
  /** A manual retry reuses both revisions, normalized text and key; no preview or automatic retry exists. */
  async function retry(opening: number, request: number, approved: BatchNoteAppendInput | null) {
    if (!canRetry.value || generation !== opening || operation !== request || approved !== pendingWrite.value
      || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    await attempt(approved!)
  }
  /** Never restores focus into a retired login or revoked permission context. */
  function canRestoreFocus() { return alive && focusRestorable && access.identity.isCurrent(scope) && signature() === grants }
  return { targets, draft, data, loading, saving, unknown, error, canPreview, canConfirm, canRetry, requestId, discardRequested, open, close, cancelDiscard, setDraft, preview, reset, canRestoreFocus,
    get confirm() { const opening = generation, request = operation, approved = data.value; return () => confirm(opening, request, approved) },
    get retry() { const opening = generation, request = operation, approved = pendingWrite.value; return () => retry(opening, request, approved) },
    get discard() { const opening = generation, revision = discardRevision, approved = pendingWrite.value; return () => discard(opening, revision, approved) },
  }
}
