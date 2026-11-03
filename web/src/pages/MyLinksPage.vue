<template>
  <section class="console-page" data-testid="console-page-links">
    <header class="console-page__header">
      <div>
        <h1>{{ t('page.links') }}</h1>
      </div>
      <div class="bulk-create-header-actions">
        <BulkCreateDialog @open="bulkCreateOpen = $event" />
        <ShortLinkListExportButton context="own" :filters="exportFilters" :blocked="exportBlocked" @pending="exportPending = $event" />
      </div>
    </header>
    <div class="console-page__tools">
      <div class="console-page__filters console-page__metadata-filters" data-testid="console-page-toolbar">
        <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" density="compact" variant="outlined" />
        <v-select :model-value="noteStatusFilter" :items="noteStatusOptions" :label="t('filter.noteStatus')" :disabled="noteFilterBlocked" density="compact" variant="outlined" @update:model-value="selectNoteStatus" />
        <v-text-field v-model="searchKeyword" :label="t('filter.keyword')" :error-messages="keywordInvalid ? t('linkMetadata.keywordInvalid') : ''" density="compact" variant="outlined" />
        <v-text-field v-model="tagFilter" :label="t('filter.tag')" :error-messages="tagInvalid ? t('linkMetadata.tagFilterInvalid') : ''" density="compact" variant="outlined" />
        <v-text-field :model-value="noteQuery" :label="t('filter.noteQuery')" :error-messages="noteQueryInvalid ? t('linkMetadata.noteQueryInvalid') : ''" :disabled="noteFilterBlocked || note.target.value !== null" density="compact" variant="outlined" @update:model-value="selectNoteQuery" />
      </div>
      <ShortLinkBatchToolbar :state="batch" :access="access" @tags="beginBatchTags" />
    </div>
    <PersonalTagBrowser :access="access" @select="tagFilter = $event" />
    <div class="console-data-panel" data-testid="console-data-panel">
      <v-alert v-if="query.isError.value || (!access.canRead.value && !access.authPending.value)" type="error" variant="tonal">{{ t('links.loadFailed') }}</v-alert>
      <v-progress-linear v-else-if="access.authPending.value || (access.canRead.value && query.isPending.value)" indeterminate />
      <div v-else-if="access.canRead.value && links.length === 0" class="console-page__empty">
        <div>
          <h2>{{ t('links.emptyTitle') }}</h2>
          <p>{{ t('links.emptyOwnDescription') }}</p>
        </div>
      </div>
      <ConsoleLinkList
        v-else-if="access.canRead.value"
        analytics-scope="own"
        :deleting-id="deletingId"
        :links="linkItems"
        :updating-id="updatingId"
        :selectable="access.canSelect.value"
        :selected-ids="batch.selected.value"
        :all-selected="batch.allSelected.value"
        :indeterminate="batch.indeterminate.value"
        :selection-disabled="batch.unavailable.value"
        :write-disabled="rowWriteBlocked"
        :can-note="access.canRead.value"
        :note-disabled="exportBlocked || exportPending || !!qrLink"
        @select="batch.toggle"
        @select-all="batch.toggleAll"
        @configure="configureLink"
        @copy="copyUrl"
        @qr="showLinkQr"
        @note="beginNote"
        @remove="remove"
        @toggle-status="toggleStatus"
      />
    </div>
    <ShortLinkPagination v-if="access.canRead.value" :page="page" :total="paginationTotal" :pending="query.isFetching.value" :failed="query.isError.value" :blocked="paginationBlocked" @change="changePage" @retry="retryPage" />
  </section>
  <ShortLinkSettingsDialog
    v-if="settingsLink"
    :error-message="settingsErrorMessage"
    :link="settingsLink"
    :open="true"
    :pending="settingsMutation.isPending.value"
    @save="saveSettings"
    @update:open="closeSettings"
  />
  <ShortLinkQrDialog
    v-if="qrLink"
    :open="true"
    :slug="qrLink.slug"
    :url="qrLink.url"
    @update:open="closeQr"
  />
  <ShortLinkBatchTagsDialog v-if="batchTagTargets" context="own" :targets="batchTagTargets" @close="batchTagTargets = null" @saved="batch.clear" @revoked="batch.clear" @conflict="batchTagsRefreshRequired = true" />
  <ShortLinkNoteDialog v-if="note.target.value" :state="note" />
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteShortLink, listShortLinks, updateShortLink, type ShortLinkNoteStatus } from '@/entities/short-link/api'
import type { ShortLink } from '@/entities/short-link/model'
import { useMutationTargetId } from '@/shared/mutations/useMutationTargetId'
import { useShortLinkSettings } from '@/shared/short-link/useShortLinkSettings'
import { useShortLinkFilters } from '@/shared/short-link/useShortLinkFilters'
import ShortLinkSettingsDialog from '@/features/short-link-settings/ShortLinkSettingsDialog.vue'
import ShortLinkQrDialog from '@/features/short-link-qr/ShortLinkQrDialog.vue'
import ConsoleLinkList, { type ConsoleLinkListItem } from './ConsoleLinkList.vue'
import { useShortLinkAccess, useShortLinkBatch } from '@/features/short-link-batch/useShortLinkBatch'
import ShortLinkBatchToolbar from '@/features/short-link-batch/ShortLinkBatchToolbar.vue'
import ShortLinkListExportButton from '@/features/short-link-list-export/ShortLinkListExportButton.vue'
import BulkCreateDialog from '@/features/bulk-create/BulkCreateDialog.vue'
import ShortLinkBatchTagsDialog from '@/features/short-link-tags/ShortLinkBatchTagsDialog.vue'
import PersonalTagBrowser from '@/features/short-link-tags/PersonalTagBrowser.vue'
import ShortLinkNoteDialog from '@/features/short-link-note/ShortLinkNoteDialog.vue'
import { useShortLinkNote } from '@/features/short-link-note/useShortLinkNote'
import ShortLinkPagination from '@/features/short-link-pagination/ShortLinkPagination.vue'
import { nextShortLinkListRevision } from '@/shared/short-link/listRevision'
import { searchOwnNotes } from '@/entities/short-link/note-search'
import { batchTagVersionSchema, type BatchTagTarget } from '@/entities/short-link/batch-tags'

