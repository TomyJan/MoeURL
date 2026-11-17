<template>
  <section class="bulk-csv-mapping" data-testid="bulk-create-csv-mapping">
    <h3>{{ t('bulkCreate.csvMappingTitle') }}</h3>
    <p>{{ t('bulkCreate.csvMappingIgnored') }}</p>
    <v-btn class="bulk-csv-mapping__match" variant="tonal" @click="matchHeaders">{{ t('bulkCreate.csvMappingMatch') }}</v-btn>
    <p v-if="matchedCount !== null" role="status">{{ matchedCount ? t('bulkCreate.csvMappingMatched', { count: matchedCount }) : t('bulkCreate.csvMappingNoMatch') }}</p>
    <v-select :model-value="target === null ? '' : String(target)" :items="optionalColumns('csvMappingChoose', 'target')" :label="t('bulkCreate.csvMappingUrl')" variant="outlined" @update:model-value="rememberSelection('target', $event); emit('update:target', $event === '' ? null : Number($event))" />
    <v-select :model-value="title === null ? '' : String(title)" :items="optionalColumns('csvMappingNoTitle', 'title')" :label="t('bulkCreate.csvMappingTitleColumn')" :disabled="!titleAllowed" variant="outlined" @update:model-value="rememberSelection('title', $event); emit('update:title', $event === '' ? null : Number($event))" />
    <v-select :model-value="tags === null ? '' : String(tags)" :items="optionalColumns('csvMappingNoTags', 'tags')" :label="t('bulkCreate.csvMappingTagsColumn')" :disabled="!tagsAllowed" variant="outlined" @update:model-value="rememberSelection('tags', $event); emit('update:tags', $event === '' ? null : Number($event))" />
    <p v-if="!titleAllowed">{{ t('bulkCreate.csvMappingTitleDenied') }}</p>
    <p>{{ t('bulkCreate.csvMappingTagsHelp') }}</p>
    <details class="bulk-csv-mapping__advanced">
      <summary>{{ t('bulkCreate.csvMappingAdvancedTitle') }}</summary>
      <p>{{ t('bulkCreate.csvMappingAdvancedHelp') }}</p>
      <v-select :model-value="customSlug === null ? '' : String(customSlug)" :items="optionalColumns('csvMappingNoCustomSlug', 'customSlug')" :label="t('bulkCreate.csvMappingCustomSlugColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="rememberSelection('customSlug', $event); emit('update:customSlug', $event === '' ? null : Number($event))" />
      <v-select :model-value="redirectMode === null ? '' : String(redirectMode)" :items="optionalColumns('csvMappingNoRedirectMode', 'redirectMode')" :label="t('bulkCreate.csvMappingRedirectModeColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="rememberSelection('redirectMode', $event); emit('update:redirectMode', $event === '' ? null : Number($event))" />
      <v-select :model-value="expiration === null ? '' : String(expiration)" :items="optionalColumns('csvMappingNoExpiration', 'expiration')" :label="t('bulkCreate.csvMappingExpirationColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="rememberSelection('expiration', $event); emit('update:expiration', $event === '' ? null : Number($event))" />
      <v-select :model-value="visitLimit === null ? '' : String(visitLimit)" :items="optionalColumns('csvMappingNoVisitLimit', 'visitLimit')" :label="t('bulkCreate.csvMappingVisitLimitColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="rememberSelection('visitLimit', $event); emit('update:visitLimit', $event === '' ? null : Number($event))" />
      <v-select :model-value="countdown === null ? '' : String(countdown)" :items="optionalColumns('csvMappingNoCountdown', 'countdown')" :label="t('bulkCreate.csvMappingCountdownColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="rememberSelection('countdown', $event); emit('update:countdown', $event === '' ? null : Number($event))" />
      <p v-if="!advancedAllowed">{{ t('bulkCreate.csvMappingAdvancedDenied') }}</p>
    </details>
    <div class="bulk-csv-mapping__actions">
      <v-btn data-testid="bulk-create-mapping-cancel" variant="text" @click="emit('cancel')">{{ t('bulkCreate.csvMappingCancel') }}</v-btn>
      <v-btn data-testid="bulk-create-mapping-apply" variant="tonal" @click="emit('apply')">{{ t('bulkCreate.csvMappingApply') }}</v-btn>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { matchCsvHeaderAliases, type CsvHeaderField } from './csv-header-aliases'
