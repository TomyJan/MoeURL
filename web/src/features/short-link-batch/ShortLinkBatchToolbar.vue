<template>
  <div v-if="access.canSelect.value" class="batch-toolbar" data-testid="batch-toolbar" :aria-busy="state.pending.value">
    <p aria-live="polite">{{ t('batch.selected', { count: state.selected.value.length }) }} <span>{{ t('batch.currentList') }}</span></p>
    <div class="batch-toolbar__actions">
      <v-btn v-if="access.canUpdate.value" data-testid="batch-enable" size="small" color="primary" variant="tonal" :disabled="disabled" @click="state.submit('enable')">{{ t('batch.enable') }}</v-btn>
      <v-btn v-if="access.canUpdate.value" data-testid="batch-disable" size="small" variant="tonal" :disabled="disabled" @click="state.submit('disable')">{{ t('batch.disable') }}</v-btn>
      <v-btn v-if="access.canDelete.value" data-testid="batch-delete" size="small" color="error" variant="text" :disabled="disabled" @click="state.openDelete">{{ t('batch.delete') }}</v-btn>
    </div>
    <v-progress-linear v-if="state.pending.value" indeterminate :aria-label="t('batch.processing')" />
  </div>
  <v-dialog v-if="state.deleteIds.value" :model-value="true" max-width="460" @update:model-value="state.closeDelete">
    <v-card>
      <v-card-title>{{ t('batch.deleteTitle') }}</v-card-title>
      <v-card-text>{{ t('batch.deleteDescription', { count: state.deleteIds.value.length }, state.deleteIds.value.length) }}</v-card-text>
      <v-card-actions>
        <v-btn data-testid="batch-cancel-delete" variant="text" @click="state.closeDelete">{{ t('batch.cancel') }}</v-btn>
        <v-btn data-testid="batch-confirm-delete" color="error" variant="tonal" :disabled="state.unavailable.value || !access.canDelete.value" :loading="state.pending.value" @click="state.confirmDelete">{{ t('batch.confirmDelete') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { useShortLinkAccess, useShortLinkBatch } from './useShortLinkBatch'

const props = defineProps<{ state: ReturnType<typeof useShortLinkBatch>; access: ReturnType<typeof useShortLinkAccess> }>()
const { t } = useI18n()
const disabled = computed(() => props.state.unavailable.value || props.state.selected.value.length === 0)
</script>

<style scoped>
.batch-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.batch-toolbar p { margin: 0; font-size: 0.875rem; }
.batch-toolbar p span { margin-inline-start: 8px; color: rgb(var(--v-theme-on-surface-variant)); }
.batch-toolbar__actions { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
