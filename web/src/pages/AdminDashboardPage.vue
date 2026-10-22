<template>
  <section class="console-page dashboard-page" data-testid="admin-dashboard">
    <header class="console-page__header"><div><h1>{{ t('dashboard.title') }}</h1><p>{{ t('dashboard.description') }}</p></div></header>
    <InsightRangePicker v-model="range" />
    <InsightReadState :denied="denied" :error="query.isError.value" :pending="query.isPending.value" :fetching="query.isFetching.value" @retry="query.refetch()" />
    <template v-if="snapshot">
      <p>{{ t('insights.appliedRange', { startDate: snapshot.range.startDate, endDate: snapshot.range.endDate }) }}</p>
      <div class="dashboard-page__metrics" data-testid="dashboard-summary">
        <v-card v-for="metric in metrics" :key="metric.key" variant="flat"><v-card-text><span>{{ t(`dashboard.${metric.key}`) }}</span><strong>{{ metric.value }}</strong></v-card-text></v-card>
      </div>
      <p class="dashboard-page__note">{{ t('dashboard.activeMeaning') }}</p>
      <v-card variant="outlined" class="dashboard-page__trend"><v-card-title>{{ t('analytics.trend') }}</v-card-title><v-card-text><InsightTrend :points="snapshot.trend" :label="t('analytics.trend')" /></v-card-text></v-card>
      <v-card variant="outlined">
        <v-card-title>{{ t('dashboard.topLinks') }}</v-card-title>
        <v-table v-if="snapshot.topLinks.length" class="insight-table" density="comfortable">
          <thead><tr><th>{{ t('links.shortUrl') }}</th><th>{{ t('linkMetadata.title') }}</th><th>{{ t('dashboard.rangeVisitCount') }}</th></tr></thead>
          <tbody>
            <tr v-for="link in snapshot.topLinks" :key="link.id">
              <td><span v-if="link.deleted" class="insight-table__ellipsis" :title="link.url">{{ link.url }}</span><RouterLink v-else class="insight-table__ellipsis" :to="`/admin/link/${link.id}/analytics`" :title="link.url">{{ link.url }}</RouterLink><v-chip v-if="link.deleted" size="small" variant="tonal">{{ t('dashboard.deleted') }}</v-chip></td>
              <td><span class="insight-table__ellipsis" :title="link.title">{{ link.title || '—' }}</span></td><td>{{ link.visitCount }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text v-else>{{ t('dashboard.empty') }}</v-card-text>
      </v-card>
      <p class="dashboard-page__note">{{ t('dashboard.generatedAt') }} <time :datetime="snapshot.generatedAt">{{ snapshot.generatedAt }}</time></p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { getDashboard } from '@/entities/insights/api'
import type { InsightRangeInput } from '@/entities/insights/model'
import { useInsightAccess, isInsightAccessError } from '@/shared/insights/useInsightAccess'
import InsightRangePicker from '@/features/insights/InsightRangePicker.vue'
import InsightTrend from '@/features/insights/InsightTrend.vue'
import InsightReadState from '@/features/insights/InsightReadState.vue'

const { t } = useI18n()
const range = ref<InsightRangeInput>({ days: 7 })
const { allowed, scope } = useInsightAccess(['admin:access', 'statistics:read_all'])
const query = useQuery({ queryKey: computed(() => ['insights', 'dashboard', scope.value, range.value] as const), enabled: allowed, retry: false, queryFn: ({ queryKey: [, , , applied] }) => getDashboard(applied) })
const denied = computed(() => !allowed.value || isInsightAccessError(query.error.value))
const snapshot = computed(() => !denied.value && !query.isError.value ? query.data.value : undefined)
const metrics = computed(() => Object.entries(snapshot.value!.summary).map(([key, value]) => ({ key, value })))
</script>
<style scoped>
.dashboard-page { min-width: 0; }
.dashboard-page__metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
.dashboard-page__metrics :deep(.v-card) { min-width: 0; border: 1px solid var(--moeurl-outline-strong); background: var(--moeurl-surface-elevated); }
.dashboard-page__metrics span { color: rgb(var(--v-theme-on-surface-variant)); }
.dashboard-page__metrics strong { display: block; margin-top: 8px; color: rgb(var(--v-theme-primary)); font-size: 1.5rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dashboard-page__note { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.dashboard-page__trend { margin: 20px 0; }
@media (max-width: 900px) { .dashboard-page__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .dashboard-page__metrics { grid-template-columns: 1fr; } }
</style>
