<template>
  <v-dialog :model-value="state.targets.value !== null" :aria-label="t('batchNoteAppend.title')" :persistent="state.saving.value || state.discardRequested.value" max-width="600" scrollable @update:model-value="state.close" @after-enter="focusDraft" @after-leave="restoreFocus">
    <v-card class="batch-append-card" data-testid="batch-note-append-dialog" :aria-busy="state.saving.value">
      <v-card-title>{{ t('batchNoteAppend.title') }}</v-card-title>
      <v-card-text v-if="state.discardRequested.value" key="discard" class="batch-append-body">
        <v-alert type="warning" variant="tonal" data-testid="batch-note-append-discard-warning">{{ t('batchNoteAppend.discardWarning') }}</v-alert>
        <p>{{ t('batchNoteAppend.requestId', { id: state.requestId.value }) }}</p>
      </v-card-text>
      <v-card-text v-else key="edit" class="batch-append-body">
        <v-alert type="warning" variant="tonal">{{ t('batchNoteAppend.warning') }}</v-alert>
        <p>{{ t('batchNoteAppend.selected', { count: state.targets.value?.length ?? 0 }, state.targets.value?.length ?? 0) }}</p>
        <v-textarea ref="editor" :model-value="state.draft.value" :label="t('batchNoteAppend.note')" :hint="t('batchNoteAppend.hint')" persistent-hint :readonly="state.saving.value || state.unknown.value" :error-messages="state.error.value === 'invalidNote' ? t('batchNoteAppend.invalidNote') : ''" variant="outlined" rows="4" counter="1000" :counter-value="codePoints" @update:model-value="state.setDraft" />
        <v-progress-linear v-if="state.loading.value" indeterminate :aria-label="t('batchNoteAppend.loading')" />
        <p v-if="state.saving.value" role="status">{{ t('batchNoteAppend.saving') }}</p>
        <v-alert v-if="state.unknown.value" type="warning" variant="tonal" data-testid="batch-note-append-unknown">{{ t('batchNoteAppend.unknown') }}<p>{{ t('batchNoteAppend.requestId', { id: state.requestId.value }) }}</p></v-alert>
        <v-alert v-if="state.error.value && state.error.value !== 'invalidNote'" type="error" variant="tonal">{{ t('batchNoteAppend.' + state.error.value) }}</v-alert>
        <div v-if="state.data.value" data-testid="batch-note-append-summary" role="status">
          <p>{{ t('batchNoteAppend.appendable', { count: state.data.value.appendableCount }, state.data.value.appendableCount) }}</p>
          <p>{{ t('batchNoteAppend.overflow', { count: state.data.value.overflowCount }, state.data.value.overflowCount) }}</p>
          <p v-if="state.data.value.overflowCount > 0">{{ t('batchNoteAppend.blocked') }}</p>
        </div>
      </v-card-text>
      <v-card-actions class="batch-append-actions">
        <template v-if="state.discardRequested.value">
          <v-btn ref="keep" data-testid="batch-note-append-keep" variant="text" @click="state.cancelDiscard">{{ t('batchNoteAppend.keep') }}</v-btn>
          <v-btn data-testid="batch-note-append-discard" color="error" variant="tonal" v-on="{ click: state.discard }">{{ t('batchNoteAppend.discard') }}</v-btn>
        </template>
        <template v-else>
          <v-btn ref="cancel" data-testid="batch-note-append-cancel" variant="text" :disabled="state.saving.value" @click="state.close">{{ t('batchNoteAppend.cancel') }}</v-btn>
          <v-btn v-if="state.unknown.value" data-testid="batch-note-append-retry" color="primary" :disabled="!state.canRetry.value" :loading="state.saving.value" v-on="{ click: state.retry }">{{ t('batchNoteAppend.retry') }}</v-btn>
          <v-btn v-else-if="!state.data.value" data-testid="batch-note-append-preview" variant="text" :disabled="!state.canPreview.value" @click="state.preview">{{ t('batchNoteAppend.preview') }}</v-btn>
          <v-btn v-if="state.data.value && state.data.value.overflowCount === 0 && !state.unknown.value" data-testid="batch-note-append-confirm" color="primary" variant="tonal" :disabled="!state.canConfirm.value" :loading="state.saving.value" v-on="{ click: state.confirm }">{{ t('batchNoteAppend.confirm', { count: state.data.value.appendableCount }, state.data.value.appendableCount) }}</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { useBatchNoteAppend } from './useBatchNoteAppend'
const props = defineProps<{ state: ReturnType<typeof useBatchNoteAppend>; fallbackFocus?: globalThis.HTMLElement | null }>()
const { t } = useI18n()
const cancel = ref<{ $el: globalThis.HTMLElement } | null>(null), keep = ref<{ $el: globalThis.HTMLElement } | null>(null)
const editor = ref<{ $el: globalThis.HTMLElement } | null>(null)
let opener: globalThis.HTMLElement | null = null
watch(() => props.state.targets.value, value => {
  if (value) opener = document.activeElement instanceof globalThis.HTMLElement ? document.activeElement : null
}, { flush: 'sync', immediate: true })
watch(() => props.state.discardRequested.value, async value => { if (value) { await nextTick(); if (props.state.discardRequested.value) keep.value?.$el.focus() } })
/** Counts Unicode code points without imposing a UTF-16 maxlength. */
function codePoints(value: string) { return Array.from(value).length }
/** Gives keyboard focus to editing or the safe cancel action, never to an implicit write. */
function focusDraft() {
  if (!props.state.targets.value || props.state.saving.value) return
  if (props.state.unknown.value) cancel.value?.$el.focus()
  else editor.value?.$el.querySelector('textarea')?.focus()
}
/** Restores only a current authorized opener after the actual closing transition. */
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
.batch-append-card, .batch-append-body { min-width: 0; }
.batch-append-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.batch-append-body { display: grid; grid-auto-rows: max-content; gap: 14px; overflow-y: auto; overflow-wrap: anywhere; }
.batch-append-body p { margin: 8px 0; }
.batch-append-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; }
@media (max-width: 480px) { .batch-append-actions > * { flex: 1 1 100%; margin: 0; white-space: normal; height: auto; min-height: 40px; } }
</style>
