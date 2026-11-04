<template>
  <v-dialog :model-value="state.targets.value !== null" :aria-label="t('batchNoteClear.title')" :persistent="state.saving.value" max-width="560" scrollable @update:model-value="state.close" @after-enter="focusCancel" @after-leave="restoreFocus">
    <v-card class="batch-note-card" data-testid="batch-note-clear-dialog">
      <v-card-title>{{ t('batchNoteClear.title') }}</v-card-title>
      <v-card-text class="batch-note-body">
        <v-alert type="warning" variant="tonal">{{ t('batchNoteClear.warning') }}</v-alert>
        <v-progress-linear v-if="state.loading.value" indeterminate :aria-label="t('batchNoteClear.loading')" />
        <v-alert v-if="state.unknown.value" type="warning" variant="tonal">{{ t('batchNoteClear.unknown') }}</v-alert>
        <v-alert v-if="state.error.value" type="error" variant="tonal">{{ t(`batchNoteClear.${state.error.value}`) }}</v-alert>
        <div v-if="state.data.value" data-testid="batch-note-clear-summary" role="status">
          <p>{{ t('batchNoteClear.selected', { count: state.targets.value?.length }, state.data.value.items.length) }}</p>
          <p>{{ t('batchNoteClear.nonempty', { count: state.data.value.nonemptyCount }, state.data.value.nonemptyCount) }}</p>
          <p>{{ t('batchNoteClear.alreadyEmpty', { count: state.data.value.emptyCount }, state.data.value.emptyCount) }}</p>
          <p v-if="state.data.value.nonemptyCount === 0">{{ t('batchNoteClear.empty') }}</p>
        </div>
      </v-card-text>
      <v-card-actions class="batch-note-actions">
        <v-btn ref="cancel" data-testid="batch-note-clear-cancel" variant="text" :disabled="state.saving.value" @click="state.close">{{ t('batchNoteClear.cancel') }}</v-btn>
        <v-btn v-if="!state.data.value" data-testid="batch-note-clear-reload" variant="text" :disabled="state.loading.value || state.saving.value" @click="state.reload">{{ t(state.unknown.value ? 'batchNoteClear.check' : 'batchNoteClear.retry') }}</v-btn>
        <v-btn v-if="state.data.value && state.data.value.nonemptyCount > 0" data-testid="batch-note-clear-confirm" color="error" variant="tonal" :disabled="!state.canConfirm.value" :loading="state.saving.value" @click="state.confirm">{{ t('batchNoteClear.confirm', { count: state.data.value.nonemptyCount }, state.data.value.nonemptyCount) }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { useBatchNoteClear } from './useBatchNoteClear'
const props = defineProps<{ state: ReturnType<typeof useBatchNoteClear>; fallbackFocus?: globalThis.HTMLElement | null }>()
const { t } = useI18n()
const cancel = ref<{ $el: globalThis.HTMLElement } | null>(null)
let opener: globalThis.HTMLElement | null = null
watch(() => props.state.targets.value, value => {
  if (value) opener = document.activeElement instanceof globalThis.HTMLElement ? document.activeElement : null
}, { flush: 'sync', immediate: true })
/** Starts keyboard interaction on the safe action only while this confirmation is still open. */
function focusCancel() { if (props.state.targets.value && !props.state.saving.value) cancel.value?.$el.focus() }
/** Restores a still-authorized opener or the current page after the closing transition completes. */
function restoreFocus() {
  if (props.state.targets.value !== null) return
  if (props.state.canRestoreFocus() && opener?.isConnected) {
    opener.focus()
    if (document.activeElement !== opener) props.fallbackFocus?.focus()
  } else props.fallbackFocus?.focus()
  opener = null
}
</script>
<style scoped>
.batch-note-card, .batch-note-body { min-width: 0; }
.batch-note-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.batch-note-body { display: grid; grid-auto-rows: max-content; gap: 14px; overflow-y: auto; overflow-wrap: anywhere; }
.batch-note-body p { margin: 8px 0; }
.batch-note-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; }
@media (max-width: 480px) { .batch-note-actions > * { flex: 1 1 100%; margin: 0; white-space: normal; height: auto; min-height: 40px; } }
</style>
