<template>
  <section class="console-page analytics-page" data-testid="console-page-analytics">
    <header class="console-page__header analytics-page__header">
      <div>
        <h1>{{ t(isAdminAnalytics ? 'analytics.adminTitle' : 'analytics.ownTitle') }}</h1>
        <p v-if="statistics" class="analytics-page__url" :title="statistics.shortLink.url">{{ statistics.shortLink.url }}</p>
      </div>
      <v-btn :to="backTo" variant="tonal">{{ t(isAdminAnalytics ? 'analytics.backToAdminLinks' : 'analytics.backToLinks') }}</v-btn>
    </header>

    <v-alert v-if="query.isError.value" type="error" variant="tonal">
      <div class="analytics-page__error">
        <span>{{ t('analytics.loadFailed') }}</span>
        <v-btn color="error" size="small" variant="tonal" :loading="query.isFetching.value" @click="retry">{{ t('analytics.retry') }}</v-btn>
      </div>
    </v-alert>
    <section v-else-if="query.isPending.value" class="console-data-panel" :aria-label="t('analytics.title')">
      <v-progress-linear indeterminate />
    </section>

    <template v-else-if="statistics">
      <p class="analytics-page__description">{{ t('analytics.description') }}</p>
      <div class="analytics-page__metrics" data-testid="analytics-summary">
        <v-card v-for="metric in metrics" :key="metric.label" variant="flat">
          <v-card-text>
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </v-card-text>
        </v-card>
      </div>

      <v-card class="analytics-page__trend" variant="outlined">
        <v-card-title>{{ t('analytics.trend') }}</v-card-title>
        <v-card-text><div class="analytics-page__chart"><canvas ref="trendCanvas" data-testid="analytics-trend-chart" /></div></v-card-text>
      </v-card>

      <div class="analytics-page__dimensions">
        <v-card v-for="dimension in dimensions" :key="dimension.title" variant="outlined">
          <v-card-title>{{ dimension.title }}</v-card-title>
          <v-list v-if="dimension.items.length" density="compact">
            <v-list-item v-for="item in dimension.items" :key="item.value">
              <v-list-item-title>{{ dimensionLabel(item.value) }}</v-list-item-title>
              <template #append><strong>{{ item.visitCount }}</strong></template>
            </v-list-item>
          </v-list>
          <v-card-text v-else>{{ t('analytics.emptyDimension') }}</v-card-text>
        </v-card>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, type ChartConfiguration } from 'chart.js'
import { useTheme } from 'vuetify'

import { getAdminShortLinkStatistics, getShortLinkStatistics } from '@/entities/short-link/api'
import type { ShortLinkStatisticsResponse } from '@/entities/short-link/model'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

const { t } = useI18n()
const route = useRoute()
const theme = useTheme()
const trendCanvas = ref<globalThis.HTMLCanvasElement>()
const shortLinkId = computed(() => typeof route.params.shortLinkId === 'string' ? route.params.shortLinkId : '')
const isAdminAnalytics = computed(() => route.path.startsWith('/admin/link/'))
const backTo = computed(() => isAdminAnalytics.value ? '/admin/link' : '/link')
const query = useQuery({
  queryKey: computed(() => ['short-link-statistics', isAdminAnalytics.value ? 'admin' : 'own', shortLinkId.value]),
  enabled: computed(() => shortLinkId.value !== ''),
  queryFn: () => isAdminAnalytics.value
    ? getAdminShortLinkStatistics(shortLinkId.value)
    : getShortLinkStatistics(shortLinkId.value),
})
const statistics = computed<ShortLinkStatisticsResponse | undefined>(() => query.data.value)
const chartColors = computed(() => ({
  primary: theme.global.current.value.colors.primary,
  text: theme.global.current.value.colors['on-surface-variant'],
  outline: theme.global.current.value.colors.outline,
}))
const metrics = computed(() => {
  const stats = statistics.value!.stats
  return [
    { label: t('links.stats.visitCount'), value: stats.visitCount },
    { label: t('links.stats.todayVisitCount'), value: stats.todayVisitCount },
    { label: t('links.stats.lastVisitedAt'), value: formatVisitedAt(stats.lastVisitedAt) },
  ]
})
const dimensions = computed(() => {
  const stats = statistics.value!.stats
  return [
    { title: t('analytics.referrers'), items: stats.referrers },
    { title: t('analytics.devices'), items: stats.devices },
    { title: t('analytics.countries'), items: stats.countries },
  ]
})
watch([statistics, trendCanvas, chartColors], ([value, canvas, colors]: [ShortLinkStatisticsResponse | undefined, globalThis.HTMLCanvasElement | undefined, { primary: string; text: string; outline: string }], _previous, onCleanup) => {
  if (!value || !canvas) return
  const configuration: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: value.stats.trend.map((point) => point.date),
      datasets: [{ data: value.stats.trend.map((point) => point.visitCount), borderColor: colors.primary, backgroundColor: colors.primary, tension: 0.25 }],
    },
    options: {
      animation: false,
      plugins: { legend: { display: false } },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: colors.text }, grid: { color: colors.outline }, border: { color: colors.outline } },
        y: { min: 0, suggestedMax: 1, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.outline }, border: { color: colors.outline } },
      },
    },
  }
  const chart = new Chart(canvas, configuration)
  onCleanup(() => chart.destroy())
}, { flush: 'post' })

/** Retries the active link's statistics request. */
function retry() {
  void query.refetch()
}

/** Formats the last-visit date while handling absent or invalid timestamps. */
function formatVisitedAt(value: string | null) {
  if (!value) return t('links.stats.neverVisited')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('links.stats.neverVisited') : date.toLocaleDateString()
}

/** Localizes reserved analytics buckets while preserving concrete values. */
function dimensionLabel(value: string) {
  if (value === 'unknown') return t('analytics.unknown')
  if (value === 'other') return t('analytics.other')
  return value
}

</script>

<style scoped>
.analytics-page__url { max-width: min(70vw, 900px); margin: 5px 0 0; overflow: hidden; color: rgb(var(--v-theme-on-surface-variant)); text-overflow: ellipsis; white-space: nowrap; }
.analytics-page__description { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface-variant)); }
.analytics-page__metrics, .analytics-page__dimensions { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 20px; }
.analytics-page__metrics > :deep(.v-card) { min-width: 0; border: 1px solid var(--moeurl-outline-strong); background: var(--moeurl-surface-elevated); }
.analytics-page__metrics span { color: rgb(var(--v-theme-on-surface-variant)); }
.analytics-page__metrics strong { display: block; margin-top: 8px; color: rgb(var(--v-theme-primary)); font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.analytics-page__trend { margin-top: 20px; }
.analytics-page__chart { position: relative; height: 280px; }
.analytics-page__chart canvas { max-width: 100%; }
.analytics-page__error { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
@media (max-width: 760px) {
  .analytics-page__header { display: flex; align-items: flex-start; flex-direction: column; }
  .analytics-page__url { max-width: calc(100vw - 48px); }
  .analytics-page__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analytics-page__dimensions { grid-template-columns: 1fr; }
  .analytics-page__chart { height: 220px; }
}
@media (max-width: 420px) { .analytics-page__metrics { grid-template-columns: 1fr; } }
</style>
