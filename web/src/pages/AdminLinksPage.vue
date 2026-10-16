<template>
  <section class="console-page" data-testid="console-page-admin-links">
    <div class="console-page__header">
      <div>
        <h1>{{ t('page.adminLinks') }}</h1>
      </div>
      <span class="console-page__total">{{ t('adminLinks.total', { total }) }}</span>
    </div>
    <div class="console-page__tools">
      <div class="console-page__filters console-page__metadata-filters">
        <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" density="compact" variant="outlined" />
        <v-text-field v-model="searchKeyword" :label="t('filter.keyword')" :error-messages="keywordInvalid ? t('linkMetadata.keywordInvalid') : ''" density="compact" variant="outlined" />
        <v-text-field v-model="tagFilter" :label="t('filter.tag')" :error-messages="tagInvalid ? t('linkMetadata.tagFilterInvalid') : ''" density="compact" variant="outlined" />
      </div>
      <ShortLinkBatchToolbar :state="batch" :access="access" />
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
        :write-disabled="batch.pending.value"
        @select="batch.toggle"
        @select-all="batch.toggleAll"
        @configure="configureLink"
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
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { computed, ref } from 'vue'
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

const { t } = useI18n()
const queryClient = useQueryClient()
const access = useShortLinkAccess('admin')
const statusFilter = ref<'' | AdminShortLink['status']>('')
const { searchKeyword, tagFilter, debouncedKeyword, debouncedTag, keywordInvalid, tagInvalid } = useShortLinkFilters()
const statusOptions = computed(() => [
  { title: t('filter.all'), value: '' },
  { title: t('filter.active'), value: 'active' },
  { title: t('filter.disabled'), value: 'disabled' },
])

const query = useQuery({
  queryKey: computed(() => ['admin-short-link', statusFilter.value, debouncedKeyword.value, debouncedTag.value, access.identity.scope.value.userId, access.identity.scope.value.epoch]),
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
  blocked: computed(() => query.isFetching.value || query.isPending.value || query.isError.value || keywordInvalid.value || tagInvalid.value || statusMutation.isPending.value || deleteMutation.isPending.value || settingsMutation.isPending.value || settingsLink.value !== null),
})

/** Prevents opening row settings while a batch is outstanding. */
function configureLink(link: ConsoleLinkListItem) { if (!batch.pending.value) configure(link) }

/** Toggles a short link through the administrative update mutation. */
function toggleStatus(link: ConsoleLinkListItem) {
  if (batch.pending.value) return
  statusMutation.mutate({ id: link.id, status: link.status === 'active' ? 'disabled' : 'active' })
}

/** Starts an administrative soft-delete for the selected short link. */
function remove(id: string) {
  if (batch.pending.value) return
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
