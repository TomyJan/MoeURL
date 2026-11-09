<template>
  <v-dialog :model-value="state.targets.value !== null" :aria-label="t('batchTagRename.title')" :persistent="locked" max-width="680" scrollable @update:model-value="state.close" @after-enter="focusInput" @after-leave="restoreFocus">
    <v-card class="tag-rename-card" data-testid="batch-tag-rename-dialog">
      <v-card-title>{{ t('batchTagRename.title') }}</v-card-title>
      <v-alert v-if="state.recovery.value" class="tag-rename-feedback" type="warning" variant="tonal">{{ t(state.unknown.value ? 'batchTagRename.unknown' : 'batchTagRename.stale') }}</v-alert>
      <v-alert v-if="state.error.value" class="tag-rename-feedback" type="error" variant="tonal">{{ t(`batchTagRename.${state.error.value}`) }}</v-alert>
      <v-card-text class="tag-rename-body">
        <v-alert type="info" variant="tonal">{{ t('batchTagRename.scope') }}</v-alert>
        <v-text-field ref="fromInput" :model-value="state.draft.value.fromTag" :label="t('batchTagRename.from')" :readonly="locked" variant="outlined" :error-messages="invalid ? t('batchTagRename.invalid') : ''" counter="32" :counter-value="codePoints" @update:model-value="state.setFromTag" />
        <v-text-field :model-value="state.draft.value.toTag" :label="t('batchTagRename.to')" :readonly="locked" variant="outlined" :error-messages="invalid ? t('batchTagRename.invalid') : ''" counter="32" :counter-value="codePoints" @update:model-value="state.setToTag" />
        <div v-if="state.preview.value" role="status" data-testid="batch-tag-rename-preview">
          <p>{{ t('batchTagRename.changed', { count: state.preview.value.changedCount }, state.preview.value.changedCount) }}</p>
          <p>{{ t('batchTagRename.unchanged', { count: state.preview.value.unchangedCount }, state.preview.value.unchangedCount) }}</p>
          <p v-if="state.preview.value.changedCount === 0">{{ t('batchTagRename.noop') }}</p>
          <ol>
            <li v-for="item in state.preview.value.items" :key="item.id">
              <p>{{ item.url }}</p>
              <p>{{ t('batchTagRename.before') }} <span v-for="tag in item.tags" :key="tag" class="tag-rename-chip">{{ tag }}</span></p>
              <p>{{ t('batchTagRename.after') }} <span v-for="tag in item.after" :key="tag" class="tag-rename-chip">{{ tag }}</span></p>
            </li>
          </ol>
        </div>
      </v-card-text>
      <v-card-actions class="tag-rename-actions">
        <v-btn variant="text" :disabled="locked" @click="state.close">{{ t('batchTagRename.cancel') }}</v-btn>
        <v-btn v-if="state.recovery.value" ref="reloadButton" data-testid="batch-tag-rename-reload" variant="tonal" :loading="state.loading.value" :disabled="state.saving.value" @click="state.reload">{{ t('batchTagRename.reload') }}</v-btn>
        <v-btn v-else-if="!state.approved.value && !state.saving.value" data-testid="batch-tag-rename-approve" variant="tonal" :disabled="locked || !state.preview.value?.changedCount" v-on="{ click: state.approve }">{{ t('batchTagRename.approve') }}</v-btn>
        <v-btn v-else data-testid="batch-tag-rename-confirm" color="primary" variant="tonal" :class="{ 'tag-rename-saving': state.saving.value }" :disabled="!state.canConfirm.value" :loading="state.saving.value" :aria-busy="state.saving.value" :aria-label="t(state.saving.value ? 'batchTagRename.saving' : 'batchTagRename.confirm')" v-on="{ click: state.confirm }">
          {{ t('batchTagRename.confirm') }}
          <template #loader><v-progress-circular indeterminate size="16" width="2" class="mr-2" aria-hidden="true" />{{ t('batchTagRename.saving') }}</template>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VProgressCircular } from 'vuetify/components/VProgressCircular'
import type { useBatchTagRename } from './useBatchTagRename'
const props = defineProps<{ state: ReturnType<typeof useBatchTagRename>; fallbackFocus?: globalThis.HTMLElement | null }>()
const { t } = useI18n()
const fromInput = ref<{ $el: globalThis.HTMLElement } | null>(null), reloadButton = ref<{ $el: globalThis.HTMLElement } | null>(null)
const locked = computed(() => props.state.saving.value || props.state.loading.value || !!props.state.recovery.value)
const invalid = computed(() => !!props.state.draft.value.fromTag && !!props.state.draft.value.toTag && !props.state.preview.value)
let opener: globalThis.HTMLElement | null = null
watch(() => props.state.targets.value, value => { if (value) opener = document.activeElement instanceof globalThis.HTMLElement ? document.activeElement : null }, { flush: 'sync', immediate: true })
/** Counts scalar values without truncating emoji at a UTF-16 boundary. */
function codePoints(value: string) { return Array.from(value).length }
/** Enter in a field never approves or writes; focus remains inside the current opening. */
function focusInput() {
  if (!props.state.targets.value || !props.state.canRestoreFocus() || props.state.saving.value) return
  if (props.state.recovery.value) reloadButton.value?.$el.focus()
  else fromInput.value?.$el.querySelector('input')?.focus()
}
/** Never moves focus on behalf of an obsolete login or a previous closing transition. */
function restoreFocus() {
  if (props.state.targets.value !== null || !props.state.canRestoreFocus()) return
  if (opener?.isConnected) opener.focus()
  if (document.activeElement !== opener && props.state.canRestoreFocus() && props.fallbackFocus?.isConnected) props.fallbackFocus.focus()
  opener = null
}
</script>
<style scoped>
.tag-rename-card, .tag-rename-body { min-width: 0; }
.tag-rename-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.tag-rename-feedback { flex: 0 0 auto; margin: 0 24px 14px; }
.tag-rename-body { display: grid; grid-auto-rows: max-content; gap: 14px; overflow-y: auto; overflow-wrap: anywhere; }
.tag-rename-body p { margin: 8px 0; }
.tag-rename-body ol { padding-inline-start: 24px; }
.tag-rename-chip { display: inline-block; max-width: 100%; padding: 2px 6px; margin: 2px; border: 1px solid currentColor; border-radius: 4px; vertical-align: top; }
.tag-rename-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px; }
/* The saving status stays readable while the native disabled state still blocks interaction. */
.tag-rename-saving, .tag-rename-saving:hover { opacity: 1; }
@media (max-width: 480px) { .tag-rename-actions > * { flex: 1 1 100%; margin: 0; white-space: normal; height: auto; min-height: 40px; } }
</style>
