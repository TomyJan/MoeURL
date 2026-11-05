import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { renameAdminTags, renameOwnTags, renameTagSchema } from '@/entities/short-link/batch-tag-rename'
import { noteIdSchema, noteVersionSchema } from '@/entities/short-link/note'
import { shortLinkMetadataSchema } from '@/shared/validation/shortLinkMetadata'
import { ApiClientError } from '@/shared/api/client'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

export interface TagRenameTarget { readonly id: string; readonly expectedUpdatedAt: string; readonly url: string; readonly tags: readonly string[] }
type Access = ReturnType<typeof useShortLinkAccess>
/** Owns a fixed selection and approval; uncertain writes can only be retired by a fresh list read. */
export function useBatchTagRename(context: 'own' | 'admin', access: Access, onRetired: () => void, readFresh: (current: () => boolean) => Promise<boolean>) {
  const client = useQueryClient(), { t } = useI18n()
  const targets = shallowRef<readonly TagRenameTarget[] | null>(null)
  const from = ref(''), to = ref(''), draft = computed(() => ({ fromTag: from.value, toTag: to.value }))
  const saving = ref(false), loading = ref(false), recovery = ref<'' | 'unknown' | 'stale'>('')
  const unknown = computed(() => recovery.value === 'unknown')
  const error = ref<'' | 'saveFailed' | 'loadFailed'>('')
  let alive = true, generation = 0, revision = 0, operation = 0, focusRestorable = false
  let scope = access.identity.scope.value, grants = ''
  const write = context === 'own' ? renameOwnTags : renameAdminTags
  /** Checks the live cache synchronously so transient authority loss cannot be undone by ABA. */
  function signature() { return `${client.getQueryState(['auth', 'me'])?.status}:${access.allows('read')}:${access.allows('tags')}` }
  function authorized() { return alive && access.identity.isCurrent(scope) && signature() === grants && access.allows('tags') }
  const preview = computed(() => {
    const old = renameTagSchema.safeParse(from.value), replacement = renameTagSchema.safeParse(to.value)
    if (!targets.value || !old.success || !replacement.success || old.data === replacement.data) return null
    const items = targets.value.map(item => {
      const changed = item.tags.includes(old.data)
      const after = !changed ? [...item.tags] : item.tags.includes(replacement.data)
        ? item.tags.filter(tag => tag !== old.data) : item.tags.map(tag => tag === old.data ? replacement.data : tag)
      return Object.freeze({ ...item, after: Object.freeze(after), changed })
    })
    const changedCount = items.filter(item => item.changed).length
    return Object.freeze({ fromTag: old.data, toTag: replacement.data, items: Object.freeze(items), changedCount, unchangedCount: items.length - changedCount })
  })
  const approved = shallowRef<typeof preview.value>(null)
  const canConfirm = computed(() => targets.value !== null && approved.value !== null && approved.value === preview.value
    && approved.value.changedCount > 0 && !saving.value && !loading.value && !recovery.value && access.canTag.value)
  /** Retires local callbacks without pretending to cancel an already dispatched write. */
  function reset() {
    generation++; revision++; operation++; targets.value = null; from.value = ''; to.value = ''; approved.value = null
    saving.value = false; loading.value = false; recovery.value = ''; error.value = ''
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if ((targets.value || focusRestorable) && event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me' && !authorized()) { focusRestorable = false; reset() }
  })
  onBeforeUnmount(() => { alive = false; focusRestorable = false; unsubscribe(); reset() })
  /** Pins an asynchronous completion to its opening, attempt and authority. */
  function capture() {
    const opening = generation, request = ++operation
    return () => generation === opening && operation === request && targets.value !== null && authorized()
  }
  /** Deep copies the public preview data; subsequent list refreshes cannot change the approved operation. */
  function open(items: readonly TagRenameTarget[]) {
    if (!alive || targets.value || client.getQueryState(['auth', 'me'])?.status !== 'success' || !access.allows('tags')
      || !noteIdSchema.safeParse(access.identity.scope.value.userId).success || items.length < 1 || items.length > 100
      || new Set(items.map(item => item.id)).size !== items.length || items.some(item => !noteIdSchema.safeParse(item.id).success
        || !noteVersionSchema.safeParse(item.expectedUpdatedAt).success || typeof item.url !== 'string'
        || !shortLinkMetadataSchema.safeParse({ title: '', tags: item.tags }).success)) return
    reset(); scope = access.identity.scope.value; grants = signature(); focusRestorable = true
    targets.value = Object.freeze(items.map(item => Object.freeze({ id: item.id, expectedUpdatedAt: item.expectedUpdatedAt, url: item.url, tags: Object.freeze([...item.tags]) })))
  }
  /** A locked outcome cannot be dismissed and reopened with the old CAS token. */
  function close() { if (!saving.value && !loading.value && !recovery.value) reset() }
  function edit(field: 'from' | 'to', value: unknown) {
    if (!targets.value || !authorized() || saving.value || loading.value || recovery.value || typeof value !== 'string') return
    revision++; approved.value = null; error.value = ''
    if (field === 'from') from.value = value; else to.value = value
  }
  /** Binds approval to the actual rendered preview and draft revision, including same-value edits. */
  function approve(opening: number, draftRevision: number, value: typeof preview.value) {
    if (!targets.value || !authorized() || generation !== opening || revision !== draftRevision || value !== preview.value
      || !value || value.changedCount === 0 || saving.value || loading.value || recovery.value) return
    approved.value = value
  }
  /** Reads only; neither a failed read nor cached success can unlock another write. */
  async function reload() {
    if (!targets.value || !recovery.value || saving.value || loading.value || !authorized()) return
    const current = capture(); loading.value = true; error.value = ''
    try {
      const success = await readFresh(current); await nextTick()
      if (!current()) return
      if (!success) { error.value = 'loadFailed'; return }
      onRetired()
      for (const key of ['short-link', 'admin-short-link', 'short-link-overview', 'short-link-statistics', 'insights']) {
        if (current()) void client.invalidateQueries({ queryKey: [key] })
      }
      if (current()) reset()
    } catch { await nextTick(); if (current()) error.value = 'loadFailed' }
    finally { if (current()) loading.value = false }
  }
  /** Sends once under the exact approval; every callback separately rechecks current authority. */
  async function confirm(opening: number, draftRevision: number, value: typeof approved.value) {
    if (!canConfirm.value || !authorized() || generation !== opening || revision !== draftRevision || value !== approved.value) return
    const current = capture(), userId = scope.userId
    const input = { items: targets.value!.map(({ id, expectedUpdatedAt }) => ({ id, expectedUpdatedAt })), fromTag: value!.fromTag, toTag: value!.toTag }
    revision++; saving.value = true; approved.value = null; error.value = ''
    try {
      const result = await write(input, userId); await nextTick()
      if (!current()) return
      onRetired()
      for (const key of ['short-link', 'admin-short-link', 'short-link-overview', 'short-link-statistics', 'insights']) {
        if (current()) void client.invalidateQueries({ queryKey: [key] })
      }
      if (current()) toast.success(t('batchTagRename.saved', { changed: result.changedCount, unchanged: result.unchangedCount }))
      if (current()) reset()
    } catch (cause) {
      await nextTick(); if (!current()) return
      if (cause instanceof ApiClientError && [120001, 401, 403].includes(cause.code)) {
        toast.error(t('batchTagRename.accessChanged'))
        if (current()) void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
        if (current()) { focusRestorable = false; reset() }
      } else if (cause instanceof ApiClientError && [200116, 200104].includes(cause.code)) recovery.value = 'stale'
      else if (!(cause instanceof ApiClientError) || cause.code === 900000 || cause.meta.invalidBatchTagRenameResponse
        || (typeof cause.meta.status === 'number' && (cause.meta.status >= 500 || (cause.meta.status >= 200 && cause.meta.status < 300)))) recovery.value = 'unknown'
      else error.value = 'saveFailed'
    } finally { if (current()) saving.value = false }
  }
  /** Authorizes focus only for the current mounted account and grants. */
  function canRestoreFocus() { return focusRestorable && authorized() }
  return { targets, draft, preview, approved, saving, loading, recovery, unknown, error, canConfirm, open, close, reset, reload, canRestoreFocus,
    setFromTag: (value: unknown) => edit('from', value), setToTag: (value: unknown) => edit('to', value),
    get approve() { const opening = generation, draftRevision = revision, value = preview.value; return () => approve(opening, draftRevision, value) },
    get confirm() { const opening = generation, draftRevision = revision, value = approved.value; return () => confirm(opening, draftRevision, value) },
  }
}
