<template>
  <section v-if="state.allowed" class="target-policy" aria-labelledby="target-policy-heading">
    <h2 id="target-policy-heading">{{ t('targetPolicy.heading') }}</h2>
    <p>{{ t('targetPolicy.hint') }}</p>
    <p>{{ t('targetPolicy.scope') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('targetPolicy.form')" @submit.prevent="save">
      <div v-for="(row, index) in state.rows" :key="row.key" class="target-policy__row">
        <v-text-field :model-value="row.host" :name="'target-host-' + row.key" :label="t('targetPolicy.host') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[String(index)] ? t('targetPolicy.invalidField') : ''" variant="outlined" @update:model-value="edit(index, $event)" />
        <v-btn type="button" variant="text" :aria-label="t('targetPolicy.remove') + ' ' + (index + 1)" :disabled="busy" @click="remove(index)">{{ t('targetPolicy.remove') }}</v-btn>
      </div>
      <v-alert v-if="state.feedback && state.feedback !== 'saved' && state.feedback !== 'saveFailed'" type="error" variant="tonal" aria-live="polite">{{ t('targetPolicy.' + state.feedback) }}</v-alert>
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('targetPolicy.' + state.feedback) }}</ActionToast>
      <div class="target-policy__actions">
        <v-btn type="button" variant="text" :disabled="busy || state.rows.length >= 100" @click="add">{{ t('targetPolicy.add') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="busy || !state.rows.length" @click="clear">{{ t('targetPolicy.clear') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('targetPolicy.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy || state.reloadRequired" :loading="state.saving">{{ t('targetPolicy.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useTargetHostDenylistDraft } from './useTargetHostDenylistDraft'
const { t } = useI18n()
const { state, edit, add, remove, clear, load, save } = useTargetHostDenylistDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.target-policy { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-policy h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-policy > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-policy form { display: grid; min-width: 0; gap: 12px; }
.target-policy__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; min-width: 0; gap: 8px; }
.target-policy__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 480px) { .target-policy__row { grid-template-columns: minmax(0, 1fr); } }
</style>
