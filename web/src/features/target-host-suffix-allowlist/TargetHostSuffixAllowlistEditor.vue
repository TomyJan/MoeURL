<template>
  <section v-if="state.allowed" class="target-suffix-allowlist" aria-labelledby="target-suffix-allowlist-heading">
    <h2 id="target-suffix-allowlist-heading">{{ t('targetSuffixAllowlist.heading') }}</h2>
    <p>{{ t('targetSuffixAllowlist.hint') }}</p>
    <p>{{ t('targetSuffixAllowlist.scope') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('targetSuffixAllowlist.form')" @submit.prevent="save">
      <v-switch :model-value="state.enabled" :label="t('targetSuffixAllowlist.enabled')" :disabled="state.saving || !state.version" @update:model-value="setEnabled($event === true)" />
      <div v-for="(row, index) in state.rows" :key="row.key" class="target-suffix-allowlist__row">
        <v-text-field :model-value="row.suffix" :name="'allowed-target-suffix-' + row.key" :label="t('targetSuffixAllowlist.suffix') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[String(index)] ? t('targetSuffixAllowlist.invalidField') : ''" variant="outlined" @update:model-value="edit(index, $event)" />
        <v-btn type="button" variant="text" :aria-label="t('targetSuffixAllowlist.remove') + ' ' + (index + 1)" :disabled="busy" @click="remove(index)">{{ t('targetSuffixAllowlist.remove') }}</v-btn>
      </div>
      <v-alert v-if="state.feedback && state.feedback !== 'saved' && state.feedback !== 'saveFailed'" type="error" variant="tonal" aria-live="polite">{{ t('targetSuffixAllowlist.' + state.feedback) }}</v-alert>
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('targetSuffixAllowlist.' + state.feedback) }}</ActionToast>
      <div class="target-suffix-allowlist__actions">
        <v-btn type="button" variant="text" :disabled="busy || state.rows.length >= 100" @click="add">{{ t('targetSuffixAllowlist.add') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="busy || !state.rows.length" @click="clear">{{ t('targetSuffixAllowlist.clear') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('targetSuffixAllowlist.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy || state.reloadRequired" :loading="state.saving">{{ t('targetSuffixAllowlist.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useTargetHostSuffixAllowlistDraft } from './useTargetHostSuffixAllowlistDraft'
const { t } = useI18n()
const { state, edit, setEnabled, add, remove, clear, load, save } = useTargetHostSuffixAllowlistDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.target-suffix-allowlist { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-suffix-allowlist h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-suffix-allowlist > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-suffix-allowlist form { display: grid; min-width: 0; gap: 12px; }
.target-suffix-allowlist__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; min-width: 0; gap: 8px; }
.target-suffix-allowlist__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 480px) { .target-suffix-allowlist__row { grid-template-columns: minmax(0, 1fr); } }
</style>
