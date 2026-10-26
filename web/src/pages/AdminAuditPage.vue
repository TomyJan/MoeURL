<template>
  <section class="console-page audit-page" data-testid="admin-audit">
    <header class="console-page__header"><div><h1>{{ t('audit.title') }}</h1><p>{{ t('audit.description') }}</p></div><AuditExportButton :range="exportRange" :filters="filters" :blocked="exportBlocked" :context-revision="contextRevision" /></header>
    <InsightRangePicker v-model="range" />
    <form v-if="allowed" class="audit-page__filters" novalidate @submit.prevent="applyFilters">
      <v-text-field v-model="actorDraft" :label="t('audit.actorId')" :error-messages="actorError" variant="outlined" />
      <v-select v-model="resourceDraft" :items="resourceOptions" :label="t('audit.resourceType')" variant="outlined" hide-details />
      <v-select v-model="actionDraft" :items="actionOptions" :label="t('audit.action')" variant="outlined" hide-details />
      <v-btn type="submit" variant="tonal">{{ t('audit.applyFilters') }}</v-btn>
    </form>
    <InsightReadState :denied="denied" :error="query.isError.value" :pending="query.isPending.value" :fetching="query.isFetching.value" @retry="query.refetch()" />
    <template v-if="logs">
      <p>{{ t('insights.appliedRange', { startDate: logs.range.startDate, endDate: logs.range.endDate }) }}</p><p>{{ t('audit.retention', { days: logs.retentionDays }) }}</p>
      <v-table v-if="logs.items.length" class="insight-table" density="comfortable">
        <thead><tr><th>{{ t('audit.id') }}</th><th>{{ t('insights.occurredAt') }}</th><th>{{ t('audit.actor') }}</th><th>{{ t('audit.resourceType') }}</th><th>{{ t('audit.resourceId') }}</th><th>{{ t('audit.action') }}</th><th>{{ t('audit.changedFields') }}</th></tr></thead>
        <tbody>
          <tr v-for="item in logs.items" :key="item.id">
            <td>{{ item.id }}</td><td><time :datetime="item.occurredAt">{{ item.occurredAt }}</time></td>
            <td><span class="insight-table__ellipsis" :title="item.actorId || t('audit.systemActor')">{{ item.actorId ? item.actorUsername || t('analytics.unknown') : t('audit.systemActor') }}</span><span v-if="item.actorId" class="insight-table__ellipsis" :title="item.actorId">{{ item.actorId }}</span></td>
            <td>{{ t(`audit.resources.${item.resourceType}`) }}</td><td><span class="insight-table__ellipsis" :title="item.resourceId">{{ item.resourceId }}</span></td><td>{{ t(`audit.actions.${item.action}`) }}</td><td><span class="insight-table__ellipsis" :title="item.changedFields.join(', ')">{{ item.changedFields.join(', ') || '—' }}</span></td>
          </tr>
        </tbody>
      </v-table>
      <p v-else role="status">{{ t('audit.empty') }}</p>
    </template>
    <div v-if="allowed && !denied" class="insight-pagination">
      <v-btn :disabled="!pages.canPrevious.value || query.isFetching.value" variant="text" @click="pages.previous">{{ t('insights.previous') }}</v-btn>
      <v-btn :disabled="!logs?.hasMore || query.isFetching.value" variant="tonal" @click="pages.next(logs!.nextCursor)">{{ t('insights.next') }}</v-btn>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { z } from 'zod'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { auditActions, auditResourceTypes, getAudit } from '@/entities/insights/api'
import type { AuditFilters, InsightRangeInput } from '@/entities/insights/model'
import { useInsightAccess, isInsightAccessError } from '@/shared/insights/useInsightAccess'
import { useCursorHistory } from '@/shared/insights/useCursorHistory'
import InsightRangePicker from '@/features/insights/InsightRangePicker.vue'
import InsightReadState from '@/features/insights/InsightReadState.vue'
import AuditExportButton from '@/features/audit-export/AuditExportButton.vue'

const { t } = useI18n()
const range = ref<InsightRangeInput>({ days: 7 })
const actorDraft = ref('')
const resourceDraft = ref('')
const actionDraft = ref('')
const actorError = ref('')
const filters = ref<AuditFilters>({})
const resourceOptions = computed(() => [{ title: t('filter.all'), value: '' }, ...auditResourceTypes.map((value) => ({ title: t(`audit.resources.${value}`), value }))])
const actionOptions = computed(() => [{ title: t('filter.all'), value: '' }, ...auditActions.map((value) => ({ title: t(`audit.actions.${value}`), value }))])
const { allowed, scope } = useInsightAccess(['admin:access', 'audit:read'])
const pages = useCursorHistory(() => [scope.value, range.value, filters.value])
const query = useQuery({
  queryKey: computed(() => ['insights', 'audit', scope.value, range.value, { ...filters.value, cursor: pages.cursor.value }, pages.revision.value] as const), enabled: allowed, retry: false,
  queryFn: ({ queryKey: [, , , applied, selected] }) => getAudit(applied, selected),
})
const denied = computed(() => !allowed.value || isInsightAccessError(query.error.value))
const logs = computed(() => !denied.value && !query.isError.value ? query.data.value : undefined)
const exportRange = computed(() => logs.value ? { startDate: logs.value.range.startDate, endDate: logs.value.range.endDate } : undefined)
const exportBlocked = computed(() => !logs.value || query.isPending.value || query.isFetching.value || query.isError.value
  || actorDraft.value !== (filters.value.actorId || '') || resourceDraft.value !== (filters.value.resourceType || '')
  || actionDraft.value !== (filters.value.action || '') || !!actorError.value)
const contextRevision = ref(0)
watch([
  scope, range, filters, pages.cursor, pages.revision, query.isPending, query.isFetching, query.isError,
  () => logs.value?.range.startDate, () => logs.value?.range.endDate,
  actorDraft, resourceDraft, actionDraft, actorError,
], () => { contextRevision.value++ }, { flush: 'sync', deep: true })

/** Applies only the public actor/resource/action filter vocabulary without altering invalid drafts. */
function applyFilters() {
  actorError.value = ''
  if (actorDraft.value && !z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000').safeParse(actorDraft.value).success) { actorError.value = t('audit.invalidActor'); return }
  filters.value = { actorId: actorDraft.value, resourceType: resourceDraft.value, action: actionDraft.value }
}
</script>
<style scoped>
.audit-page { min-width: 0; }
.audit-page__filters { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) auto; align-items: start; gap: 12px; margin: 20px 0; }
.audit-page > p { color: rgb(var(--v-theme-on-surface-variant)); }
@media (max-width: 1000px) { .audit-page__filters { grid-template-columns: 1fr 1fr; } }
@media (max-width: 760px) { .audit-page__filters { grid-template-columns: 1fr; } }
</style>
