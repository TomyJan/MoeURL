<template>
  <section class="console-page" data-testid="console-page-admin-links">
    <div class="console-page__header">
      <div>
        <h1>{{ t('page.adminLinks') }}</h1>
      </div>
      <span v-if="paginationTotal !== undefined" class="console-page__total">{{ t('adminLinks.total', { total }) }}</span>
      <ShortLinkListExportButton context="admin" :filters="exportFilters" :blocked="exportBlocked" @pending="exportPending = $event" />
    </div>
    <div class="console-page__tools">
      <div class="console-page__filters console-page__metadata-filters">
        <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" density="compact" variant="outlined" />
        <v-select :model-value="noteStatusFilter" :items="noteStatusOptions" :label="t('filter.noteStatus')" :disabled="noteFilterBlocked" density="compact" variant="outlined" @update:model-value="selectNoteStatus" />
        <v-text-field v-model="searchKeyword" :label="t('filter.keyword')" :error-messages="keywordInvalid ? t('linkMetadata.keywordInvalid') : ''" density="compact" variant="outlined" />
        <v-text-field v-model="tagFilter" :label="t('filter.tag')" :error-messages="tagInvalid ? t('linkMetadata.tagFilterInvalid') : ''" density="compact" variant="outlined" />
        <v-text-field :model-value="noteQuery" :label="t('filter.noteQuery')" :error-messages="noteQueryInvalid ? t('linkMetadata.noteQueryInvalid') : ''" :disabled="noteFilterBlocked || note.target.value !== null" density="compact" variant="outlined" @update:model-value="selectNoteQuery" />
      </div>
      <ShortLinkBatchToolbar :state="batch" :access="access" transfer @transfer="beginBatchTransfer" @tags="beginBatchTags" />
    </div>
    <AdminTagBrowser :access="access" :blocked="tagSelectionBlocked" @select="selectCatalogTag" />
    <div class="console-data-panel" data-testid="console-data-panel">
      <v-alert v-if="query.isError.value || (!access.canRead.value && !access.authPending.value)" type="error" variant="tonal">{{ t('adminLinks.loadFailed') }}</v-alert>
      <v-progress-linear v-else-if="access.authPending.value || (access.canRead.value && query.isPending.value)" indeterminate />
      <div v-else-if="access.canRead.value && links.length === 0" class="console-page__empty">
        <div>
          <h2>{{ t('links.emptyTitle') }}</h2>
          <p>{{ t('adminLinks.emptyDescription') }}</p>
        </div>
      </div>
      <ConsoleLinkList
        v-else-if="access.canRead.value"
        analytics-scope="admin"
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
        :can-transfer="canTransfer"
        @select="batch.toggle"
        @select-all="batch.toggleAll"
        @configure="configureLink"
        @transfer="beginTransfer"
        @copy="copyUrl"
        @qr="showLinkQr"
        @note="beginNote"
        @remove="remove"
        @toggle-status="toggleStatus"
      />
    </div>
    <ShortLinkPagination v-if="access.canRead.value" :page="page" :page-size="pageSize" :total="paginationTotal" :pending="query.isFetching.value" :failed="query.isError.value" :blocked="paginationBlocked" @change="changePage" @size="changePageSize" @retry="retryPage" />
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
  <ShortLinkTransferDialog v-if="transferTarget" :target="transferTarget" @close="transferTarget = null" />
  <ShortLinkBatchTransferDialog v-if="batchTransferTargets" :targets="batchTransferTargets" @close="batchTransferTargets = null" @transferred="batch.clear" @conflict="batchTransferRefreshRequired = true" />
  <ShortLinkBatchTagsDialog v-if="batchTagTargets" context="admin" :targets="batchTagTargets" @close="batchTagTargets = null" @saved="batch.clear" @revoked="batch.clear" @conflict="batchTagsRefreshRequired = true" />
  <ShortLinkNoteDialog v-if="note.target.value" :state="note" />
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteAdminShortLink, listAdminShortLinks, updateAdminShortLink, type ShortLinkNoteStatus } from '@/entities/short-link/api'
import type { AdminShortLink } from '@/entities/short-link/model'
import ShortLinkSettingsDialog from '@/features/short-link-settings/ShortLinkSettingsDialog.vue'
import ShortLinkQrDialog from '@/features/short-link-qr/ShortLinkQrDialog.vue'
import { useMutationTargetId } from '@/shared/mutations/useMutationTargetId'
import { useShortLinkSettings } from '@/shared/short-link/useShortLinkSettings'
import { useShortLinkFilters } from '@/shared/short-link/useShortLinkFilters'
import ConsoleLinkList, { type ConsoleLinkListItem } from './ConsoleLinkList.vue'
import { useShortLinkAccess, useShortLinkBatch } from '@/features/short-link-batch/useShortLinkBatch'
import ShortLinkBatchToolbar from '@/features/short-link-batch/ShortLinkBatchToolbar.vue'
import ShortLinkTransferDialog from '@/features/short-link-transfer/ShortLinkTransferDialog.vue'
import ShortLinkBatchTransferDialog from '@/features/short-link-transfer/ShortLinkBatchTransferDialog.vue'
import ShortLinkListExportButton from '@/features/short-link-list-export/ShortLinkListExportButton.vue'
import ShortLinkBatchTagsDialog from '@/features/short-link-tags/ShortLinkBatchTagsDialog.vue'
import { batchTagVersionSchema, type BatchTagTarget } from '@/entities/short-link/batch-tags'
import AdminTagBrowser from '@/features/short-link-tags/AdminTagBrowser.vue'
import ShortLinkNoteDialog from '@/features/short-link-note/ShortLinkNoteDialog.vue'
import { useShortLinkNote } from '@/features/short-link-note/useShortLinkNote'
import ShortLinkPagination from '@/features/short-link-pagination/ShortLinkPagination.vue'
import { DEFAULT_SHORT_LINK_PAGE_SIZE, isShortLinkPageSize, type ShortLinkPageSize } from '@/features/short-link-pagination/pageSize'
import { nextShortLinkListRevision } from '@/shared/short-link/listRevision'
import { searchAdminNotes } from '@/entities/short-link/note-search'

