<template>
  <section class="console-page analytics-page" data-testid="console-page-analytics">
    <header class="console-page__header">
      <div>
        <h1>{{ t('page.analytics') }}</h1>
        <p v-if="statistics" class="analytics-page__url">{{ statistics.shortLink.url }}</p>
      </div>
      <v-btn :to="backTo" variant="text">{{ t('analytics.backToLinks') }}</v-btn>
    </header>

    <v-alert v-if="!shortLinkId" type="info" variant="tonal">{{ t('analytics.selectLink') }}</v-alert>
    <v-alert v-else-if="query.isError.value" type="error" variant="tonal">{{ t('analytics.loadFailed') }}</v-alert>
    <v-progress-linear v-else-if="query.isPending.value" indeterminate />

    <template v-else-if="statistics">
      <div class="analytics-page__metrics" data-testid="analytics-summary">
        <v-card v-for="metric in metrics" :key="metric.label" variant="tonal">
          <v-card-text>
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </v-card-text>
        </v-card>
      </div>

      <v-card class="analytics-page__trend" variant="outlined">
        <v-card-title>{{ t('analytics.trend') }}</v-card-title>
        <v-card-text><canvas ref="trendCanvas" data-testid="analytics-trend-chart" /></v-card-text>
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, type ChartConfiguration } from 'chart.js'
import { useTheme } from 'vuetify'

import { me } from '@/entities/auth/api'
import { getAdminShortLinkStatistics, getShortLinkStatistics } from '@/entities/short-link/api'
import type { ShortLinkStatisticsResponse } from '@/entities/short-link/model'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

const { t } = useI18n()
const route = useRoute()
const theme = useTheme()
const trendCanvas = ref<globalThis.HTMLCanvasElement>()
const shortLinkId = computed(() => typeof route.query.shortLinkId === 'string' ? route.query.shortLinkId : '')
const query = useQuery({
  queryKey: computed(() => ['short-link-statistics', shortLinkId.value]),
  enabled: computed(() => shortLinkId.value !== ''),
  queryFn: async () => {
    const current = await me()
    return current.user.permissions.includes('admin:access')
      ? getAdminShortLinkStatistics(shortLinkId.value)
      : getShortLinkStatistics(shortLinkId.value)
  },
})
const statistics = computed<ShortLinkStatisticsResponse | undefined>(() => query.data.value)
const backTo = '/link'
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
let chart: Chart | undefined

watch([statistics, () => theme.global.current.value.colors.primary], async ([value, primary]: [ShortLinkStatisticsResponse | undefined, string]) => {
  chart?.destroy()
  chart = undefined
  if (!value) return
  await nextTick()
  const canvas = trendCanvas.value!
  const configuration: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: value.stats.trend.map((point) => point.date),
      datasets: [{ data: value.stats.trend.map((point) => point.visitCount), borderColor: primary, backgroundColor: primary, tension: 0.25 }],
    },
    options: { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false },
  }
  chart = new Chart(canvas, configuration)
}, { immediate: true })

onBeforeUnmount(() => chart?.destroy())

function formatVisitedAt(value: string | null) {
  if (!value) return t('links.stats.neverVisited')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('links.stats.neverVisited') : date.toLocaleDateString()
}

function dimensionLabel(value: string) {
  if (value === 'unknown') return t('analytics.unknown')
  if (value === 'other') return t('analytics.other')
  return value
}

</script>

<style scoped>
.analytics-page__url { margin: 4px 0 0; overflow-wrap: anywhere; }
.analytics-page__metrics, .analytics-page__dimensions { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 20px; }
.analytics-page__metrics strong { display: block; font-size: 24px; margin-top: 8px; }
.analytics-page__trend { margin-top: 20px; }
.analytics-page__trend canvas { min-height: 260px; }
@media (max-width: 760px) { .analytics-page__metrics, .analytics-page__dimensions { grid-template-columns: 1fr; } }
</style>
