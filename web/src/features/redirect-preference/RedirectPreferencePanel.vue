<template>
  <section v-if="eligible" class="redirect-preference" data-testid="redirect-preference-panel">
    <h2>{{ t('redirectPreference.title') }}</h2>
    <p>{{ t('redirectPreference.description') }}</p>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-if="unavailable" type="warning" variant="tonal">{{ t('redirectPreference.unavailable') }}</v-alert>
    <v-alert v-if="readError" type="error" variant="tonal">
      {{ t('redirectPreference.loadFailed') }}
      <v-btn :disabled="busy" variant="text" @click="reload(false)">{{ t('redirectPreference.retry') }}</v-btn>
    </v-alert>
    <v-alert v-if="conflict" type="warning" variant="tonal">
      {{ t('redirectPreference.conflict') }}
      <v-btn :disabled="busy" variant="text" @click="reload(true)">{{ t('redirectPreference.reload') }}</v-btn>
    </v-alert>
    <form data-testid="redirect-preference-form" @submit.prevent="submit">
      <v-select :model-value="draft" :items="items" :label="t('redirectPreference.mode')" :error-messages="invalid ? t('redirectPreference.invalid') : undefined" :disabled="!original" variant="outlined" @update:model-value="edit" />
      <v-btn type="submit" data-testid="redirect-preference-save" :disabled="locked" :loading="pending" color="primary">{{ t('redirectPreference.save') }}</v-btn>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { redirectModes } from '@/entities/redirect-preference/api'
import { useRedirectPreferenceEditor } from './useRedirectPreferenceEditor'
const props = defineProps<{ userId: string; active: boolean; permissions: readonly string[] }>()
const { t } = useI18n()
const { eligible, query, original, draft, pending, busy, locked, readError, conflict, invalid, unavailable, allowed, edit, reload, submit } = useRedirectPreferenceEditor(props, t)
const items = computed(() => [{ title: t('redirectPreference.followDomain'), value: '' }, ...redirectModes.map(value => ({ title: t('redirectPreference.modes.' + value), value, props: { disabled: !allowed(value) } }))])
</script>
<style scoped>
.redirect-preference { display: grid; min-width: 0; align-content: start; gap: 14px; padding: 22px; border: 1px solid var(--moeurl-outline); border-radius: var(--moeurl-radius-panel); background: var(--moeurl-surface-elevated); box-shadow: var(--moeurl-shadow); }
.redirect-preference h2 { margin: 0; font-size: 1.18rem; }
.redirect-preference p { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.7; overflow-wrap: anywhere; }
.redirect-preference form { display: grid; min-width: 0; gap: 12px; justify-items: start; }
.redirect-preference form > :first-child { width: 100%; }
@media (max-width: 620px) { .redirect-preference { padding: 18px; } }
</style>