const { t } = useI18n()
const queryClient = useQueryClient()
const access = useShortLinkAccess('admin')
const note = useShortLinkNote('admin', access)
const batchTagTargets = ref<readonly BatchTagTarget[] | null>(null)
const batchTagsRefreshRequired = ref(false)
const transferTarget = ref<AdminShortLink | null>(null)
const batchTransferTargets = ref<readonly AdminShortLink[] | null>(null)
const batchTransferRefreshRequired = ref(false)
const exportPending = ref(false)
const statusFilter = ref<'' | AdminShortLink['status']>('')
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
const pageSize = ref<ShortLinkPageSize>(DEFAULT_SHORT_LINK_PAGE_SIZE)
watch(access.identity.scope, () => { pageSize.value = DEFAULT_SHORT_LINK_PAGE_SIZE }, { flush: 'sync' })
const listRevision = ref(nextShortLinkListRevision())
watch([statusFilter, debouncedKeyword, debouncedTag, noteStatusFilter, debouncedNoteQuery, access.identity.scope], () => { page.value = 1; listRevision.value = nextShortLinkListRevision() }, { flush: 'sync' })
watch([page, pageSize], () => { listRevision.value = nextShortLinkListRevision() }, { flush: 'sync' })
let readAllowed = access.allows('read')
const unsubscribeList = queryClient.getQueryCache().subscribe(event => {
  if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'me') return
  const allowed = access.allows('read')
  if (allowed !== readAllowed) { readAllowed = allowed; pageSize.value = DEFAULT_SHORT_LINK_PAGE_SIZE; page.value = 1; listRevision.value = nextShortLinkListRevision() }
})
onBeforeUnmount(unsubscribeList)
const listQueryKey = computed(() => ['admin-short-link', statusFilter.value, debouncedKeyword.value, debouncedTag.value, access.identity.scope.value.userId, access.identity.scope.value.epoch, listRevision.value, noteStatusFilter.value, page.value, debouncedNoteQuery.value, pageSize.value] as const)
const query = useQuery({
  queryKey: listQueryKey,
  enabled: computed(() => access.canRead.value && !noteQueryInvalid.value && !noteQueryPending.value),
  gcTime: 0,
  queryFn: (context) => {
    const [, status, q, tag, userId, , , noteStatus, requestPage, noteQuery, requestPageSize] = context.queryKey
    const input = { page: requestPage, pageSize: requestPageSize, status, q, tag }
    return noteQuery ? searchAdminNotes({ ...input, noteStatus, noteQuery }, userId, context.signal) : listAdminShortLinks({ ...input, ...(noteStatus ? { noteStatus } : {}) })
  },
})
const links = computed(() => access.canRead.value ? query.data.value?.items ?? [] : [])
const linkItems = computed<ConsoleLinkListItem[]>(() => links.value)
const total = computed(() => paginationTotal.value)
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
} = useShortLinkSettings({ mutationFn: updateAdminShortLink, queryKey: ['admin-short-link'] })