const { t } = useI18n()
const queryClient = useQueryClient()
const access = useShortLinkAccess('own')
const note = useShortLinkNote('own', access)
const batchTagTargets = ref<readonly BatchTagTarget[] | null>(null)
const batchTagsRefreshRequired = ref(false)
const exportPending = ref(false)
const bulkCreateOpen = ref(false)
const statusFilter = ref<'' | ShortLink['status']>('')
const noteStatusFilter = ref<ShortLinkNoteStatus>('')
const { searchKeyword, tagFilter, noteQuery, debouncedKeyword, debouncedTag, debouncedNoteQuery, keywordInvalid, tagInvalid, noteQueryInvalid, noteQueryPending, filtersPending } = useShortLinkFilters()
// Private text belongs to one login epoch; resetting the draft also retires its pending debounce.
watch(access.identity.scope, () => { noteQuery.value = ''; debouncedNoteQuery.value = '' }, { flush: 'sync' })
const statusOptions = computed(() => [
  { title: t('filter.all'), value: '' },
  { title: t('filter.active'), value: 'active' },
  { title: t('filter.disabled'), value: 'disabled' },
])
const noteStatusOptions = computed(() => [
  { title: t('filter.all'), value: '' },
  { title: t('filter.notePresent'), value: 'present' },
  { title: t('filter.noteAbsent'), value: 'absent' },
])
const page = ref(1)
const listRevision = ref(nextShortLinkListRevision())
watch([statusFilter, debouncedKeyword, debouncedTag, noteStatusFilter, debouncedNoteQuery, access.identity.scope], () => { page.value = 1; listRevision.value = nextShortLinkListRevision() }, { flush: 'sync' })
watch(page, () => { listRevision.value = nextShortLinkListRevision() }, { flush: 'sync' })
let readAllowed = access.allows('read')
const unsubscribeList = queryClient.getQueryCache().subscribe(event => {
  if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'me') return
  const allowed = access.allows('read')
  if (allowed !== readAllowed) { readAllowed = allowed; page.value = 1; listRevision.value = nextShortLinkListRevision() }
})
onBeforeUnmount(unsubscribeList)
const listQueryKey = computed(() => ['short-link', statusFilter.value, debouncedKeyword.value, debouncedTag.value, access.identity.scope.value.userId, access.identity.scope.value.epoch, listRevision.value, noteStatusFilter.value, page.value, debouncedNoteQuery.value] as const)
const query = useQuery({
  queryKey: listQueryKey,
  enabled: computed(() => access.canRead.value && !noteQueryInvalid.value && !noteQueryPending.value),
  gcTime: 0,
  queryFn: (context) => {
    const [, status, q, tag, userId, , , noteStatus, requestPage, noteQuery] = context.queryKey
    const input = { page: requestPage, pageSize: 20, status, q, tag }
    return noteQuery ? searchOwnNotes({ ...input, noteStatus, noteQuery }, userId, context.signal) : listShortLinks({ ...input, ...(noteStatus ? { noteStatus } : {}) })
  },
})
const links = computed(() => access.canRead.value ? query.data.value?.items ?? [] : [])
const linkItems = computed<ConsoleLinkListItem[]>(() => links.value)
const {
  closeQr,
  closeSettings,
  configure,
  qrLink,
  saveSettings,
  settingsErrorMessage,
  settingsLink,
  settingsMutation,
  showQr,
} = useShortLinkSettings({ mutationFn: updateShortLink, queryKey: ['short-link'] })

