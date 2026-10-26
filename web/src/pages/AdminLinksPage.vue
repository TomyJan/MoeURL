<template>
  <section class="console-page" data-testid="console-page-admin-links">
    <div class="console-page__header">
      <div>
        <h1>{{ t('page.adminLinks') }}</h1>
      </div>
      <span class="console-page__total">{{ t('adminLinks.total', { total }) }}</span>
      <ShortLinkListExportButton context="admin" :filters="exportFilters" :blocked="exportBlocked" @pending="exportPending = $event" />
    </div>
    <div class="console-page__tools">
      <div class="console-page__filters console-page__metadata-filters">
        <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" density="compact" variant="outlined" />
        <v-text-field v-model="searchKeyword" :label="t('filter.keyword')" :error-messages="keywordInvalid ? t('linkMetadata.keywordInvalid') : ''" density="compact" variant="outlined" />
        <v-text-field v-model="tagFilter" :label="t('filter.tag')" :error-messages="tagInvalid ? t('linkMetadata.tagFilterInvalid') : ''" density="compact" variant="outlined" />
      </div>
      <ShortLinkBatchToolbar :state="batch" :access="access" transfer @transfer="beginBatchTransfer" @tags="beginBatchTags" />
    </div>
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
        :can-transfer="canTransfer"
        @select="batch.toggle"
        @select-all="batch.toggleAll"
        @configure="configureLink"
        @transfer="beginTransfer"
        @copy="copyUrl"
        @qr="showQr"
        @remove="remove"
        @toggle-status="toggleStatus"
      />
    </div>
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
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteAdminShortLink, listAdminShortLinks, updateAdminShortLink } from '@/entities/short-link/api'
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

const { t } = useI18n()
const queryClient = useQueryClient()
const access = useShortLinkAccess('admin')
const batchTagTargets = ref<readonly BatchTagTarget[] | null>(null)
const batchTagsRefreshRequired = ref(false)
const transferTarget = ref<AdminShortLink | null>(null)
const batchTransferTargets = ref<readonly AdminShortLink[] | null>(null)
const batchTransferRefreshRequired = ref(false)
const exportPending = ref(false)
const statusFilter = ref<'' | AdminShortLink['status']>('')
const { searchKeyword, tagFilter, debouncedKeyword, debouncedTag, keywordInvalid, tagInvalid, filtersPending } = useShortLinkFilters()
const statusOptions = computed(() => [
  { title: t('filter.all'), value: '' },
  { title: t('filter.active'), value: 'active' },
  { title: t('filter.disabled'), value: 'disabled' },
])

const listQueryKey = computed(() => ['admin-short-link', statusFilter.value, debouncedKeyword.value, debouncedTag.value, access.identity.scope.value.userId, access.identity.scope.value.epoch])
const query = useQuery({
  queryKey: listQueryKey,
  enabled: access.canRead,
  queryFn: () => listAdminShortLinks({ status: statusFilter.value, q: debouncedKeyword.value, tag: debouncedTag.value }),
})
const links = computed(() => access.canRead.value ? query.data.value?.items ?? [] : [])
const linkItems = computed<ConsoleLinkListItem[]>(() => links.value)
const total = computed(() => access.canRead.value ? query.data.value?.meta.total ?? 0 : 0)
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
  filters: computed(() => [statusFilter.value, searchKeyword.value, tagFilter.value]),
  blocked: computed(() => !query.isSuccess.value || query.isFetching.value || batchTagsRefreshRequired.value || batchTagTargets.value !== null || batchTransferRefreshRequired.value || exportPending.value || keywordInvalid.value || tagInvalid.value || filtersPending.value || statusMutation.isPending.value || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null || transferTarget.value !== null || batchTransferTargets.value !== null),
})
const rowWriteBlocked = computed(() => batch.pending.value || batchTagTargets.value !== null || transferTarget.value !== null || batchTransferTargets.value !== null || batch.deleteIds.value !== null)
const canTransfer = computed(() => access.canUpdate.value && query.isSuccess.value && !query.isFetching.value && !filtersPending.value && !keywordInvalid.value && !tagInvalid.value)
watch([access.identity.scope, access.canUpdate], () => { batchTransferTargets.value = null; batch.clear() }, { flush: 'sync' })
watch([query.isFetching, query.isSuccess], ([fetching, success]) => { if (!fetching && success) batchTransferRefreshRequired.value = false })
watch([query.isFetching, query.isSuccess], ([fetching, success]) => { if (!fetching && success) batchTagsRefreshRequired.value = false })
const exportFilters = computed(() => ({ status: statusFilter.value, q: debouncedKeyword.value, tag: debouncedTag.value }))
const exportBlocked = computed(() => !access.canRead.value || !query.isSuccess.value || query.isFetching.value
  || keywordInvalid.value || tagInvalid.value || filtersPending.value || statusMutation.isPending.value
  || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null || rowWriteBlocked.value)

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
.console-page__metadata-filters {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 760px) {
  .console-page__metadata-filters {
    grid-template-columns: 1fr;
  }
}
</style>