const statusMutation = useMutation({
  mutationFn: updateAdminShortLink,
  onSuccess: invalidateLinks,
  onError: () => toast.error(t('feedback.failed')),
})
const deleteMutation = useMutation({
  mutationFn: deleteAdminShortLink,
  onSuccess() {
    toast.success(t('feedback.deleted'))
    void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
  },
  onError: () => toast.error(t('feedback.failed')),
})
const updatingId = useMutationTargetId(statusMutation, (variables) => variables?.id)
const deletingId = useMutationTargetId(deleteMutation, (variables) => (typeof variables === 'string' ? variables : undefined))
const batch = useShortLinkBatch({
  context: 'admin', access, ids: computed(() => links.value.map(link => link.id)),
  filters: computed(() => [statusFilter.value, searchKeyword.value, tagFilter.value, noteStatusFilter.value, noteQuery.value, page.value, pageSize.value]),
  blocked: computed(() => note.target.value !== null || !query.isSuccess.value || query.isFetching.value || batchTagsRefreshRequired.value || batchTagTargets.value !== null || batchTransferRefreshRequired.value || exportPending.value || keywordInvalid.value || tagInvalid.value || noteQueryInvalid.value || filtersPending.value || statusMutation.isPending.value || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null || transferTarget.value !== null || batchTransferTargets.value !== null),
})
const rowWriteBlocked = computed(() => noteQueryInvalid.value || noteQueryPending.value || note.target.value !== null || batch.pending.value || batchTagTargets.value !== null || transferTarget.value !== null || batchTransferTargets.value !== null || batch.deleteIds.value !== null)
watch([statusFilter, searchKeyword, tagFilter, noteQuery, noteStatusFilter, page, pageSize], note.reset, { flush: 'sync' })
const canTransfer = computed(() => access.canUpdate.value && query.isSuccess.value && !query.isFetching.value && !filtersPending.value && !keywordInvalid.value && !tagInvalid.value && !noteQueryInvalid.value)
watch([access.identity.scope, access.canUpdate], () => { batchTransferTargets.value = null; batch.clear() }, { flush: 'sync' })
watch([query.isFetching, query.isSuccess], ([fetching, success]) => { if (!fetching && success) batchTransferRefreshRequired.value = false })
watch([query.isFetching, query.isSuccess], ([fetching, success]) => { if (!fetching && success) batchTagsRefreshRequired.value = false })
const exportFilters = computed(() => ({ status: statusFilter.value, q: debouncedKeyword.value, tag: debouncedTag.value, noteStatus: noteStatusFilter.value, ...(debouncedNoteQuery.value ? { noteQuery: debouncedNoteQuery.value } : {}) }))
const exportBlocked = computed(() => !access.canRead.value || !query.isSuccess.value || query.isFetching.value
  || keywordInvalid.value || tagInvalid.value || noteQueryInvalid.value || filtersPending.value || statusMutation.isPending.value
  || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null || rowWriteBlocked.value)
const tagSelectionBlocked = computed(() => exportPending.value || exportBlocked.value)
const noteFilterBlocked = computed(() => !access.canRead.value || note.saving.value || batch.pending.value || batch.deleteIds.value !== null
  || batchTagTargets.value !== null || transferTarget.value !== null || batchTransferTargets.value !== null
  || statusMutation.isPending.value || deleteMutation.isPending.value || settingsMutation.isPending.value
  || settingsLink.value !== null || qrLink.value !== null)

const paginationBlocked = computed(() => noteFilterBlocked.value || note.target.value !== null || exportPending.value
  || filtersPending.value || keywordInvalid.value || tagInvalid.value || noteQueryInvalid.value)
const paginationTotal = computed(() => {
  const total = query.data.value?.meta.total
  return access.canRead.value && !filtersPending.value && !keywordInvalid.value && !tagInvalid.value && !noteQueryInvalid.value && query.isSuccess.value && !query.isFetching.value && Number.isSafeInteger(total) && total! >= 0 ? total : undefined
})
watch([paginationTotal, paginationBlocked, page, pageSize], ([total, blocked]) => {
  if (blocked || total === undefined || !access.allows('read')) return
  const lastPage = Math.max(1, Math.ceil(total / pageSize.value))
  if (page.value > lastPage) page.value = lastPage
})

