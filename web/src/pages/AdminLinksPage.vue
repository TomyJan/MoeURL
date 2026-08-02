<template>
  <section class="console-page" data-testid="console-page-admin-links">
    <div class="console-page__header">
      <div>
        <h1>{{ t('page.adminLinks') }}</h1>
      </div>
      <span class="console-page__total">{{ t('adminLinks.total', { total }) }}</span>
    </div>
    <div class="console-page__tools">
      <div class="console-page__filters">
        <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" density="compact" variant="outlined" />
        <v-text-field v-model="searchKeyword" :label="t('filter.keyword')" density="compact" variant="outlined" />
      </div>
    </div>
    <div class="console-data-panel" data-testid="console-data-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">{{ t('adminLinks.loadFailed') }}</v-alert>
      <v-progress-linear v-else-if="query.isPending.value" indeterminate />
      <div v-else-if="links.length === 0" class="console-page__empty">
        <div>
          <h2>{{ t('links.emptyTitle') }}</h2>
          <p>{{ t('adminLinks.emptyDescription') }}</p>
        </div>
      </div>
      <ConsoleLinkList
        v-else
        :deleting-id="deletingId"
        :links="linkItems"
        :updating-id="updatingId"
        @configure="configure"
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteAdminShortLink, listAdminShortLinks, updateAdminShortLink } from '@/entities/short-link/api'
import type { AdminShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'
import ShortLinkSettingsDialog from '@/features/short-link-settings/ShortLinkSettingsDialog.vue'
import ShortLinkQrDialog from '@/features/short-link-qr/ShortLinkQrDialog.vue'
import { useMutationTargetId } from '@/shared/mutations/useMutationTargetId'
import ConsoleLinkList, { type ConsoleLinkListItem } from './ConsoleLinkList.vue'

const { t } = useI18n()
const queryClient = useQueryClient()
const statusFilter = ref<'' | AdminShortLink['status']>('')
const searchKeyword = ref('')
const debouncedKeyword = ref('')
const statusOptions = computed(() => [
  { title: t('filter.all'), value: '' },
  { title: t('filter.active'), value: 'active' },
  { title: t('filter.disabled'), value: 'disabled' },
])

watch(searchKeyword, (value, _oldValue, onCleanup) => {
  const timer = globalThis.setTimeout(() => {
    debouncedKeyword.value = value
  }, 500)
  onCleanup(() => globalThis.clearTimeout(timer))
})

const query = useQuery({
  queryKey: computed(() => ['admin-short-link', statusFilter.value, debouncedKeyword.value]),
  queryFn: () => listAdminShortLinks({ status: statusFilter.value, q: debouncedKeyword.value }),
})
const links = computed(() => query.data.value?.items ?? [])
const linkItems = computed<ConsoleLinkListItem[]>(() => links.value)
const total = computed(() => query.data.value?.meta.total ?? 0)
const settingsLink = ref<ConsoleLinkListItem | null>(null)
const qrLink = ref<ConsoleLinkListItem | null>(null)

const statusMutation = useMutation({
  mutationFn: updateAdminShortLink,
  onSuccess: invalidateLinks,
})
const deleteMutation = useMutation({
  mutationFn: deleteAdminShortLink,
  onSuccess: invalidateLinks,
})
const settingsMutation = useMutation({
  mutationFn: updateAdminShortLink,
  onSuccess() {
    settingsLink.value = null
    invalidateLinks()
  },
})
const settingsErrorMessage = computed(() => {
  if (!settingsMutation.isError.value) {
    return ''
  }
  return settingsMutation.error.value instanceof Error
    ? settingsMutation.error.value.message
    : t('links.settingsSaveFailed')
})
const updatingId = useMutationTargetId(statusMutation, (variables) => variables?.id)
const deletingId = useMutationTargetId(deleteMutation, (variables) => (typeof variables === 'string' ? variables : undefined))

function toggleStatus(link: ConsoleLinkListItem) {
  statusMutation.mutate({ id: link.id, status: link.status === 'active' ? 'disabled' : 'active' })
}

function configure(link: ConsoleLinkListItem) {
  settingsMutation.reset()
  settingsLink.value = link
}

function saveSettings(input: UpdateShortLinkInput) {
  settingsMutation.mutate(input)
}

function closeSettings() {
  settingsLink.value = null
}

function showQr(link: ConsoleLinkListItem) {
  qrLink.value = link
}

function closeQr() {
  qrLink.value = null
}

function remove(id: string) {
  deleteMutation.mutate(id)
}

function copyUrl(url: string) {
  void navigator.clipboard?.writeText(url)
}

function invalidateLinks() {
  void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
}
</script>
