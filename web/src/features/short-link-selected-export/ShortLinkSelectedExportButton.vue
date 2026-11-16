<template>
  <div v-if="state.visible.value" class="selected-export">
    <v-btn data-testid="short-link-selected-export" size="small" color="primary" variant="tonal" :disabled="state.disabled.value" :loading="state.pending.value" @click="state.submit">{{ t('selectedListExport.csv') }}</v-btn>
    <p>{{ t('selectedListExport.description') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SelectedListExportState } from './useSelectedListExport'
defineProps<{ state: SelectedListExportState }>()
const { t } = useI18n()
</script>

<style scoped>
.selected-export { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; max-width: 100%; }
.selected-export p { margin: 0; max-width: 300px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; }
</style>
