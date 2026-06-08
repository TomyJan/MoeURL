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

<style scoped>
.console-page {
  display: grid;
  gap: 16px;
}

.console-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.console-page__eyebrow {
  margin: 0 0 6px;
  color: rgb(var(--v-theme-secondary));
  font-size: 0.8rem;
  font-weight: 900;
  text-transform: uppercase;
}

.console-page__header h1 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.35rem);
  line-height: 1.2;
}

.console-page__toolbar {
  display: flex;
  width: 100%;
  max-width: 260px;
  padding: 6px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 52%, transparent);
}

.console-page__panel {
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-glass);
  box-shadow: 0 18px 48px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  backdrop-filter: blur(18px);
}

.console-page__table {
  overflow-x: auto;
}

.console-page__mobile-list {
  display: none;
}

.console-page__mobile-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 72%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 72%, transparent);
}

.console-page__mobile-card + .console-page__mobile-card {
  margin-top: 12px;
}

.console-page__mobile-card-head {
  display: grid;
  gap: 10px;
}

.console-page__mobile-card a,
.console-page__mobile-card p {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.console-page__mobile-card p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__empty {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 168px;
  padding: 26px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: calc(var(--moeurl-radius-panel) - 10px);
  background:
    radial-gradient(circle at 12% 12%, color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent), transparent 18rem),
    color-mix(in srgb, var(--moeurl-surface-elevated) 74%, transparent);
}

.console-page__empty-mark {
  display: grid;
  flex: 0 0 54px;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 20px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 900;
}

.console-page__empty h2 {
  margin: 0 0 6px;
  font-size: 1.1rem;
}

.console-page__empty p {
  max-width: 36rem;
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.console-page__status {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface-variant)) 10%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 800;
}

.console-page__status--active {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent);
  color: rgb(var(--v-theme-primary));
}

.console-page__status--disabled {
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 16%, transparent);
  color: rgb(var(--v-theme-secondary));
}

@media (max-width: 620px) {
  .console-page__toolbar {
    max-width: none;
  }

  .console-page__table {
    display: none;
  }

  .console-page__mobile-list {
    display: block;
  }

  .console-page__empty {
    display: grid;
    justify-items: center;
    text-align: center;
  }
}
</style>
