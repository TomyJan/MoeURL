import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { clearAdminNotes, clearOwnNotes, previewAdminNoteClear, previewOwnNoteClear, type BatchNotePreviewInput, type BatchNotePreviewResult } from '@/entities/short-link/batch-note-clear'
import { noteIdSchema, noteVersionSchema } from '@/entities/short-link/note'
import { ApiClientError } from '@/shared/api/client'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

type Access = ReturnType<typeof useShortLinkAccess>
/** Owns one fixed private confirmation; all completions belong to its login, grants and opening. */
export function useBatchNoteClear(context: 'own' | 'admin', access: Access, onCleared: () => void) {
  const client = useQueryClient(), { t } = useI18n()
  const targets = shallowRef<BatchNotePreviewInput['items'] | null>(null)
  const data = shallowRef<BatchNotePreviewResult | null>(null)
  const loading = ref(false), saving = ref(false), unknown = ref(false)
  const error = ref<'' | 'loadFailed' | 'saveFailed'>('')
  let alive = true, generation = 0, operation = 0
  let focusRestorable = false
  let scope = access.identity.scope.value, grants = ''
  const preview = context === 'own' ? previewOwnNoteClear : previewAdminNoteClear
  const clear = context === 'own' ? clearOwnNotes : clearAdminNotes
  const listKey = [context === 'own' ? 'short-link' : 'admin-short-link']
  /** Reads live grants synchronously so revoke/restore cannot revive an old confirmation. */
  function signature() { return `${client.getQueryState(['auth', 'me'])?.status}:${access.allows('read')}:${access.allows('tags')}` }
  /** Erases the snapshot and releases only the retired opening's local state. */
  function reset() {
    generation++; operation++
    targets.value = null; data.value = null; loading.value = false; saving.value = false; unknown.value = false; error.value = ''
  }
  /** Captures a request generation instead of trusting a reusable user ID. */
  function capture() {
    const opening = generation, request = ++operation, account = scope
    return () => alive && generation === opening && operation === request && targets.value !== null
      && access.identity.isCurrent(account) && signature() === grants && access.allows('tags')
  }
  const canConfirm = computed(() => targets.value !== null && data.value !== null && data.value.nonemptyCount > 0
    && !loading.value && !saving.value && !unknown.value && access.canTag.value)
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if ((targets.value || focusRestorable) && event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me'
      && (!access.identity.isCurrent(scope) || signature() !== grants)) { focusRestorable = false; reset() }
  })
  onBeforeUnmount(() => { alive = false; focusRestorable = false; unsubscribe(); reset() })
  /** Retires stale resources or revoked authority and refreshes the matching boundary once. */
  function denied(cause: unknown, current: () => boolean) {
    if (!(cause instanceof ApiClientError) || ![200116, 200104, 120001, 401, 403].includes(cause.code)) return false
    toast.error(t(cause.code === 200116 ? 'batchNoteClear.conflict' : 'batchNoteClear.accessChanged'))
    if (current()) {
      if (cause.code === 200116 || cause.code === 200104) void client.invalidateQueries({ queryKey: listKey })
      else void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
    }
    if (current()) reset()
    return true
  }
  /** Performs an actual uncached read; failed readback never unlocks an uncertain write. */
  async function reload() {
    if (!targets.value || loading.value || saving.value || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    const current = capture(), input = { items: targets.value.map(item => ({ ...item })) }, userId = scope.userId
    loading.value = true; data.value = null; error.value = ''
    try {
      const result = await preview(input, userId)
      await nextTick()
      if (!current()) return
      data.value = result; unknown.value = false
    } catch (cause) {
      await nextTick()
      if (current() && !denied(cause, current)) error.value = 'loadFailed'
    } finally { if (current()) loading.value = false }
  }
  /** Pins only valid selected IDs and their original complete main versions. */
  function open(items: BatchNotePreviewInput['items']) {
    if (!alive || saving.value || client.getQueryState(['auth', 'me'])?.status !== 'success' || !access.allows('tags') || !noteIdSchema.safeParse(access.identity.scope.value.userId).success
      || items.length < 1 || items.length > 100 || new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => !noteIdSchema.safeParse(item.id).success || !noteVersionSchema.safeParse(item.expectedUpdatedAt).success)) return
    reset(); scope = access.identity.scope.value; grants = signature()
    focusRestorable = true
    targets.value = items.map(item => ({ id: item.id, expectedUpdatedAt: item.expectedUpdatedAt }))
    void reload()
  }
  /** Ordinary dismissal never claims to cancel a server write. */
  function close() { if (!saving.value) reset() }
  /** Makes exactly one explicitly confirmed clear; uncertain results require a new preview. */
  async function confirm() {
    if (!canConfirm.value || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    const current = capture(), userId = scope.userId
    const input = { items: targets.value!.map((item, index) => ({ ...item, expectedNoteUpdatedAt: data.value!.items[index]!.expectedNoteUpdatedAt })) }
    saving.value = true; error.value = ''
    try {
      const result = await clear(input, userId)
      await nextTick()
      if (!current()) return
      onCleared()
      if (current()) void client.invalidateQueries({ queryKey: listKey })
      if (current()) toast.success(t('batchNoteClear.saved', { changed: result.changedCount, unchanged: result.unchangedCount }))
      if (current()) reset()
    } catch (cause) {
      await nextTick()
      if (!current() || denied(cause, current)) return
      if (!(cause instanceof ApiClientError) || cause.code === 900000 || cause.meta.invalidBatchNoteResponse
        || (typeof cause.meta.status === 'number' && (cause.meta.status >= 500 || (cause.meta.status >= 200 && cause.meta.status < 300)))) {
        unknown.value = true; data.value = null
      } else error.value = 'saveFailed'
    } finally { if (current()) saving.value = false }
  }
  /** Never returns focus to an element belonging to a revoked or replaced login opening. */
  function canRestoreFocus() { return alive && focusRestorable && access.identity.isCurrent(scope) && signature() === grants }
  return { targets, data, loading, saving, unknown, error, canConfirm, open, close, reset, reload, confirm, canRestoreFocus }
}
