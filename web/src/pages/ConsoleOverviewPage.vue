<template>
  <section class="console-page overview-page" data-testid="console-page-overview">
    <header class="console-page__header overview-page__header">
      <div>
        <h1>{{ t('page.overview') }}</h1>
        <p>{{ t('overview.summary') }}</p>
      </div>
      <div class="console-page__actions-bar overview-page__actions">
        <v-btn color="primary" variant="flat" to="/link">{{ t('overview.viewAllLinks') }}</v-btn>
        <v-btn color="primary" variant="tonal" to="/analytics">{{ t('overview.viewAnalytics') }}</v-btn>
      </div>
    </header>

    <section
      v-if="overviewQuery.isPending.value"
      class="console-data-panel"
      :aria-label="t('overview.metricsLabel')"
      data-testid="overview-metrics-loading"
    >
      <v-progress-linear indeterminate />
    </section>
    <section
      v-else-if="overviewQuery.isError.value"
      class="console-data-panel"
      :aria-label="t('overview.metricsLabel')"
      data-testid="overview-metrics-error"
    >
      <v-alert type="error" variant="tonal">
        <span>{{ t('overview.metricsLoadFailed') }}</span>
        <v-btn color="error" size="small" variant="tonal" @click="retryOverview">{{ t('overview.retryMetrics') }}</v-btn>
      </v-alert>
    </section>
    <section v-else class="console-data-panel overview-metrics" :aria-label="t('overview.metricsLabel')">
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
        <div v-if="recentLinksQuery.isPending.value" data-testid="overview-recent-loading">
          <v-progress-linear indeterminate />
        </div>
        <div v-else-if="recentLinksQuery.isError.value" data-testid="overview-recent-error">
          <v-alert type="error" variant="tonal">
            <span>{{ t('overview.recentLoadFailed') }}</span>
            <v-btn color="error" size="small" variant="tonal" @click="retryRecentLinks">{{ t('overview.retryRecent') }}</v-btn>
          </v-alert>
        </div>
        <div v-else-if="recentLinks.length === 0" class="console-page__empty" data-testid="overview-empty">
          <div>
            <h2>{{ t('overview.emptyTitle') }}</h2>
            <p>{{ t('overview.emptyDescription') }}</p>
            <v-btn class="mt-4" color="primary" variant="tonal" to="/">{{ t('overview.createFromHome') }}</v-btn>
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
            <v-btn color="primary" size="small" variant="tonal" :to="`/analytics?shortLinkId=${encodeURIComponent(link.id)}`">
              {{ t('links.actions.analytics') }}
            </v-btn>
          </article>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
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

/** Refetches the overview metrics after a recoverable loading failure. */
function retryOverview() {
  void overviewQuery.refetch()
}

/** Refetches the recent-link list after a recoverable loading failure. */
function retryRecentLinks() {
  void recentLinksQuery.refetch()
}

/** Formats a parsed recent-link timestamp as YYYY-MM-DD. */
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

.overview-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
}

@media (max-width: 620px) {
  .overview-page__header,
  .overview-page__actions,
  .overview-recent-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .overview-page__actions {
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
