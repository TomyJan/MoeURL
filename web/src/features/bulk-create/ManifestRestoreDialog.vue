<template>
  <section class="manifest-restore">
    <v-btn v-if="state.allowed.value" data-testid="manifest-restore-open" variant="tonal" @click="state.begin">{{ t('manifestRestore.open') }}</v-btn>
    <v-card v-if="state.opened.value" class="manifest-restore-panel" data-testid="manifest-restore-dialog">
      <v-card-title>{{ t('manifestRestore.title') }}</v-card-title>
      <v-card-text>
        <p>{{ t('manifestRestore.description') }}</p>
        <v-alert type="warning" variant="tonal" data-testid="manifest-restore-impact">
          <ul>
            <li>{{ t('manifestRestore.owner') }}</li>
            <li>{{ t('manifestRestore.visits') }}</li>
            <li>{{ t('manifestRestore.passwords') }}</li>
            <li>{{ t('manifestRestore.formulaPrefix') }}</li>
          </ul>
        </v-alert>
        <label class="manifest-restore-file">
          <span>{{ t('manifestRestore.file') }}</span>
          <input type="file" accept=".csv,text/csv" data-testid="manifest-restore-file" :disabled="state.pending.value || state.unknown.value" @change="selectFile" />
        </label>
        <p v-if="state.fileName.value" data-testid="manifest-restore-filename">{{ t('manifestRestore.selectedFile', { name: state.fileName.value }) }}</p>
        <p v-if="state.reading.value" role="status">{{ t('manifestRestore.reading') }}</p>
        <div v-if="state.errorKey.value" role="alert" data-testid="manifest-restore-error">
          <p>{{ t(state.errorKey.value) }}</p>
          <p v-if="state.errorIssue.value" data-testid="manifest-restore-issue">
            {{ t(`manifestRestore.issues.${state.errorIssue.value.kind}`, { record: state.errorIssue.value.record, field: state.errorIssue.value.field ?? '' }) }}
          </p>
        </div>
        <template v-if="state.parsed.value">
          <div class="manifest-restore-summary" data-testid="manifest-restore-preview">
            <p>{{ t('manifestRestore.previewCount', { count: state.parsed.value.length }) }}</p>
            <p>{{ t('manifestRestore.previewOrigins', { origins: state.origins.value.join(', ') }) }}</p>
            <p>{{ t('manifestRestore.previewLimit') }}</p>
          </div>
          <label class="manifest-restore-acknowledge">
            <input v-model="acknowledged" type="checkbox" :disabled="state.pending.value || state.unknown.value || state.createdCount.value > 0" data-testid="manifest-restore-acknowledge" />
            <span>{{ t('manifestRestore.acknowledge') }}</span>
          </label>
        </template>
        <div v-if="state.unknown.value" role="status" data-testid="manifest-restore-unknown">
          <p>{{ t('manifestRestore.unknown') }}</p>
          <p>{{ t('manifestRestore.requestId') }} <code data-testid="manifest-restore-request-id">{{ state.snapshot.value?.requestId }}</code></p>
        </div>
        <p v-if="state.createdCount.value" role="status" data-testid="manifest-restore-success">{{ t('manifestRestore.success', { count: state.createdCount.value }, state.createdCount.value) }}</p>
      </v-card-text>
      <v-card-actions class="manifest-restore-actions" data-testid="manifest-restore-action-row">
        <v-btn v-if="state.unknown.value" data-testid="manifest-restore-retry" :disabled="state.pending.value" variant="flat" color="primary" @click="state.retry">{{ t('manifestRestore.retry') }}</v-btn>
        <v-btn v-else-if="state.parsed.value && !state.createdCount.value" data-testid="manifest-restore-confirm" :disabled="!acknowledged || state.pending.value" :loading="state.pending.value" variant="flat" color="primary" @click="state.confirm">{{ t('manifestRestore.confirm') }}</v-btn>
        <v-btn v-if="state.unknown.value" data-testid="manifest-restore-discard" variant="text" @click="state.discard">{{ t('manifestRestore.discard') }}</v-btn>
        <v-btn v-else data-testid="manifest-restore-close" :disabled="state.pending.value" variant="text" @click="state.close">{{ t('manifestRestore.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useManifestRestore } from './useManifestRestore'

const { t } = useI18n()
const state = useManifestRestore()
const acknowledged = ref(false)
const emit = defineEmits<{ active: [value: boolean] }>()
// The containing workflow must not unmount a draft without an explicit close or discard.
watch(state.opened, value => emit('active', value), { flush: 'sync' })

function selectFile(event: globalThis.Event) {
  const input = event.target as globalThis.HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  acknowledged.value = false
  void state.selectFile(file)
}
</script>

<style scoped>
.manifest-restore { display: grid; gap: 12px; min-width: 0; }
.manifest-restore-panel { min-width: 0; max-width: 100%; }
.manifest-restore-panel :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.manifest-restore-panel p, .manifest-restore-panel li { overflow-wrap: anywhere; }
.manifest-restore-panel ul { margin: 0; padding-inline-start: 1.25rem; }
.manifest-restore-file, .manifest-restore-acknowledge { display: flex; gap: 10px; align-items: flex-start; min-width: 0; margin-block: 12px; }
.manifest-restore-file { flex-direction: column; }
.manifest-restore-file input { max-width: 100%; }
.manifest-restore-summary { overflow-wrap: anywhere; }
.manifest-restore-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 600px) {
  .manifest-restore-actions { flex-direction: column; align-items: stretch; }
  .manifest-restore-actions :deep(.v-btn) { min-height: 44px; }
}
</style>
