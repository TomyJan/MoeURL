<template>
  <section class="visit-records" data-testid="visit-records">
    <div class="visit-records__heading">
      <h2>{{ t('visits.title') }}</h2>
      <VisitExportButton :id="id" :context="context" :range="exportRange" :filters="{ deviceType, countryCode }" :blocked="exportBlocked" :context-revision="contextRevision" @unavailable="query.refetch()" />
    </div>
    <p>{{ t('visits.description') }}</p>
    <form v-if="allowed" class="visit-records__filters" novalidate @submit.prevent="applyCountry">
      <v-select v-model="deviceType" :items="deviceOptions" :label="t('visits.device')" variant="outlined" hide-details />
      <v-text-field v-model="countryDraft" :label="t('visits.country')" :placeholder="t('visits.countryHint')" :error-messages="countryError" variant="outlined" />
      <v-btn type="submit" variant="tonal">{{ t('audit.applyFilters') }}</v-btn>
    </form>
    <InsightReadState :denied="denied" :error="query.isError.value" :pending="query.isPending.value" :fetching="query.isFetching.value" @retry="query.refetch()" />
    <template v-if="records">
      <p>{{ t('insights.appliedRange', { startDate: records.range.startDate, endDate: records.range.endDate }) }}</p>
      <v-table v-if="records.items.length" class="insight-table" density="comfortable">
        <thead><tr><th>{{ t('insights.occurredAt') }}</th><th>{{ t('visits.referrer') }}</th><th>{{ t('visits.device') }}</th><th>{{ t('visits.browser') }}</th><th>{{ t('visits.os') }}</th><th>{{ t('visits.country') }}</th></tr></thead>
        <tbody>
          <tr v-for="item in records.items" :key="item.id">
            <td><InstantDetails :instant="item.occurredAt" :label="format(item.occurredAt) ?? item.occurredAt" /></td>
            <td><span class="insight-table__ellipsis" :title="item.referrerHost || t('analytics.unknown')">{{ item.referrerHost || t('analytics.unknown') }}</span></td>
            <td>{{ dimension(item.deviceType) }}</td><td>{{ dimension(item.browserFamily) }}</td><td>{{ dimension(item.osFamily) }}</td><td>{{ item.countryCode || t('analytics.unknown') }}</td>
          </tr>
        </tbody>
      </v-table>
      <p v-else role="status">{{ t('visits.empty') }}</p>
    </template>
    <div v-if="allowed && !denied" class="insight-pagination">
      <v-btn :disabled="!pages.canPrevious.value || query.isFetching.value" variant="text" @click="pages.previous">{{ t('insights.previous') }}</v-btn>
      <v-btn :disabled="!records?.hasMore || query.isFetching.value" variant="tonal" @click="pages.next(records!.nextCursor)">{{ t('insights.next') }}</v-btn>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDateTimeDisplay } from '@/shared/preferences/useDateTimeDisplay'
import { useQuery } from '@tanstack/vue-query'
import { deviceTypes, getVisits } from '@/entities/insights/api'
import type { InsightRangeInput } from '@/entities/insights/model'
import { useInsightAccess, isInsightAccessError } from '@/shared/insights/useInsightAccess'
import { useCursorHistory } from '@/shared/insights/useCursorHistory'
import InsightReadState from '@/features/insights/InsightReadState.vue'
import VisitExportButton from './VisitExportButton.vue'
import InstantDetails from '@/shared/ui/InstantDetails.vue'

const props = defineProps<{ id: string; context: 'own' | 'admin'; range: InsightRangeInput }>()
const { t } = useI18n()
const { format } = useDateTimeDisplay()
const { allowed, scope } = useInsightAccess(() => ['short_link:read_visits', ...(props.context === 'own' ? ['short_link:read_own'] : ['admin:access', 'short_link:read_all'])])
const deviceType = ref('')
const countryDraft = ref('')
const countryCode = ref('')
const countryError = ref('')
const deviceOptions = computed(() => [{ title: t('filter.all'), value: '' }, ...deviceTypes.map((value) => ({ title: dimension(value), value }))])
const contextKey = computed(() => [scope.value, props.id, props.context, props.range, deviceType.value, countryCode.value])
const pages = useCursorHistory(contextKey)
const query = useQuery({
  queryKey: computed(() => ['insights', 'visits', scope.value, { id: props.id, context: props.context, range: props.range, deviceType: deviceType.value, countryCode: countryCode.value, cursor: pages.cursor.value }, pages.revision.value] as const),
  enabled: computed(() => allowed.value && !!props.id), retry: false,
  queryFn: ({ queryKey: [, , , input] }) => getVisits(input.id, input.context, input.range, { deviceType: input.deviceType, countryCode: input.countryCode, cursor: input.cursor }),
})
const denied = computed(() => !allowed.value || isInsightAccessError(query.error.value))
const records = computed(() => !denied.value && !query.isError.value ? query.data.value : undefined)
const exportRange = computed(() => records.value ? { startDate: records.value.range.startDate, endDate: records.value.range.endDate } : undefined)
const exportBlocked = computed(() => !records.value || query.isPending.value || query.isFetching.value || query.isError.value || countryDraft.value !== countryCode.value || !!countryError.value)
const contextRevision = ref(0)
watch([
  contextKey, pages.cursor, pages.revision, query.isPending, query.isFetching, query.isError,
  () => records.value?.range.startDate, () => records.value?.range.endDate, countryDraft, countryError,
], () => { contextRevision.value++ }, { flush: 'sync', deep: true })

/** Applies only canonical country filters, keeping invalid drafts out of query keys. */
function applyCountry() {
  countryError.value = ''
  if (countryDraft.value !== '' && countryDraft.value !== 'unknown' && !/^[A-Z]{2}$/.test(countryDraft.value)) { countryError.value = t('visits.invalidCountry'); return }
  countryCode.value = countryDraft.value
}
/** Localizes the bounded device, browser and system buckets without showing raw UA data. */
function dimension(value: string | null) {
  return !value || value === 'unknown' ? t('analytics.unknown') : value === 'other' ? t('analytics.other') : t(`visits.dimensions.${value}`)
}
</script>
<style scoped>
.visit-records { min-width: 0; margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--moeurl-outline-strong); }
.visit-records__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.visit-records > p { color: rgb(var(--v-theme-on-surface-variant)); }
.visit-records__filters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: start; gap: 12px; margin-top: 16px; }
@media (max-width: 760px) { .visit-records__filters { grid-template-columns: 1fr; } .visit-records__heading { flex-direction: column; } }
</style>
