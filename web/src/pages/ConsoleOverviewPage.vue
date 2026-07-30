<template>
  <section class="console-page overview-page" data-testid="console-page-overview">
    <header class="console-page__header overview-page__header">
      <div>
        <h1>{{ t('page.overview') }}</h1>
        <p>{{ t('overview.summary') }}</p>
      </div>
      <div class="overview-page__actions">
        <RouterLink class="overview-page__action" to="/link">{{ t('overview.viewAllLinks') }}</RouterLink>
        <RouterLink class="overview-page__action overview-page__action--secondary" to="/analytics">
          {{ t('overview.viewAnalytics') }}
        </RouterLink>
      </div>
    </header>

    <section
      v-if="overviewQuery.isPending.value"
      class="overview-metrics overview-metrics--loading"
      :aria-label="t('overview.metricsLabel')"
      data-testid="overview-metrics-loading"
    >
      <article v-for="index in 4" :key="index" class="overview-metric" aria-hidden="true">
        <span class="overview-skeleton overview-skeleton--label" />
        <strong class="overview-skeleton overview-skeleton--value" />
      </article>
    </section>
    <section
      v-else-if="overviewQuery.isError.value"
      class="overview-feedback overview-feedback--metrics"
      data-testid="overview-metrics-error"
      role="alert"
    >
      <p>{{ t('overview.metricsLoadFailed') }}</p>
      <button type="button" @click="retryOverview">{{ t('overview.retryMetrics') }}</button>
    </section>
    <section v-else class="overview-metrics" :aria-label="t('overview.metricsLabel')">
      <article v-for="metric in metrics" :key="metric.key" class="overview-metric">
        <span>{{ t(`overview.metrics.${metric.key}`) }}</span>
        <strong>{{ metric.value }}</strong>
      </article>
    </section>

    <section class="overview-recent" aria-labelledby="overview-recent-title">
      <header class="overview-section-header">
        <div>
          <h2 id="overview-recent-title">{{ t('overview.recentTitle') }}</h2>
          <p>{{ t('overview.recentDescription') }}</p>
        </div>
      </header>

      <div class="console-data-panel overview-recent__panel">
        <div v-if="recentLinksQuery.isPending.value" class="overview-recent__loading" data-testid="overview-recent-loading">
          <span v-for="index in 3" :key="index" class="overview-skeleton overview-skeleton--row" aria-hidden="true" />
        </div>
        <div v-else-if="recentLinksQuery.isError.value" class="overview-feedback" data-testid="overview-recent-error" role="alert">
          <p>{{ t('overview.recentLoadFailed') }}</p>
          <button type="button" @click="retryRecentLinks">{{ t('overview.retryRecent') }}</button>
        </div>
        <div v-else-if="recentLinks.length === 0" class="overview-empty" data-testid="overview-empty">
          <div>
            <h3>{{ t('overview.emptyTitle') }}</h3>
            <p>{{ t('overview.emptyDescription') }}</p>
            <RouterLink class="overview-empty__action" to="/">{{ t('overview.createFromHome') }}</RouterLink>
          </div>
        </div>
        <div v-else class="overview-recent__list">
          <article v-for="link in recentLinks" :key="link.id" class="overview-recent-row">
            <div class="overview-recent-row__link">
              <a :href="link.url" target="_blank" rel="noreferrer">{{ link.slug }}</a>
              <span>{{ link.targetUrl }}</span>
            </div>
            <span class="console-link-row__status" :class="`console-link-row__status--${link.status}`">
              {{ t(`links.status.${link.status}`) }}
            </span>
            <dl class="overview-recent-row__stats">
              <div>
                <dt>{{ t('links.stats.visitCount') }}</dt>
                <dd>{{ link.stats?.visitCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t('links.stats.todayVisitCount') }}</dt>
                <dd>{{ link.stats?.todayVisitCount ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t('overview.createdAt') }}</dt>
                <dd>{{ formatDate(link.createdAt) }}</dd>
              </div>
            </dl>
            <RouterLink class="overview-recent-row__analytics" :to="`/analytics?shortLinkId=${encodeURIComponent(link.id)}`">
              {{ t('links.actions.analytics') }}
            </RouterLink>
          </article>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'

import { getShortLinkOverview, listShortLinks } from '@/entities/short-link/api'

const { t } = useI18n()
const overviewQuery = useQuery({
  queryKey: ['short-link', 'overview'],
  queryFn: getShortLinkOverview,
})
const recentLinksQuery = useQuery({
  queryKey: ['short-link', 'recent'],
  queryFn: () => listShortLinks({ page: 1, pageSize: 5 }),
})
const overview = computed(() => overviewQuery.data.value)
const recentLinks = computed(() => recentLinksQuery.data.value?.items ?? [])
const metrics = computed(() => [
  { key: 'totalLinkCount', value: overview.value?.totalLinkCount ?? 0 },
  { key: 'activeLinkCount', value: overview.value?.activeLinkCount ?? 0 },
  { key: 'visitCount', value: overview.value?.visitCount ?? 0 },
  { key: 'todayVisitCount', value: overview.value?.todayVisitCount ?? 0 },
])

