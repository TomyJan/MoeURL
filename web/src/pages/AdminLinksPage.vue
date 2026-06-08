<template>
  <section class="console-page" data-testid="console-page-admin-links">
    <div class="console-page__header">
      <div>
        <p class="console-page__eyebrow">Admin links</p>
        <h1>{{ t('page.adminLinks') }}</h1>
      </div>
      <span class="console-page__total">共 {{ total }} 条</span>
    </div>
    <div class="console-page__filters">
      <v-select v-model="statusFilter" :items="statusOptions" label="状态筛选" />
      <v-text-field v-model="searchKeyword" label="关键词搜索" />
    </div>
    <div class="console-page__panel" data-testid="console-page-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">加载失败</v-alert>
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <div v-else-if="links.length === 0" class="console-page__empty">
        <span class="console-page__empty-mark">A</span>
        <div>
          <h2>暂无短链</h2>
          <p>当前筛选条件下没有全站短链，调整状态或关键词后再查看。</p>
        </div>
      </div>
      <div v-else class="console-page__table">
        <v-table>
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
            <tr v-for="link in links" :key="link.id">
              <td>
                <a :href="link.url" target="_blank" rel="noreferrer">{{ link.url }}</a>
              </td>
              <td>{{ link.targetUrl }}</td>
              <td>
                <div>{{ link.owner.username }}</div>
                <div class="console-page__muted">{{ link.owner.nickname || link.owner.id }}</div>
              </td>
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
          <div class="console-page__owner">
            <span>{{ link.owner.username }}</span>
            <span class="console-page__muted">{{ link.owner.nickname || link.owner.id }}</span>
          </div>
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { deleteAdminShortLink, listAdminShortLinks, updateAdminShortLink } from '@/entities/short-link/api'
import type { AdminShortLink } from '@/entities/short-link/model'

const { t } = useI18n()
const queryClient = useQueryClient()
const statusFilter = ref<'' | AdminShortLink['status']>('')
const searchKeyword = ref('')
const debouncedKeyword = ref('')
const statusOptions = [
  { title: '全部', value: '' },
  { title: '启用', value: 'active' },
  { title: '禁用', value: 'disabled' },
]

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
const total = computed(() => query.data.value?.meta.total ?? 0)

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
  void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
}
</script>
