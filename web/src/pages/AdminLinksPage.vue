<template>
  <v-container class="py-10">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h4">{{ t('page.adminLinks') }}</h1>
      <span class="text-body-2 text-medium-emphasis">共 {{ query.data.value?.meta.total ?? 0 }} 条</span>
    </div>
    <v-alert v-if="query.isError.value" type="error" variant="tonal">加载失败</v-alert>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="(query.data.value?.items ?? []).length === 0" type="info" variant="tonal">
      暂无短链
    </v-alert>
    <v-table v-else>
      <thead>
        <tr>
          <th>短链</th>
          <th>目标链接</th>
          <th>所有者</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="link in query.data.value?.items ?? []" :key="link.id">
          <td>
            <a :href="link.url" target="_blank" rel="noreferrer">{{ link.url }}</a>
          </td>
          <td>{{ link.targetUrl }}</td>
          <td>
            <div>{{ link.owner.username }}</div>
            <div class="text-caption text-medium-emphasis">{{ link.owner.nickname || link.owner.id }}</div>
          </td>
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
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteAdminShortLink, listAdminShortLinks, updateAdminShortLink } from '@/entities/short-link/api'
import type { AdminShortLink } from '@/entities/short-link/model'

const { t } = useI18n()
const queryClient = useQueryClient()
const query = useQuery({
  queryKey: ['admin-short-links'],
  queryFn: () => listAdminShortLinks(),
})

const updateMutation = useMutation({
  mutationFn: updateAdminShortLink,
  onSuccess: invalidateLinks,
})
const deleteMutation = useMutation({
  mutationFn: deleteAdminShortLink,
  onSuccess: invalidateLinks,
})

function toggleStatus(id: string, status: AdminShortLink['status']) {
  updateMutation.mutate({ id, status: status === 'active' ? 'disabled' : 'active' })
}

function remove(id: string) {
  deleteMutation.mutate(id)
}

function copyUrl(url: string) {
  void navigator.clipboard?.writeText(url)
}

function invalidateLinks() {
  void queryClient.invalidateQueries({ queryKey: ['admin-short-links'] })
}
</script>
