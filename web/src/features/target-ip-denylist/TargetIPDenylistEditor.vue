<template>
  <section v-if="state.allowed" class="target-ip-policy" aria-labelledby="target-ip-policy-heading">
    <h2 id="target-ip-policy-heading">{{ t('targetIPPolicy.heading') }}</h2>
    <p>{{ t('targetIPPolicy.hint') }}</p>
    <p>{{ t('targetIPPolicy.scope') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('targetIPPolicy.form')" @submit.prevent="save">
      <div v-for="(row, index) in state.rows" :key="row.key" class="target-ip-policy__row">
        <v-text-field :model-value="row.address" :name="'target-ip-' + row.key" :label="t('targetIPPolicy.address') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[String(index)] ? t('targetIPPolicy.invalidField') : ''" variant="outlined" @update:model-value="edit(index, $event)" />
        <v-btn type="button" variant="text" :aria-label="t('targetIPPolicy.remove') + ' ' + (index + 1)" :disabled="busy" @click="remove(index)">{{ t('targetIPPolicy.remove') }}</v-btn>
      </div>
      <v-alert v-if="state.feedback && state.feedback !== 'saved' && state.feedback !== 'saveFailed'" type="error" variant="tonal" aria-live="polite">{{ t('targetIPPolicy.' + state.feedback) }}</v-alert>
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('targetIPPolicy.' + state.feedback) }}</ActionToast>
      <div class="target-ip-policy__actions">
        <v-btn type="button" variant="text" :disabled="busy || state.rows.length >= 100" @click="add">{{ t('targetIPPolicy.add') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="busy || !state.rows.length" @click="clear">{{ t('targetIPPolicy.clear') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('targetIPPolicy.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy || state.reloadRequired" :loading="state.saving">{{ t('targetIPPolicy.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useTargetIPDenylistDraft } from './useTargetIPDenylistDraft'
const { t } = useI18n()
const { state, edit, add, remove, clear, load, save } = useTargetIPDenylistDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.target-ip-policy { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-ip-policy h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-ip-policy > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-ip-policy form { display: grid; min-width: 0; gap: 12px; }
.target-ip-policy__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; min-width: 0; gap: 8px; }
.target-ip-policy__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 480px) { .target-ip-policy__row { grid-template-columns: minmax(0, 1fr); } }
</style>