/** Validates live authority, operation locks and the current page before retiring its collection. */
function changePage(value: number) {
  if (paginationBlocked.value || !access.allows('read') || !Number.isSafeInteger(value) || value < 1 || Math.abs(value - page.value) !== 1) return
  const state = queryClient.getQueryState(listQueryKey.value)
  if (value > page.value && (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || paginationTotal.value === undefined || value > Math.ceil(paginationTotal.value / pageSize.value))) return
  page.value = value
}

/** Retires the collection only for a supported size accepted under live authority and operation locks. */
function changePageSize(value: unknown) {
  if (paginationBlocked.value || !access.allows('read') || !isShortLinkPageSize(value) || value === pageSize.value) return
  pageSize.value = value
  page.value = 1
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

/** Rechecks live parent state so a queued catalog click cannot bypass another active operation. */
function selectCatalogTag(tag: string) {
  const state = queryClient.getQueryState(listQueryKey.value)
  if (tagSelectionBlocked.value || !access.allows('read') || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated) return
  tagFilter.value = tag
}

/** Captures real list versions only while the live cache and metadata grants are valid. */
function beginBatchTags() {
  const state = queryClient.getQueryState(listQueryKey.value)
  if (batch.unavailable.value || rowWriteBlocked.value || !access.allows('tags') || !batch.selected.value.length || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated) return
  const targets = links.value.filter(link => batch.selected.value.includes(link.id))
  if (targets.length !== batch.selected.value.length || targets.some(link => !batchTagVersionSchema.safeParse(link.updatedAt).success)) return
  batchTagTargets.value = targets.map(link => ({ id: link.id, updatedAt: link.updatedAt, url: link.url, tags: [...link.tags] }))
}

/** Opens one immutable administrative link snapshot without overlapping other writes. */
function beginTransfer(link: ConsoleLinkListItem) {
  if (!canTransfer.value || rowWriteBlocked.value || statusMutation.isPending.value || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null || !access.allows('update')) return
  const target = links.value.find(value => value.id === link.id)
  if (target) transferTarget.value = { ...target, owner: { ...target.owner } }
}

/** Captures only selected current-list records after checking the live list and grants. */
function beginBatchTransfer() {
  if (!canTransfer.value || batch.unavailable.value || rowWriteBlocked.value || queryClient.isFetching({ queryKey: listQueryKey.value, exact: true }) || queryClient.getQueryState(listQueryKey.value)?.isInvalidated !== false || !access.allows('update') || !batch.selected.value.length) return
  batchTransferTargets.value = links.value.filter(link => batch.selected.value.includes(link.id)).map(link => ({ ...link, owner: { ...link.owner } }))
}

/** Prevents opening row settings while a batch is outstanding. */
function configureLink(link: ConsoleLinkListItem) { if (!rowWriteBlocked.value) configure(link) }

/** Reads only a still-visible authorized row after checking the live cache and operation locks. */
function beginNote(link: ConsoleLinkListItem) {
  const state = queryClient.getQueryState(listQueryKey.value)
  if (exportBlocked.value || exportPending.value || qrLink.value || !access.allows('read') || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated) return
  const current = links.value.find(value => value.id === link.id)
  if (current) note.open(current)
}
/** Keeps QR and note dialogs mutually exclusive even for a queued menu click. */
function showLinkQr(link: ConsoleLinkListItem) { if (!rowWriteBlocked.value) showQr(link) }

/** Toggles a short link through the administrative update mutation. */
function toggleStatus(link: ConsoleLinkListItem) {
  if (rowWriteBlocked.value) return
  statusMutation.mutate({ id: link.id, status: link.status === 'active' ? 'disabled' : 'active' })
}

/** Starts an administrative soft-delete for the selected short link. */
function remove(id: string) {
  if (rowWriteBlocked.value) return
  deleteMutation.mutate(id)
}

/** Copies a public short-link URL when the Clipboard API is available. */
function copyUrl(url: string) {
  void navigator.clipboard?.writeText(url)
}

/** Refreshes every cached administrative short-link list after a mutation. */
function invalidateLinks() {
  toast.success(t('feedback.saved'))
  void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
}
</script>

<style scoped>
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
