<template>
  <v-dialog :model-value="!!state.target.value" :persistent="state.saving.value" max-width="680" scrollable @update:model-value="state.close">
    <v-card class="note-card" data-testid="note-dialog">
      <v-card-title>{{ t('linkNote.title') }}</v-card-title>
      <v-card-text class="note-body">
        <p class="note-url">{{ state.target.value?.url }}</p>
        <v-alert type="info" variant="tonal">{{ t('linkNote.transferWarning') }}</v-alert>
        <v-alert v-if="!state.canWrite.value" type="info" variant="tonal">{{ t('linkNote.readonly') }}</v-alert>
        <v-progress-linear v-if="state.loading.value" indeterminate />
        <v-alert v-if="state.blocked.value" type="warning" variant="tonal">{{ t(`linkNote.${state.blocked.value}`) }}</v-alert>
        <v-alert v-if="state.error.value" type="error" variant="tonal">{{ t(`linkNote.${state.error.value}`) }}</v-alert>
        <v-textarea
          :model-value="state.draft.value"
          :label="t('linkNote.text')"
          :readonly="!state.canWrite.value"
          :disabled="state.loading.value || state.saving.value || !state.data.value"
          :error-messages="state.parsed.value.success ? '' : t('linkNote.invalid')"
          rows="7"
          auto-grow
          variant="outlined"
          @update:model-value="state.edit"
        />
        <p class="note-counter" role="status">{{ t('linkNote.count', { count: [...state.draft.value].length }) }}</p>
      </v-card-text>
      <v-card-actions class="note-actions">
        <v-btn :disabled="state.saving.value" variant="text" @click="state.close">{{ t('linkNote.close') }}</v-btn>
        <v-btn :disabled="state.loading.value || state.saving.value" variant="text" @click="state.reload">{{ t('linkNote.reload') }}</v-btn>
        <v-btn v-if="state.canWrite.value" :disabled="!state.data.value || state.loading.value || state.saving.value || !!state.blocked.value" variant="text" @click="state.clear">{{ t('linkNote.clear') }}</v-btn>
        <v-btn v-if="state.canWrite.value" :disabled="!state.canSave.value" :loading="state.saving.value" color="primary" variant="flat" @click="state.save">{{ t('linkNote.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { useShortLinkNote } from './useShortLinkNote'
defineProps<{ state: ReturnType<typeof useShortLinkNote> }>()
const { t } = useI18n()
</script>
<style scoped>
.note-card, .note-body { min-width: 0; }
.note-body { display: grid; grid-auto-rows: max-content; gap: 14px; min-height: 0; overflow-y: auto; overflow-wrap: anywhere; }
.note-url { margin: 0; overflow-wrap: anywhere; }
.note-counter { margin: 0; text-align: end; }
.note-body :deep(textarea) { white-space: pre-wrap; overflow-wrap: anywhere; }
.note-card :deep(.v-card-title) { white-space: normal; }
.note-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; }
@media (max-width: 480px) { .note-actions > * { flex: 1 1 40%; margin: 0; } }
</style>
