<template>
  <v-btn v-if="state.allowed.value" data-testid="bulk-create-open" variant="tonal" @click="state.begin">{{ t('bulkCreate.open') }}</v-btn>
  <v-dialog :model-value="state.opened.value" :persistent="state.pending.value || state.unknown.value" max-width="680" scrollable @update:model-value="state.close">
    <v-card class="bulk-create-card" data-testid="bulk-create-dialog">
      <v-card-title>{{ t('bulkCreate.title') }}</v-card-title>
      <v-card-text class="bulk-create-body">
        <p>{{ t('bulkCreate.policy') }}</p>
        <v-alert type="info" variant="tonal">{{ t('bulkCreate.recovery') }}</v-alert>
        <template v-if="!state.snapshot.value">
          <label class="bulk-create-file">
            <span>{{ t('bulkCreate.csvLabel') }}</span>
            <input type="file" accept=".csv,text/csv" :disabled="state.pending.value" @change="selectFile" />
          </label>
          <p>{{ t('bulkCreate.csvHelp') }}</p>
          <BulkCreateCsvHelp v-if="state.opened.value" />
          <p v-if="state.reading.value" role="status">{{ t('bulkCreate.csvReading') }}</p>
          <v-textarea v-model="state.draft.value" :label="t('bulkCreate.targets')" rows="6" variant="outlined" :disabled="state.pending.value" />
        </template>
        <template v-else>
          <ol data-testid="bulk-create-preview-list"><li v-for="(target, index) in state.snapshot.value.targetUrls" :key="index">{{ target }}</li></ol>
          <p>{{ t('bulkCreate.requestId') }} <code data-testid="bulk-create-request-id">{{ state.snapshot.value.requestId }}</code></p>
        </template>
        <v-alert v-if="state.errorKey.value" type="warning" variant="tonal" data-testid="bulk-create-error">{{ t(state.errorKey.value) }}</v-alert>
        <v-alert v-if="state.closing.value" type="warning" variant="tonal" data-testid="bulk-create-close-warning">
          <p>{{ t('bulkCreate.discardWarning') }}</p>
          <v-btn data-testid="bulk-create-keep" variant="text" @click="state.cancelClose">{{ t('bulkCreate.keep') }}</v-btn>
          <v-btn data-testid="bulk-create-discard" variant="text" @click="state.discard">{{ t('bulkCreate.discard') }}</v-btn>
        </v-alert>
      </v-card-text>
      <v-card-actions class="bulk-create-actions">
        <v-btn data-testid="bulk-create-close" :disabled="state.pending.value" variant="text" @click="state.close">{{ t('bulkCreate.close') }}</v-btn>
        <v-btn v-if="!state.snapshot.value" data-testid="bulk-create-preview" :disabled="state.reading.value" variant="flat" color="primary" @click="state.preview">{{ t('bulkCreate.preview') }}</v-btn>
        <template v-else>
          <v-btn data-testid="bulk-create-edit" :disabled="state.pending.value || state.unknown.value" variant="text" @click="state.edit">{{ t('bulkCreate.edit') }}</v-btn>
          <v-btn data-testid="bulk-create-submit" :disabled="state.pending.value || state.closing.value" :loading="state.pending.value" variant="flat" color="primary" @click="state.submit">{{ t(state.unknown.value ? 'bulkCreate.retry' : 'bulkCreate.create') }}</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useBulkCreate } from './useBulkCreate'
import BulkCreateCsvHelp from './BulkCreateCsvHelp.vue'
const { t } = useI18n()
const state = useBulkCreate()
/** Releases the native selection so choosing the same file starts a fresh explicit read. */
function selectFile(event: globalThis.Event) {
  const input = event.target as globalThis.HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  void state.importFile(file)
}
</script>
<style scoped>
.bulk-create-card { min-width: 0; max-height: calc(100dvh - 32px); }
.bulk-create-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.bulk-create-body { display: grid; grid-auto-rows: max-content; align-content: start; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
.bulk-create-body p { margin: 0; }
.bulk-create-body ol { padding-inline-start: 24px; }
.bulk-create-body li + li { margin-top: 8px; }
.bulk-create-body code { user-select: text; }
.bulk-create-actions { flex-wrap: wrap; }
.bulk-create-file { display: grid; gap: 8px; min-width: 0; }
.bulk-create-file input { min-width: 0; max-width: 100%; min-height: 44px; }
</style>
