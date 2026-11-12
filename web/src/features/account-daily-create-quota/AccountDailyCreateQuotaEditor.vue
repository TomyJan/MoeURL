<template>
  <section v-if="state.allowed" class="daily-quota" aria-labelledby="daily-quota-heading">
    <h2 id="daily-quota-heading">{{ t('dailyCreateQuota.heading') }}</h2>
    <p>{{ t('dailyCreateQuota.hint') }}</p>
    <p>{{ t('dailyCreateQuota.scope') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('dailyCreateQuota.form')" @submit.prevent="save">
      <v-switch :model-value="state.enabled" :label="t('dailyCreateQuota.enabled')" :disabled="state.saving || !state.version" @update:model-value="setEnabled($event === true)" />
      <v-text-field :model-value="state.limit" :label="t('dailyCreateQuota.limit')" name="account-daily-create-limit" type="text" inputmode="numeric" :disabled="state.saving || !state.version || !state.enabled" :error-messages="state.invalid ? t('dailyCreateQuota.invalidField') : ''" variant="outlined" @update:model-value="edit" />
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('dailyCreateQuota.' + state.feedback) }}</ActionToast>
      <v-alert v-else-if="state.feedback" type="error" variant="tonal" aria-live="polite">{{ t('dailyCreateQuota.' + state.feedback) }}</v-alert>
      <div class="daily-quota__actions">
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('dailyCreateQuota.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy || state.reloadRequired" :loading="state.saving">{{ t('dailyCreateQuota.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useAccountDailyCreateQuotaDraft } from './useAccountDailyCreateQuotaDraft'
const { t } = useI18n()
const { state, edit, setEnabled, load, save } = useAccountDailyCreateQuotaDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.daily-quota { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.daily-quota h2 { margin: 0 0 10px; font-size: 1.1rem; }
.daily-quota > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.daily-quota form { display: grid; min-width: 0; gap: 12px; }
.daily-quota__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
</style>
