<template>
  <div class="insight-range">
    <v-select v-model="choice" :items="options" :label="t('analytics.dateRange')" variant="outlined" hide-details />
    <form v-if="choice === 'custom'" class="insight-range__custom" novalidate @submit.prevent="apply">
      <v-text-field v-model="startDate" type="date" :label="t('analytics.startDate')" :error-messages="errors.startDate" variant="outlined" />
      <v-text-field v-model="endDate" type="date" :label="t('analytics.endDate')" :error-messages="errors.endDate" variant="outlined" />
      <v-btn type="submit" color="primary" variant="tonal">{{ t('analytics.apply') }}</v-btn>
    </form>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm } from 'vee-validate'
import { statisticsDateRangeSchema } from '@/entities/short-link/schema'
import type { InsightRangeInput } from '@/entities/insights/model'

const model = defineModel<InsightRangeInput>({ required: true })
const { t } = useI18n()
const choice = ref('7')
const options = computed(() => [7, 30, 90].map((days) => ({ title: t(`analytics.days${days}`), value: String(days) })).concat({ title: t('analytics.custom'), value: 'custom' }))
const { values, errors, defineField, setErrors } = useForm({ initialValues: { startDate: '', endDate: '' } })
const [startDate] = defineField('startDate')
const [endDate] = defineField('endDate')
watch(choice, (value) => { if (value !== 'custom') model.value = { days: Number(value) as 7 | 30 | 90 } }, { flush: 'sync' })

/** Applies valid UTC calendar drafts while retaining the last applied range on errors. */
function apply() {
  const result = statisticsDateRangeSchema.refine((range) => range.endDate <= new Date().toISOString().slice(0, 10), { path: ['endDate'], message: 'futureDate' }).safeParse(values)
  setErrors({ startDate: undefined, endDate: undefined })
  if (!result.success) {
    const messages: Partial<Record<'startDate' | 'endDate', string>> = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0] as 'startDate' | 'endDate'
      if (!messages[field]) messages[field] = t(`analytics.${issue.code === 'custom' ? issue.message : 'invalidDate'}`)
    }
    setErrors(messages)
    return
  }
  model.value = result.data
}
</script>
<style scoped>
.insight-range { display: grid; gap: 12px; margin: 20px 0; }
.insight-range > :deep(.v-input) { max-width: 320px; }
.insight-range__custom { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: start; gap: 12px; }
@media (max-width: 760px) { .insight-range__custom { grid-template-columns: 1fr; } .insight-range > :deep(.v-input) { max-width: none; } }
</style>