function retryOverview() {
  void overviewQuery.refetch()
}

function retryRecentLinks() {
  void recentLinksQuery.refetch()
}

function formatDate(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
</script>

<style scoped>
.overview-page {
  align-content: start;
}

.overview-page__header p,
.overview-section-header p {
  margin: 7px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.6;
}

.overview-page__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.overview-page__action,
.overview-recent-row__analytics {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--moeurl-radius-pill);
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 800;
  text-decoration: none;
}

.overview-page__action--secondary,
.overview-recent-row__analytics {
  border: 1px solid var(--moeurl-outline);
  background: transparent;
  color: rgb(var(--v-theme-primary));
}

.overview-metrics {
  display: grid;
  overflow: hidden;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-elevated);
}

.overview-feedback {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 92px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-error)) 24%, var(--moeurl-outline));
  border-radius: var(--moeurl-radius-panel);
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 7%, var(--moeurl-surface-elevated));
  color: rgb(var(--v-theme-on-surface));
}

.overview-feedback--metrics {
  min-height: 112px;
}

.overview-feedback p {
  margin: 0;
}

.overview-feedback button {
  min-width: 88px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-pill);
  background: transparent;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.overview-metric {
  display: grid;
  gap: 9px;
  min-width: 0;
  padding: 22px;
}

.overview-metric + .overview-metric {
  border-left: 1px solid var(--moeurl-outline);
}

.overview-metric span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8rem;
  font-weight: 800;
}

.overview-metric strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.85rem;
  line-height: 1;
}

.overview-skeleton {
  display: block;
  border-radius: 6px;
  background: var(--moeurl-surface-strong);
  animation: overview-pulse 1.4s ease-in-out infinite alternate;
}

.overview-skeleton--label {
  width: 58%;
  height: 13px;
}

.overview-skeleton--value {
  width: 42%;
  height: 30px;
}

.overview-recent {
  display: grid;
  gap: 12px;
}

.overview-section-header h2 {
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: 1.15rem;
}

.overview-recent__panel {
  padding: 8px 12px;
}

.overview-recent__list {
  display: grid;
}

.overview-recent__loading {
  display: grid;
  gap: 1px;
  padding: 4px 0;
}

.overview-skeleton--row {
  width: 100%;
  height: 66px;
}

.overview-empty {
  display: grid;
  min-height: 150px;
  place-items: center;
  padding: 28px;
  text-align: center;
}

.overview-empty h3,
.overview-empty p {
  margin: 0;
}

.overview-empty__action {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  margin-top: 14px;
  color: rgb(var(--v-theme-primary));
  font-weight: 850;
  text-decoration: none;
}

.overview-empty h3 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
}

.overview-empty p {
  max-width: 520px;
  margin-top: 7px;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.6;
}

.overview-recent-row {
  display: grid;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 16px 10px;
  grid-template-columns: minmax(180px, 1fr) auto minmax(190px, auto) auto;
}

.overview-recent-row + .overview-recent-row {
  border-top: 1px solid var(--moeurl-outline);
}

.overview-recent-row__link {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.overview-recent-row__link a {
  color: rgb(var(--v-theme-primary));
  font-weight: 850;
  text-decoration: none;
}

.overview-recent-row__link span {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-recent-row__stats {
  display: flex;
  gap: 14px;
  margin: 0;
}

.overview-recent-row__stats div {
  display: grid;
  gap: 3px;
}

.overview-recent-row__stats dt {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.72rem;
}

.overview-recent-row__stats dd {
  margin: 0;
  font-weight: 850;
}

.overview-recent-row__analytics {
  min-height: 36px;
  padding: 0 13px;
  font-size: 0.8rem;
}

@keyframes overview-pulse {
  from {
    opacity: 0.55;
  }

  to {
    opacity: 0.95;
  }
}

@media (prefers-reduced-motion: reduce) {
  .overview-skeleton {
    animation: none;
  }
}

@media (max-width: 980px) {
  .overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-metric:nth-child(3) {
    border-left: 0;
  }

  .overview-metric:nth-child(n + 3) {
    border-top: 1px solid var(--moeurl-outline);
  }

  .overview-recent-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .overview-recent-row__analytics {
    justify-self: start;
  }
}

@media (max-width: 620px) {
  .overview-page__header,
  .overview-page__actions,
  .overview-recent-row,
  .overview-feedback {
    display: grid;
    grid-template-columns: 1fr;
  }

  .overview-page__actions,
  .overview-page__action {
    width: 100%;
  }

  .overview-metrics {
    grid-template-columns: 1fr;
  }

  .overview-metric + .overview-metric,
  .overview-metric:nth-child(3) {
    border-top: 1px solid var(--moeurl-outline);
    border-left: 0;
  }

  .overview-recent-row__link span {
    overflow-wrap: anywhere;
    white-space: normal;
  }
}
</style>
