<template>
  <section v-if="state.allowed" class="target-cidr-allowlist" aria-labelledby="target-cidr-allowlist-heading">
    <h2 id="target-cidr-allowlist-heading">{{ t('targetCIDRAllowlist.heading') }}</h2>
    <p>{{ t('targetCIDRAllowlist.hint') }}</p>
    <p>{{ t('targetCIDRAllowlist.scope') }}</p>
    <p>{{ t('targetCIDRAllowlist.wideWarning') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('targetCIDRAllowlist.form')" @submit.prevent="save">
      <v-switch :model-value="state.enabled" :label="t('targetCIDRAllowlist.enabled')" :disabled="state.saving || !state.version" @update:model-value="setEnabled($event === true)" />
      <div v-for="(row, index) in state.rows" :key="row.key" class="target-cidr-allowlist__row">
        <v-text-field :model-value="row.prefix" :name="'allowed-target-prefix-' + row.key" :label="t('targetCIDRAllowlist.prefix') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[String(index)] ? t('targetCIDRAllowlist.invalidField') : ''" variant="outlined" @update:model-value="edit(index, $event)" />
        <v-btn type="button" variant="text" :aria-label="t('targetCIDRAllowlist.remove') + ' ' + (index + 1)" :disabled="busy" @click="remove(index)">{{ t('targetCIDRAllowlist.remove') }}</v-btn>
      </div>
      <v-alert v-if="state.feedback && state.feedback !== 'saved' && state.feedback !== 'saveFailed'" type="error" variant="tonal" aria-live="polite">{{ t('targetCIDRAllowlist.' + state.feedback) }}</v-alert>
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('targetCIDRAllowlist.' + state.feedback) }}</ActionToast>
      <div class="target-cidr-allowlist__actions">
        <v-btn type="button" variant="text" :disabled="busy || state.rows.length >= 100" @click="add">{{ t('targetCIDRAllowlist.add') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="busy || !state.rows.length" @click="clear">{{ t('targetCIDRAllowlist.clear') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('targetCIDRAllowlist.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy || state.reloadRequired" :loading="state.saving">{{ t('targetCIDRAllowlist.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useTargetCIDRAllowlistDraft } from './useTargetCIDRAllowlistDraft'
const { t } = useI18n()
const { state, edit, setEnabled, add, remove, clear, load, save } = useTargetCIDRAllowlistDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.target-cidr-allowlist { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.target-cidr-allowlist h2 { margin: 0 0 10px; font-size: 1.1rem; }
.target-cidr-allowlist > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.target-cidr-allowlist form { display: grid; min-width: 0; gap: 12px; }
.target-cidr-allowlist__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; min-width: 0; gap: 8px; }
.target-cidr-allowlist__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
@media (max-width: 480px) { .target-cidr-allowlist__row { grid-template-columns: minmax(0, 1fr); } }
</style>
