<template>
  <section class="console-page" data-testid="console-page-links">
    <header class="console-page__header">
      <div>
        <p class="console-page__eyebrow">Links</p>
        <h1>{{ t('page.links') }}</h1>
      </div>
    </header>
    <div class="console-page__toolbar" data-testid="console-page-toolbar">
      <v-select v-model="statusFilter" :items="statusOptions" :label="t('filter.status')" />
    </div>
    <div class="console-page__panel" data-testid="console-page-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">加载失败</v-alert>
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <div v-else-if="links.length === 0" class="console-page__empty">
        <span class="console-page__empty-mark">M</span>
        <div>
          <h2>暂无短链</h2>
          <p>从左侧「新建短链」开始，生成后的链接会在这里集中管理。</p>
        </div>
      </div>
      <div v-else class="console-page__table">
        <v-table>
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
              <td>
                <span class="console-page__status" :class="`console-page__status--${link.status}`">{{ link.status }}</span>
              </td>
              <td>
                <div class="console-page__actions">
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
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <div v-if="links.length > 0" class="console-page__mobile-list" data-testid="console-page-mobile-list">
        <article v-for="link in links" :key="`mobile-${link.id}`" class="console-page__mobile-card">
          <div class="console-page__mobile-card-head">
            <a :href="link.url" target="_blank" rel="noreferrer">{{ link.url }}</a>
            <span class="console-page__status" :class="`console-page__status--${link.status}`">{{ link.status }}</span>
          </div>
          <p>{{ link.targetUrl }}</p>
          <div class="console-page__actions">
            <v-btn size="small" variant="text" :loading="updateMutation.isPending.value" @click="toggleStatus(link.id, link.status)">
              {{ link.status === 'active' ? '禁用' : '启用' }}
            </v-btn>
            <v-btn size="small" variant="text" @click="copyUrl(link.url)">复制</v-btn>
            <v-btn size="small" variant="text" :href="link.url" target="_blank" rel="noreferrer">打开</v-btn>
            <v-btn size="small" variant="text" color="error" :loading="deleteMutation.isPending.value" @click="remove(link.id)">
              删除
            </v-btn>
          </div>
        </article>
      </div>
    </div>
  </section>
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