const props = defineProps<{ headers: readonly string[]; target: number | null; title: number | null; tags: number | null; customSlug: number | null; redirectMode: number | null; expiration: number | null; visitLimit: number | null; countdown: number | null; titleAllowed: boolean; tagsAllowed: boolean; advancedAllowed: boolean }>()
const emit = defineEmits<{ 'update:target': [value: number | null]; 'update:title': [value: number | null]; 'update:tags': [value: number | null]; 'update:customSlug': [value: number | null]; 'update:redirectMode': [value: number | null]; 'update:expiration': [value: number | null]; 'update:visitLimit': [value: number | null]; 'update:countdown': [value: number | null]; apply: []; cancel: [] }>()
const { t } = useI18n()
const matchedCount = ref<number | null>(null)
const excluded = new Set<CsvHeaderField>()
watch(() => props.headers, () => { matchedCount.value = null; excluded.clear() })
/** Keeps an explicit no-import choice distinct from an untouched empty choice for this file. */
function rememberSelection(field: CsvHeaderField, value: unknown) {
  if (value === '') excluded.add(field)
  else excluded.delete(field)
}
function matchHeaders() {
  const matches = matchCsvHeaderAliases(props.headers, props, { title: props.titleAllowed, tags: props.tagsAllowed, advanced: props.advancedAllowed }, [...excluded])
  if (matches.target !== undefined) emit('update:target', matches.target)
  if (matches.title !== undefined) emit('update:title', matches.title)
  if (matches.tags !== undefined) emit('update:tags', matches.tags)
  if (matches.customSlug !== undefined) emit('update:customSlug', matches.customSlug)
  if (matches.redirectMode !== undefined) emit('update:redirectMode', matches.redirectMode)
  if (matches.expiration !== undefined) emit('update:expiration', matches.expiration)
  if (matches.visitLimit !== undefined) emit('update:visitLimit', matches.visitLimit)
  if (matches.countdown !== undefined) emit('update:countdown', matches.countdown)
  matchedCount.value = Object.keys(matches).length
}
// Vuetify suppresses model updates when the same empty value is selected; the item's click records that intent too.
function optionalColumns(key: string, field: CsvHeaderField) { return [{ title: t(`bulkCreate.${key}`), value: '', props: { onClick: rememberSelection.bind(null, field, '') } }, ...columns.value] }
// Column numbers disambiguate duplicate/empty names; never display data cells or full-value tooltips.
const columns = computed(() => props.headers.map((header, index) => {
  const points = Array.from(header.replace(/\p{C}/gu, '\uFFFD'))
  const name = points.slice(0, 60).join('') + (points.length > 60 ? '…' : '')
  return { title: t('bulkCreate.csvMappingColumn', { column: index + 1, name: name || t('bulkCreate.csvMappingUnnamed') }), value: String(index) }
}))
</script>
<style scoped>
.bulk-csv-mapping { display: grid; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
.bulk-csv-mapping__advanced { display: grid; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
.bulk-csv-mapping__advanced summary { cursor: pointer; font-weight: 600; }
.bulk-csv-mapping__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.bulk-csv-mapping__match { justify-self: start; max-width: 100%; height: auto; min-height: 40px; white-space: normal; }
.bulk-csv-mapping :deep(.v-field__input) { min-width: 0; }
.bulk-csv-mapping :deep(.v-select__selection) { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
</style>
