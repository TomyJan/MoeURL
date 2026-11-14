<template>
  <section v-if="state.allowed" class="target-policy-batch-check" aria-labelledby="target-policy-batch-check-heading">
    <h2 id="target-policy-batch-check-heading">{{ t('targetPolicyBatchCheck.heading') }}</h2>
    <p>{{ t('targetPolicyBatchCheck.hint') }}</p>
    <p>{{ t('targetPolicyBatchCheck.scope') }}</p>
    <form :aria-label="t('targetPolicyBatchCheck.form')" @submit.prevent="check">
      <v-textarea :model-value="state.targets" :label="t('targetPolicyBatchCheck.targets')" autocomplete="off" autocapitalize="off" spellcheck="false" rows="5" auto-grow variant="outlined" @update:model-value="edit" />
      <v-alert v-if="state.feedback" type="error" variant="tonal" aria-live="polite">{{ t('targetPolicyBatchCheck.' + state.feedback) }}</v-alert>
      <ul v-if="state.items.length" :aria-label="t('targetPolicyBatchCheck.results')" class="target-policy-batch-check__results" aria-live="polite">
        <li v-for="item in state.items" :key="item.index">
          <span>{{ t('targetPolicyBatchCheck.row', { index: item.index }) }}</span>
          <span>{{ t('targetPolicyBatchCheck.' + item.outcome) }}</span>
        </li>
      </ul>
      <div class="target-policy-batch-check__actions">
        <v-btn type="submit" color="primary" :disabled="state.loading" :loading="state.loading">{{ t('targetPolicyBatchCheck.check') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTargetPolicyBatchCheck } from './useTargetPolicyBatchCheck'
const { t } = useI18n()
const { state, edit, check } = useTargetPolicyBatchCheck()
</script>

<style scoped>
.target-policy-batch-check { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-policy-batch-check h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-policy-batch-check > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-policy-batch-check form { display: grid; min-width: 0; gap: 12px; }
.target-policy-batch-check__results { margin: 0; padding-inline-start: 24px; }
.target-policy-batch-check__results li { padding-block: 6px; overflow-wrap: anywhere; }
.target-policy-batch-check__results li > span:first-child { margin-inline-end: 12px; font-weight: 600; }
.target-policy-batch-check__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; }
</style>
