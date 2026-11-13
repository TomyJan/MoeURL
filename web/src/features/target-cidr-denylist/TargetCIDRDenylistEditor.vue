<template>
  <section v-if="state.allowed" class="target-cidr-policy" aria-labelledby="target-cidr-policy-heading">
    <h2 id="target-cidr-policy-heading">{{ t('targetCIDRPolicy.heading') }}</h2>
    <p>{{ t('targetCIDRPolicy.hint') }}</p>
    <p>{{ t('targetCIDRPolicy.scope') }}</p>
    <p>{{ t('targetCIDRPolicy.wideWarning') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('targetCIDRPolicy.form')" @submit.prevent="save">
      <div v-for="(row, index) in state.rows" :key="row.key" class="target-cidr-policy__row">
        <v-text-field :model-value="row.prefix" :name="'target-cidr-' + row.key" :label="t('targetCIDRPolicy.prefix') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[String(index)] ? t('targetCIDRPolicy.invalidField') : ''" variant="outlined" @update:model-value="edit(index, $event)" />
        <v-btn type="button" variant="text" :aria-label="t('targetCIDRPolicy.remove') + ' ' + (index + 1)" :disabled="busy" @click="remove(index)">{{ t('targetCIDRPolicy.remove') }}</v-btn>
      </div>
      <v-alert v-if="state.feedback && state.feedback !== 'saved' && state.feedback !== 'saveFailed'" type="error" variant="tonal" aria-live="polite">{{ t('targetCIDRPolicy.' + state.feedback) }}</v-alert>
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('targetCIDRPolicy.' + state.feedback) }}</ActionToast>
      <div class="target-cidr-policy__actions">
        <v-btn type="button" variant="text" :disabled="busy || state.rows.length >= 100" @click="add">{{ t('targetCIDRPolicy.add') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="busy || !state.rows.length" @click="clear">{{ t('targetCIDRPolicy.clear') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('targetCIDRPolicy.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy || state.reloadRequired" :loading="state.saving">{{ t('targetCIDRPolicy.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useTargetCIDRDenylistDraft } from './useTargetCIDRDenylistDraft'
const { t } = useI18n()
const { state, edit, add, remove, clear, load, save } = useTargetCIDRDenylistDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.target-cidr-policy { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-cidr-policy h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-cidr-policy > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-cidr-policy form { display: grid; min-width: 0; gap: 12px; }
.target-cidr-policy__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; min-width: 0; gap: 8px; }
.target-cidr-policy__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 480px) { .target-cidr-policy__row { grid-template-columns: minmax(0, 1fr); } }
</style>
