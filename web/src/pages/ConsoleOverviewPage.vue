<template>
  <section class="console-page overview-page" data-testid="console-page-overview">
    <header class="console-page__header overview-page__header">
      <div>
        <h1>{{ t('page.overview') }}</h1>
        <p>{{ t('overview.summary') }}</p>
      </div>
      <div class="console-page__actions-bar overview-page__actions">
        <v-btn color="primary" variant="flat" to="/link">{{ t('overview.viewAllLinks') }}</v-btn>
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
        <v-table v-else class="moe-data-table overview-recent__table" hover :aria-label="t('overview.recentTitle')">
          <thead>
            <tr>
              <th scope="col" class="overview-recent__link-column">{{ t('links.shortUrl') }}</th>
              <th scope="col">{{ t('adminUsers.headers.status') }}</th>
              <th scope="col" class="text-end">{{ t('links.stats.visitCount') }}</th>
              <th scope="col" class="text-end">{{ t('links.stats.todayVisitCount') }}</th>
              <th scope="col">{{ t('overview.createdAt') }}</th>
              <th scope="col" class="text-end">{{ t('links.headers.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="link in recentLinks" :key="link.id">
              <td>
                <div class="moe-table-stack">
                  <a class="moe-table-ellipsis" :href="link.url" :title="link.url" target="_blank" rel="noreferrer">{{ link.slug }}</a>
                  <span class="moe-table-ellipsis moe-table-muted" :title="link.targetUrl">{{ link.targetUrl }}</span>
                </div>
              </td>
              <td><v-chip :color="link.status === 'active' ? 'success' : undefined" size="small" variant="tonal">{{ t(`links.status.${link.status}`) }}</v-chip></td>
              <td class="text-end">{{ link.stats?.visitCount ?? 0 }}</td>
              <td class="text-end">{{ link.stats?.todayVisitCount ?? 0 }}</td>
              <td>{{ formatDate(link.createdAt) }}</td>
              <td class="text-end"><v-btn color="primary" size="small" variant="text" :to="`/link/${encodeURIComponent(link.id)}/analytics`">{{ t('links.actions.analytics') }}</v-btn></td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDateTimeDisplay } from '@/shared/preferences/useDateTimeDisplay'
import { useQuery } from '@tanstack/vue-query'

import { getShortLinkOverview, listShortLinks } from '@/entities/short-link/api'

const { t } = useI18n()
const { format } = useDateTimeDisplay()
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

/** Formats a recent-link instant as the selected zone's calendar date. */
function formatDate(value: string) {
  return format(value, 'date') ?? value
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
  gap: 16px;
}

.overview-metric {
  display: grid;
  gap: 18px;
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-card);
  background: var(--moeurl-surface-elevated);
  border-top: 3px solid rgb(var(--v-theme-primary));
}

.overview-metric:nth-child(2) { border-top-color: rgb(var(--v-theme-secondary)); }
.overview-metric:nth-child(3) { border-top-color: rgb(var(--v-theme-tertiary)); }

.overview-metric span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8rem;
  font-weight: 600;
}

.overview-metric strong {
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-primary));
  font-size: 2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.overview-metric:nth-child(2) strong { color: rgb(var(--v-theme-secondary)); }
.overview-metric:nth-child(3) strong { color: rgb(var(--v-theme-tertiary)); }

.overview-recent {
  display: grid;
  gap: 12px;
}

.overview-section-header h2 {
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: 1.15rem;
}

.overview-recent__panel { padding: 0; }
.overview-recent__table :deep(table) { min-width: 760px; }
.overview-recent__link-column { width: 32%; }

@media (max-width: 980px) {
  .overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@media (max-width: 620px) {
  .overview-page__header {
    display: grid;
    grid-template-columns: 1fr;
  }

  .overview-page__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .overview-page__actions .v-btn {
    flex: 0 1 auto;
  }

  .overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .overview-metric {
    padding: 18px;
  }

  .overview-metric strong {
    font-size: 1.75rem;
  }

}
</style>
