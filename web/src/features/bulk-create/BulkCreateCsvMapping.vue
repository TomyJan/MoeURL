<template>
  <section class="bulk-csv-mapping" data-testid="bulk-create-csv-mapping">
    <h3>{{ t('bulkCreate.csvMappingTitle') }}</h3>
    <p>{{ t('bulkCreate.csvMappingIgnored') }}</p>
    <v-select :model-value="target === null ? '' : String(target)" :items="[{ title: t('bulkCreate.csvMappingChoose'), value: '' }, ...columns]" :label="t('bulkCreate.csvMappingUrl')" variant="outlined" @update:model-value="emit('update:target', $event === '' ? null : Number($event))" />
    <v-select :model-value="title === null ? '' : String(title)" :items="[{ title: t('bulkCreate.csvMappingNoTitle'), value: '' }, ...columns]" :label="t('bulkCreate.csvMappingTitleColumn')" :disabled="!titleAllowed" variant="outlined" @update:model-value="emit('update:title', $event === '' ? null : Number($event))" />
    <v-select :model-value="tags === null ? '' : String(tags)" :items="[{ title: t('bulkCreate.csvMappingNoTags'), value: '' }, ...columns]" :label="t('bulkCreate.csvMappingTagsColumn')" :disabled="!tagsAllowed" variant="outlined" @update:model-value="emit('update:tags', $event === '' ? null : Number($event))" />
    <p v-if="!titleAllowed">{{ t('bulkCreate.csvMappingTitleDenied') }}</p>
    <p>{{ t('bulkCreate.csvMappingTagsHelp') }}</p>
    <details class="bulk-csv-mapping__advanced">
      <summary>{{ t('bulkCreate.csvMappingAdvancedTitle') }}</summary>
      <p>{{ t('bulkCreate.csvMappingAdvancedHelp') }}</p>
      <v-select :model-value="customSlug === null ? '' : String(customSlug)" :items="optionalColumns('csvMappingNoCustomSlug')" :label="t('bulkCreate.csvMappingCustomSlugColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="emit('update:customSlug', $event === '' ? null : Number($event))" />
      <v-select :model-value="redirectMode === null ? '' : String(redirectMode)" :items="optionalColumns('csvMappingNoRedirectMode')" :label="t('bulkCreate.csvMappingRedirectModeColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="emit('update:redirectMode', $event === '' ? null : Number($event))" />
      <v-select :model-value="expiration === null ? '' : String(expiration)" :items="optionalColumns('csvMappingNoExpiration')" :label="t('bulkCreate.csvMappingExpirationColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="emit('update:expiration', $event === '' ? null : Number($event))" />
      <v-select :model-value="visitLimit === null ? '' : String(visitLimit)" :items="optionalColumns('csvMappingNoVisitLimit')" :label="t('bulkCreate.csvMappingVisitLimitColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="emit('update:visitLimit', $event === '' ? null : Number($event))" />
      <v-select :model-value="countdown === null ? '' : String(countdown)" :items="optionalColumns('csvMappingNoCountdown')" :label="t('bulkCreate.csvMappingCountdownColumn')" :disabled="!advancedAllowed" variant="outlined" @update:model-value="emit('update:countdown', $event === '' ? null : Number($event))" />
      <p v-if="!advancedAllowed">{{ t('bulkCreate.csvMappingAdvancedDenied') }}</p>
    </details>
    <div class="bulk-csv-mapping__actions">
      <v-btn data-testid="bulk-create-mapping-cancel" variant="text" @click="emit('cancel')">{{ t('bulkCreate.csvMappingCancel') }}</v-btn>
      <v-btn data-testid="bulk-create-mapping-apply" variant="tonal" @click="emit('apply')">{{ t('bulkCreate.csvMappingApply') }}</v-btn>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ headers: readonly string[]; target: number | null; title: number | null; tags: number | null; customSlug: number | null; redirectMode: number | null; expiration: number | null; visitLimit: number | null; countdown: number | null; titleAllowed: boolean; tagsAllowed: boolean; advancedAllowed: boolean }>()
const emit = defineEmits<{ 'update:target': [value: number | null]; 'update:title': [value: number | null]; 'update:tags': [value: number | null]; 'update:customSlug': [value: number | null]; 'update:redirectMode': [value: number | null]; 'update:expiration': [value: number | null]; 'update:visitLimit': [value: number | null]; 'update:countdown': [value: number | null]; apply: []; cancel: [] }>()
const { t } = useI18n()
function optionalColumns(key: string) { return [{ title: t(`bulkCreate.${key}`), value: '' }, ...columns.value] }
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
.bulk-csv-mapping :deep(.v-field__input) { min-width: 0; }
.bulk-csv-mapping :deep(.v-select__selection) { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
</style>
