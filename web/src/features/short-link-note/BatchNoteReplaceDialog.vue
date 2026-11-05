<template>
  <v-dialog :model-value="state.targets.value !== null" :aria-label="t('batchNoteReplace.title')" :persistent="state.saving.value" max-width="600" scrollable @update:model-value="state.close" @after-enter="focusDraft" @after-leave="restoreFocus">
    <v-card class="batch-note-card" data-testid="batch-note-replace-dialog">
      <v-card-title>{{ t('batchNoteReplace.title') }}</v-card-title>
      <v-card-text class="batch-note-body">
        <v-alert type="warning" variant="tonal">{{ t('batchNoteReplace.warning') }}</v-alert>
        <p>{{ t('batchNoteReplace.selected', { count: state.targets.value?.length ?? 0 }, state.targets.value?.length ?? 0) }}</p>
        <v-textarea ref="editor" :model-value="state.draft.value" :label="t('batchNoteReplace.note')" :hint="t('batchNoteReplace.hint')" persistent-hint :readonly="state.saving.value || state.unknown.value" :error-messages="state.error.value === 'invalidNote' ? t('batchNoteReplace.invalidNote') : ''" variant="outlined" rows="4" counter="1000" :counter-value="codePoints" @update:model-value="state.setDraft" />
        <v-progress-linear v-if="state.loading.value" indeterminate :aria-label="t('batchNoteReplace.loading')" />
        <v-alert v-if="state.unknown.value" type="warning" variant="tonal">{{ t('batchNoteReplace.unknown') }}</v-alert>
        <v-alert v-if="state.error.value && state.error.value !== 'invalidNote'" type="error" variant="tonal">{{ t(`batchNoteReplace.${state.error.value}`) }}</v-alert>
        <div v-if="state.data.value" data-testid="batch-note-replace-summary" role="status">
          <p>{{ t('batchNoteReplace.changed', { count: state.data.value.changedCount }, state.data.value.changedCount) }}</p>
          <p>{{ t('batchNoteReplace.unchanged', { count: state.data.value.unchangedCount }, state.data.value.unchangedCount) }}</p>
          <p v-if="state.data.value.changedCount === 0">{{ t('batchNoteReplace.sameValue') }}</p>
        </div>
      </v-card-text>
      <v-card-actions class="batch-note-actions">
        <v-btn ref="cancel" data-testid="batch-note-replace-cancel" variant="text" :disabled="state.saving.value" @click="state.close">{{ t('batchNoteReplace.cancel') }}</v-btn>
        <v-btn v-if="!state.data.value" data-testid="batch-note-replace-preview" variant="text" :disabled="!state.canPreview.value" @click="state.preview">{{ t(state.unknown.value ? 'batchNoteReplace.check' : 'batchNoteReplace.preview') }}</v-btn>
        <v-btn v-if="state.data.value && state.data.value.changedCount > 0" data-testid="batch-note-replace-confirm" color="error" variant="tonal" :disabled="!state.canConfirm.value" :loading="state.saving.value" v-on="{ click: state.confirm }">{{ t('batchNoteReplace.confirm', { count: state.data.value.changedCount }, state.data.value.changedCount) }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { useBatchNoteReplace } from './useBatchNoteReplace'
const props = defineProps<{ state: ReturnType<typeof useBatchNoteReplace>; fallbackFocus?: globalThis.HTMLElement | null }>()
const { t } = useI18n()
const cancel = ref<{ $el: globalThis.HTMLElement } | null>(null)
const editor = ref<{ $el: globalThis.HTMLElement } | null>(null)
let opener: globalThis.HTMLElement | null = null
watch(() => props.state.targets.value, value => {
  if (value) opener = document.activeElement instanceof globalThis.HTMLElement ? document.activeElement : null
}, { flush: 'sync', immediate: true })
/** Counts Unicode code points rather than browser UTF-16 units. */
function codePoints(value: string) { return Array.from(value).length }
/** Focuses the editable draft without making Enter an implicit replacement action. */
function focusDraft() {
  if (!props.state.targets.value || props.state.saving.value) return
  if (props.state.unknown.value) cancel.value?.$el.focus()
  else editor.value?.$el.querySelector('textarea')?.focus()
}
/** Restores a current authorized opener after the dialog's own closing transition. */
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
