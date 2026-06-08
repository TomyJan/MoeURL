<template>
  <section class="console-page" data-testid="console-page-admin-links">
    <div class="console-page__header">
      <div>
        <p class="console-page__eyebrow">{{ t('pageMeta.adminEyebrow') }}</p>
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
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <div v-else-if="links.length === 0" class="console-page__empty">
        <span class="console-page__empty-mark">A</span>
        <div>
          <h2>{{ t('links.emptyTitle') }}</h2>
          <p>{{ t('adminLinks.emptyDescription') }}</p>
        </div>
      </div>
      <ConsoleLinkList
        v-else
        :deleting="deleteMutation.isPending.value"
        :links="linkItems"
        :updating="updateMutation.isPending.value"
        @copy="copyUrl"
        @remove="remove"
        @toggle-status="toggleStatus"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteAdminShortLink, listAdminShortLinks, updateAdminShortLink } from '@/entities/short-link/api'
import type { AdminShortLink } from '@/entities/short-link/model'
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

const updateMutation = useMutation({
  mutationFn: updateAdminShortLink,
  onSuccess: invalidateLinks,
})
const deleteMutation = useMutation({
  mutationFn: deleteAdminShortLink,
  onSuccess: invalidateLinks,
})

function toggleStatus(link: ConsoleLinkListItem) {
  updateMutation.mutate({ id: link.id, status: link.status === 'active' ? 'disabled' : 'active' })
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
