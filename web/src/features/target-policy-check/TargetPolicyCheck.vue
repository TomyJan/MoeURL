<template>
  <section v-if="state.allowed" class="target-policy-check" aria-labelledby="target-policy-check-heading">
    <h2 id="target-policy-check-heading">{{ t('targetPolicyCheck.heading') }}</h2>
    <p>{{ t('targetPolicyCheck.hint') }}</p>
    <p>{{ t('targetPolicyCheck.scope') }}</p>
    <form :aria-label="t('targetPolicyCheck.form')" @submit.prevent="check">
      <v-textarea :model-value="state.targetUrl" :label="t('targetPolicyCheck.target')" autocomplete="off" autocapitalize="off" spellcheck="false" rows="3" variant="outlined" @update:model-value="edit" />
      <v-alert v-if="state.feedback" type="error" variant="tonal" aria-live="polite">{{ t('targetPolicyCheck.' + state.feedback) }}</v-alert>
      <v-alert v-if="state.outcome" :type="state.outcome === 'allowed' ? 'success' : 'warning'" variant="tonal" aria-live="polite">{{ t('targetPolicyCheck.' + state.outcome) }}</v-alert>
      <div class="target-policy-check__actions">
        <v-btn type="submit" color="primary" :disabled="state.loading" :loading="state.loading">{{ t('targetPolicyCheck.check') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTargetPolicyCheck } from './useTargetPolicyCheck'
const { t } = useI18n()
const { state, edit, check } = useTargetPolicyCheck()
</script>

<style scoped>
.target-policy-check { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-policy-check h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-policy-check > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-policy-check form { display: grid; min-width: 0; gap: 12px; }
.target-policy-check__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; }
</style>
