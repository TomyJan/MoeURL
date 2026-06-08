<template>
  <v-container class="py-10">
    <h1 class="text-h4 mb-4">{{ t('page.links') }}</h1>
    <div class="mb-4 filters">
      <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" />
    </div>
    <v-alert v-if="query.isError.value" type="error" variant="tonal">加载失败</v-alert>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="links.length === 0" type="info" variant="tonal">
      暂无短链
    </v-alert>
    <v-table v-else>
      <thead>
        <tr>
          <th>短链</th>
          <th>目标链接</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="link in links" :key="link.id">
          <td>
            <a :href="link.url" target="_blank" rel="noreferrer">{{ link.url }}</a>
          </td>
          <td>{{ link.targetUrl }}</td>
          <td>{{ link.status }}</td>
          <td>
            <v-btn
              size="small"
              variant="text"
              :loading="updateMutation.isPending.value"
              @click="toggleStatus(link.id, link.status)"
            >
              {{ link.status === 'active' ? '禁用' : '启用' }}
            </v-btn>
            <v-btn size="small" variant="text" @click="copyUrl(link.url)">复制</v-btn>
            <v-btn size="small" variant="text" :href="link.url" target="_blank" rel="noreferrer">打开</v-btn>
            <v-btn size="small" variant="text" color="error" :loading="deleteMutation.isPending.value" @click="remove(link.id)">
              删除
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteShortLink, listShortLinks, updateShortLink } from '@/entities/short-link/api'
import type { ShortLink } from '@/entities/short-link/model'

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

const updateMutation = useMutation({
  mutationFn: updateShortLink,
  onSuccess: invalidateLinks,
})
const deleteMutation = useMutation({
  mutationFn: deleteShortLink,
  onSuccess: invalidateLinks,
})

function toggleStatus(id: string, status: ShortLink['status']) {
  updateMutation.mutate({ id, status: status === 'active' ? 'disabled' : 'active' })
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

<style scoped>
.filters {
  max-width: 220px;
}
</style>
