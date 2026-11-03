import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { noteIdSchema, readOwnNote, readAdminNote, updateOwnNote, updateAdminNote, type NoteResult } from '@/entities/short-link/note'
import { ApiClientError } from '@/shared/api/client'
import { shortLinkNoteSchema } from '@/shared/validation/shortLinkNote'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

export interface NoteTarget { id: string; url: string }
type Access = ReturnType<typeof useShortLinkAccess>

/** Owns one private editor and retires every completion with its identity, grants and opening. */
export function useShortLinkNote(context: 'own' | 'admin', access: Access) {
  const client = useQueryClient()
  const { t } = useI18n()
  const target = shallowRef<NoteTarget | null>(null)
  const data = shallowRef<NoteResult | null>(null)
  const { defineField } = useForm({ initialValues: { note: '' } })
  const [draft] = defineField('note')
  const loading = ref(false), saving = ref(false)
  const error = ref<'' | 'loadFailed' | 'saveFailed'>('')
  const blocked = ref<'' | 'conflict' | 'unknown'>('')
  const parsed = computed(() => shortLinkNoteSchema.safeParse(draft.value))
  const dirty = computed(() => data.value !== null && draft.value !== data.value.note)
  const canWrite = computed(() => access.canTag.value)
  let generation = 0, operation = 0, alive = true
  let scope = access.identity.scope.value
  let grants = ''
  let key: readonly unknown[] = []
  const read = context === 'own' ? readOwnNote : readAdminNote
  const update = context === 'own' ? updateOwnNote : updateAdminNote
  /** Reads effective grants synchronously, including revoke/restore within one render tick. */
  function signature() { return `${access.allows('read')}:${access.allows('tags')}` }
  /** Drops all private text and cache state; a late request cannot revive the opening. */
  function retire() {
    generation++; operation++
    const oldKey = key
    key = []; target.value = null; data.value = null; draft.value = ''
    loading.value = false; saving.value = false; error.value = ''; blocked.value = ''
    if (oldKey.length) { void client.cancelQueries({ queryKey: oldKey, exact: true }); client.removeQueries({ queryKey: oldKey, exact: true }) }
  }
  /** Captures the exact request generation rather than comparing reusable account IDs. */
  function capture() {
    const opening = generation, request = ++operation, id = target.value!.id, account = scope
    return () => alive && generation === opening && operation === request && target.value?.id === id
      && access.identity.isCurrent(account) && signature() === grants && access.allows('read')
  }
  const canSave = computed(() => !!target.value && !!data.value && canWrite.value && dirty.value && parsed.value.success
    && !loading.value && !saving.value && !blocked.value)
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (target.value && event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me'
      && (!access.identity.isCurrent(scope) || signature() !== grants)) retire()
  })
  onBeforeUnmount(() => { alive = false; unsubscribe(); retire() })
  /** Retires denied resources immediately and refreshes only the relevant authorization boundary. */
  function denied(cause: unknown) {
    if (!(cause instanceof ApiClientError) || ![120001, 200104, 401, 403].includes(cause.code)) return false
    toast.error(t('linkNote.accessChanged'))
    retire()
    if (cause.code !== 200104) void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
    else void client.invalidateQueries({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'] })
    return true
  }
  /** Explicitly replaces the draft only after a successful read; failed recovery stays frozen. */
  async function reload() {
    if (!target.value || loading.value || saving.value || !access.identity.isCurrent(scope) || signature() !== grants) return
    const recoveringUnknown = blocked.value === 'unknown'
    const isCurrent = capture(), id = target.value.id, userId = scope.userId
    loading.value = true; error.value = ''
    try {
      const value = await client.fetchQuery({ queryKey: key, queryFn: () => read(id, userId), staleTime: 0, retry: false })
      await nextTick()
      if (!isCurrent()) return
      data.value = value; draft.value = value.note; blocked.value = ''
      if (recoveringUnknown) refreshLists()
    } catch (cause) {
      await nextTick()
      if (isCurrent() && !denied(cause)) error.value = 'loadFailed'
    } finally { if (isCurrent()) loading.value = false }
  }
  /** Refreshes the matching list family only after this opening confirms a write or its readback. */
  function refreshLists() {
    void client.invalidateQueries({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'] })
  }
  /** Starts a fresh cache family for this account epoch, permission state, resource and opening. */
  function open(value: NoteTarget) {
    if (saving.value || !access.allows('read') || !noteIdSchema.safeParse(value.id).success
      || !noteIdSchema.safeParse(access.identity.scope.value.userId).success) return
    retire(); scope = access.identity.scope.value; grants = signature()
    target.value = { id: value.id, url: value.url }
    key = ['short-link-note', context, scope.userId, scope.epoch, grants, value.id, generation]
    void reload()
  }
  /** Prevents ordinary dismissal while a write is outstanding. */
  function close() { if (!saving.value) retire() }
  /** Accepts user edits only in a loaded, writable opening. */
  function edit(value: string) { if (canWrite.value && data.value && !loading.value && !saving.value) draft.value = value }
  /** Keeps clearing local until the user explicitly saves. */
  function clear() { if (canWrite.value && data.value && !loading.value && !saving.value && !blocked.value) draft.value = '' }
  /** Sends the independent note version once and never replays an uncertain write. */
  async function save() {
    if (!canSave.value || !access.identity.isCurrent(scope) || signature() !== grants || !access.allows('tags')) return
    const isCurrent = capture(), input = { id: target.value!.id, note: parsed.value.data!, expectedUpdatedAt: data.value!.updatedAt }, userId = scope.userId
    saving.value = true; error.value = ''
    try {
      const value = await update(input, userId)
      await nextTick()
      if (!isCurrent()) return
      data.value = value; draft.value = value.note
      client.setQueryData(key, value)
      refreshLists()
      toast.success(t('linkNote.saved'))
    } catch (cause) {
      await nextTick()
      if (!isCurrent() || denied(cause)) return
      if (cause instanceof ApiClientError && cause.code === 200116) blocked.value = 'conflict'
      else if (!(cause instanceof ApiClientError) || cause.meta.invalidNoteResponse || cause.code === 900000
        || (typeof cause.meta.status === 'number' && (cause.meta.status >= 500 || (cause.meta.status >= 200 && cause.meta.status < 300)))) blocked.value = 'unknown'
      else error.value = 'saveFailed'
    } finally { if (isCurrent()) saving.value = false }
  }
  return { target, data, draft, loading, saving, error, blocked, parsed, dirty, canWrite, canSave, open, close, reset: retire, edit, clear, reload, save }
}
