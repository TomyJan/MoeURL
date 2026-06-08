<template>
  <section class="console-page" data-testid="console-page-links">
    <header class="console-page__header">
      <div>
        <p class="console-page__eyebrow">{{ t('page.links') }}</p>
        <h1>{{ t('page.links') }}</h1>
      </div>
    </header>
    <div class="console-page__tools">
      <div class="console-page__toolbar" data-testid="console-page-toolbar">
        <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" density="compact" variant="outlined" />
      </div>
    </div>
    <div class="console-data-panel" data-testid="console-data-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">加载失败</v-alert>
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <div v-else-if="links.length === 0" class="console-page__empty">
        <span class="console-page__empty-mark">M</span>
        <div>
          <h2>暂无短链</h2>
          <p>从左侧「新建短链」开始，生成后的链接会在这里集中管理。</p>
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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteShortLink, listShortLinks, updateShortLink } from '@/entities/short-link/api'
import type { ShortLink } from '@/entities/short-link/model'
import ConsoleLinkList, { type ConsoleLinkListItem } from './ConsoleLinkList.vue'

const { t } = useI18n()
const queryClient = useQueryClient()
const statusFilter = ref<'' | ShortLink['status']>('')
const statusOptions = computed(() => [
  { title: t('filter.all'), value: '' },
  { title: t('filter.active'), value: 'active' },
  { title: t('filter.disabled'), value: 'disabled' },
])
const query = useQuery({
  queryKey: computed(() => ['short-link', statusFilter.value]),
  queryFn: () => listShortLinks({ status: statusFilter.value }),
})
const links = computed(() => query.data.value?.items ?? [])
const linkItems = computed<ConsoleLinkListItem[]>(() => links.value)

const updateMutation = useMutation({
  mutationFn: updateShortLink,
  onSuccess: invalidateLinks,
})
const deleteMutation = useMutation({
  mutationFn: deleteShortLink,
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
  void queryClient.invalidateQueries({ queryKey: ['short-link'] })
}
</script>
