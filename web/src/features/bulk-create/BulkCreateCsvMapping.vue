<template>
  <section class="bulk-csv-mapping" data-testid="bulk-create-csv-mapping">
    <h3>{{ t('bulkCreate.csvMappingTitle') }}</h3>
    <p>{{ t('bulkCreate.csvMappingIgnored') }}</p>
    <v-select :model-value="target === null ? '' : String(target)" :items="[{ title: t('bulkCreate.csvMappingChoose'), value: '' }, ...columns]" :label="t('bulkCreate.csvMappingUrl')" variant="outlined" @update:model-value="emit('update:target', $event === '' ? null : Number($event))" />
    <v-select :model-value="title === null ? '' : String(title)" :items="[{ title: t('bulkCreate.csvMappingNoTitle'), value: '' }, ...columns]" :label="t('bulkCreate.csvMappingTitleColumn')" :disabled="!titleAllowed" variant="outlined" @update:model-value="emit('update:title', $event === '' ? null : Number($event))" />
    <p v-if="!titleAllowed">{{ t('bulkCreate.csvMappingTitleDenied') }}</p>
    <div class="bulk-csv-mapping__actions">
      <v-btn data-testid="bulk-create-mapping-cancel" variant="text" @click="emit('cancel')">{{ t('bulkCreate.csvMappingCancel') }}</v-btn>
      <v-btn data-testid="bulk-create-mapping-apply" variant="tonal" @click="emit('apply')">{{ t('bulkCreate.csvMappingApply') }}</v-btn>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ headers: readonly string[]; target: number | null; title: number | null; titleAllowed: boolean }>()
const emit = defineEmits<{ 'update:target': [value: number | null]; 'update:title': [value: number | null]; apply: []; cancel: [] }>()
const { t } = useI18n()
// Column numbers disambiguate duplicate/empty names; never display data cells or full-value tooltips.
const columns = computed(() => props.headers.map((header, index) => {
  const points = Array.from(header.replace(/\p{C}/gu, '\uFFFD'))
  const name = points.slice(0, 60).join('') + (points.length > 60 ? '…' : '')
  return { title: t('bulkCreate.csvMappingColumn', { column: index + 1, name: name || t('bulkCreate.csvMappingUnnamed') }), value: String(index) }
}))
</script>
<style scoped>
.bulk-csv-mapping { display: grid; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
.bulk-csv-mapping__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.bulk-csv-mapping :deep(.v-field__input) { min-width: 0; }
.bulk-csv-mapping :deep(.v-select__selection) { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
</style>
