import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { previewAdminNoteReplace, previewOwnNoteReplace, replaceAdminNotes, replaceOwnNotes, type BatchNoteReplacePreviewInput, type BatchNoteReplacePreviewResult } from '@/entities/short-link/batch-note-replace'
import { noteIdSchema, noteVersionSchema } from '@/entities/short-link/note'
import { shortLinkNoteSchema } from '@/shared/validation/shortLinkNote'
import { ApiClientError } from '@/shared/api/client'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

type Access = ReturnType<typeof useShortLinkAccess>
/** Owns the private draft and the exact preview that a user can approve for one opening. */
export function useBatchNoteReplace(context: 'own' | 'admin', access: Access, onReplaced: () => void) {
  const client = useQueryClient(), { t } = useI18n()
  const targets = shallowRef<BatchNoteReplacePreviewInput['items'] | null>(null)
  const data = shallowRef<BatchNoteReplacePreviewResult | null>(null)
  const text = ref(''), draft = computed(() => text.value)
  const loading = ref(false), saving = ref(false), unknown = ref(false)
  const error = ref<'' | 'invalidNote' | 'loadFailed' | 'saveFailed'>('')
  let alive = true, generation = 0, operation = 0, previewedNote = ''
  let focusRestorable = false, scope = access.identity.scope.value, grants = ''
  const read = context === 'own' ? previewOwnNoteReplace : previewAdminNoteReplace
  const write = context === 'own' ? replaceOwnNotes : replaceAdminNotes
  const listKey = [context === 'own' ? 'short-link' : 'admin-short-link']
  const normalized = computed(() => shortLinkNoteSchema.safeParse(text.value))
  /** Reads live authority synchronously, including status transitions and revoke/restore ABA. */
  function signature() { return `${client.getQueryState(['auth', 'me'])?.status}:${access.allows('read')}:${access.allows('tags')}` }
  /** Erases text and retires every pending completion without claiming to cancel a server write. */
  function reset() {
    generation++; operation++; previewedNote = ''
    targets.value = null; data.value = null; text.value = ''; loading.value = false; saving.value = false; unknown.value = false; error.value = ''
  }
  /** Captures one request under a fixed login, grant signature and dialog opening. */
  function capture() {
    const opening = generation, request = ++operation, account = scope
    return () => alive && generation === opening && operation === request && targets.value !== null
      && access.identity.isCurrent(account) && signature() === grants && access.allows('tags')
  }
  const canPreview = computed(() => targets.value !== null && normalized.value.success && normalized.value.data !== '' && !loading.value && !saving.value && access.canTag.value)
  const canConfirm = computed(() => targets.value !== null && data.value !== null && data.value.changedCount > 0 && !loading.value && !saving.value && !unknown.value && access.canTag.value)
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if ((targets.value || focusRestorable) && event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me'
      && (!access.identity.isCurrent(scope) || signature() !== grants)) { focusRestorable = false; reset() }
  })
  onBeforeUnmount(() => { alive = false; focusRestorable = false; unsubscribe(); reset() })
  /** Every draft edit retires previous data and requests, even when A is restored after B. */
  function setDraft(value: unknown) {
    if (!alive || targets.value === null || saving.value || unknown.value || typeof value !== 'string') return
    operation++; data.value = null; loading.value = false; previewedNote = ''; text.value = value
    error.value = normalized.value.success && normalized.value.data !== '' ? '' : 'invalidNote'
  }
  /** Retires conflicting or invisible targets and refreshes only the still-current boundary. */
  function denied(cause: unknown, current: () => boolean) {
    if (!(cause instanceof ApiClientError) || ![200116, 200104, 120001, 401, 403].includes(cause.code)) return false
    toast.error(t(cause.code === 200116 ? 'batchNoteReplace.conflict' : 'batchNoteReplace.accessChanged'))
    if (current()) {
      if (cause.code === 200116 || cause.code === 200104) void client.invalidateQueries({ queryKey: listKey })
      else void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
    }
    if (current()) reset()
    return true
  }
  /** Reads the actual comparison again; a failed read cannot unlock an unknown write outcome. */
  async function preview() {
    const value = normalized.value
    if (!value.success || !canPreview.value || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    const current = capture(), input = { items: targets.value!.map(item => ({ ...item })), note: value.data }, userId = scope.userId
    loading.value = true; data.value = null; previewedNote = ''; error.value = ''
    try {
      const result = await read(input, userId)
      await nextTick()
      if (!current()) return
      previewedNote = input.note; data.value = result; unknown.value = false
    } catch (cause) {
      await nextTick()
      if (current() && !denied(cause, current)) error.value = 'loadFailed'
    } finally { if (current()) loading.value = false }
  }
  /** Opens with a fixed selection and empty draft; no automatic request or write is sent. */
  function open(items: BatchNoteReplacePreviewInput['items']) {
    if (!alive || saving.value || client.getQueryState(['auth', 'me'])?.status !== 'success' || !access.allows('tags') || !noteIdSchema.safeParse(access.identity.scope.value.userId).success
      || items.length < 1 || items.length > 100 || new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => !noteIdSchema.safeParse(item.id).success || !noteVersionSchema.safeParse(item.expectedUpdatedAt).success)) return
    reset(); scope = access.identity.scope.value; grants = signature(); focusRestorable = true
    targets.value = items.map(item => ({ id: item.id, expectedUpdatedAt: item.expectedUpdatedAt }))
  }
  /** Saving holds the dialog; ordinary dismissal retires only local state. */
  function close() { if (!saving.value) reset() }
  /** Requires the exact rendered approval, so queued old confirmation callbacks cannot approve new data. */
  async function confirm(opening: number, request: number, approved: BatchNoteReplacePreviewResult | null) {
    if (!canConfirm.value || generation !== opening || operation !== request || approved !== data.value
      || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    const current = capture(), userId = scope.userId
    const input = { items: targets.value!.map((item, index) => ({ ...item, expectedNoteUpdatedAt: approved!.items[index]!.expectedNoteUpdatedAt })), note: previewedNote }
    saving.value = true; error.value = ''
    try {
      const result = await write(input, userId)
      await nextTick()
      if (!current()) return
      onReplaced()
      if (current()) void client.invalidateQueries({ queryKey: listKey })
      if (current()) toast.success(t('batchNoteReplace.saved', { changed: result.changedCount, unchanged: result.unchangedCount }))
      if (current()) reset()
    } catch (cause) {
      await nextTick()
      if (!current() || denied(cause, current)) return
      if (!(cause instanceof ApiClientError) || cause.code === 900000 || cause.meta.invalidBatchNoteResponse
        || (typeof cause.meta.status === 'number' && (cause.meta.status >= 500 || (cause.meta.status >= 200 && cause.meta.status < 300)))) {
        unknown.value = true; data.value = null; previewedNote = ''
      } else error.value = 'saveFailed'
    } finally { if (current()) saving.value = false }
  }
  /** Avoids restoring focus into a retired login or permission context. */
  function canRestoreFocus() { return alive && focusRestorable && access.identity.isCurrent(scope) && signature() === grants }
  return { targets, draft, data, loading, saving, unknown, error, canPreview, canConfirm, open, close, setDraft, preview, reset, canRestoreFocus,
    get confirm() { const opening = generation, request = operation, approved = data.value; return () => confirm(opening, request, approved) },
  }
}