const statusMutation = useMutation({
  mutationFn: updateShortLink,
  onSuccess: invalidateLinks,
  onError: () => toast.error(t('feedback.failed')),
})
const deleteMutation = useMutation({
  mutationFn: deleteShortLink,
  onSuccess() {
    toast.success(t('feedback.deleted'))
    void queryClient.invalidateQueries({ queryKey: ['short-link'] })
  },
  onError: () => toast.error(t('feedback.failed')),
})
const updatingId = useMutationTargetId(statusMutation, (variables) => variables?.id)
const deletingId = useMutationTargetId(deleteMutation, (variables) => (typeof variables === 'string' ? variables : undefined))
const batch = useShortLinkBatch({
  context: 'own', access, ids: computed(() => links.value.map(link => link.id)),
  filters: computed(() => [statusFilter.value, searchKeyword.value, tagFilter.value, noteStatusFilter.value, noteQuery.value, page.value]),
  blocked: computed(() => note.target.value !== null || !query.isSuccess.value || query.isFetching.value || batchTagsRefreshRequired.value || batchTagTargets.value !== null || exportPending.value || filtersPending.value || keywordInvalid.value || tagInvalid.value || noteQueryInvalid.value || statusMutation.isPending.value || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null),
})
const rowWriteBlocked = computed(() => noteQueryInvalid.value || noteQueryPending.value || note.target.value !== null || batch.pending.value || batch.deleteIds.value !== null || batchTagTargets.value !== null)
watch([statusFilter, searchKeyword, tagFilter, noteQuery, noteStatusFilter, page], note.reset, { flush: 'sync' })
watch([query.isFetching, query.isSuccess], ([fetching, success]) => { if (!fetching && success) batchTagsRefreshRequired.value = false })
const exportFilters = computed(() => ({ status: statusFilter.value, q: debouncedKeyword.value, tag: debouncedTag.value, noteStatus: noteStatusFilter.value, ...(debouncedNoteQuery.value ? { noteQuery: debouncedNoteQuery.value } : {}) }))
const exportBlocked = computed(() => !access.canRead.value || !query.isSuccess.value || query.isFetching.value
  || keywordInvalid.value || tagInvalid.value || noteQueryInvalid.value || filtersPending.value || statusMutation.isPending.value
  || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null || rowWriteBlocked.value)
const noteFilterBlocked = computed(() => !access.canRead.value || note.saving.value || batch.pending.value || batch.deleteIds.value !== null
  || batchTagTargets.value !== null || statusMutation.isPending.value || deleteMutation.isPending.value
  || settingsMutation.isPending.value || settingsLink.value !== null || qrLink.value !== null)

const paginationBlocked = computed(() => noteFilterBlocked.value || note.target.value !== null || exportPending.value || bulkCreateOpen.value
  || filtersPending.value || keywordInvalid.value || tagInvalid.value || noteQueryInvalid.value)
const paginationTotal = computed(() => {
  const total = query.data.value?.meta.total
  return access.canRead.value && !filtersPending.value && !keywordInvalid.value && !tagInvalid.value && !noteQueryInvalid.value && query.isSuccess.value && !query.isFetching.value && Number.isSafeInteger(total) && total! >= 0 ? total : undefined
})
watch([paginationTotal, paginationBlocked, page], ([total, blocked]) => {
  if (blocked || total === undefined || !access.allows('read')) return
  const lastPage = Math.max(1, Math.ceil(total / 20))
  if (page.value > lastPage) page.value = lastPage
})

/** Validates live authority, operation locks and the current page before retiring its collection. */
function changePage(value: number) {
  if (paginationBlocked.value || !access.allows('read') || !Number.isSafeInteger(value) || value < 1 || Math.abs(value - page.value) !== 1) return
  const state = queryClient.getQueryState(listQueryKey.value)
  if (value > page.value && (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || paginationTotal.value === undefined || value > Math.ceil(paginationTotal.value / 20))) return
  page.value = value
}

/** Retries only this page's failed read without guessing a new collection or issuing a write. */
function retryPage() {
  if (!paginationBlocked.value && access.allows('read') && query.isError.value && !query.isFetching.value) void query.refetch()
}

/** Rejects queued changes against live grants and write locks while allowing a new filter during a read. */
/** Rechecks live authority and editor locks before accepting a queued private filter edit. */
function selectNoteQuery(value: unknown) {
  if (noteFilterBlocked.value || note.target.value !== null || !access.allows('read') || typeof value !== 'string') return
  noteQuery.value = value
}

function selectNoteStatus(value: unknown) {
  if (noteFilterBlocked.value || !access.allows('read') || (value !== '' && value !== 'present' && value !== 'absent')) return
  noteStatusFilter.value = value
}

/** Requires a successful live list and captures only real, complete management versions. */
function beginBatchTags() {
  const state = queryClient.getQueryState(listQueryKey.value)
  if (batch.unavailable.value || rowWriteBlocked.value || !access.allows('tags') || !batch.selected.value.length || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated) return
  const targets = links.value.filter(link => batch.selected.value.includes(link.id))
  if (targets.length !== batch.selected.value.length || targets.some(link => !batchTagVersionSchema.safeParse(link.updatedAt).success)) return
  batchTagTargets.value = targets.map(link => ({ id: link.id, updatedAt: link.updatedAt!, url: link.url, tags: [...link.tags] }))
}

/** Prevents opening row settings while a batch is outstanding. */
function configureLink(link: ConsoleLinkListItem) { if (!rowWriteBlocked.value) configure(link) }

/** Rechecks the live list and all competing operations before reading private text. */
function beginNote(link: ConsoleLinkListItem) {
  const state = queryClient.getQueryState(listQueryKey.value)
  if (exportBlocked.value || exportPending.value || qrLink.value || !access.allows('read') || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated) return
  const current = links.value.find(value => value.id === link.id)
  if (current) note.open(current)
}
/** Keeps QR and note dialogs mutually exclusive even for a queued menu click. */
function showLinkQr(link: ConsoleLinkListItem) { if (!rowWriteBlocked.value) showQr(link) }

/** Toggles an owned short link through the personal update mutation. */
function toggleStatus(link: ConsoleLinkListItem) {
  if (rowWriteBlocked.value) return
  statusMutation.mutate({ id: link.id, status: link.status === 'active' ? 'disabled' : 'active' })
}

/** Starts a soft-delete for the selected owned short link. */
function remove(id: string) {
  if (rowWriteBlocked.value) return
  deleteMutation.mutate(id)
}

/** Copies a public short-link URL when the Clipboard API is available. */
function copyUrl(url: string) {
  void navigator.clipboard?.writeText(url)
}

/** Refreshes every cached personal short-link list after a mutation. */
function invalidateLinks() {
  toast.success(t('feedback.saved'))
  void queryClient.invalidateQueries({ queryKey: ['short-link'] })
}
</script>

<style scoped>
.bulk-create-header-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.console-page__tools { display: grid; }
.console-page__metadata-filters {
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

@media (max-width: 760px) {
  .console-page__metadata-filters {
    grid-template-columns: 1fr;
  }
}
</style>
