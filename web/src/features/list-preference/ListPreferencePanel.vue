<template>
  <section v-if="eligible" class="list-preference" data-testid="list-preference-panel">
    <h2>{{ t('listPreference.title') }}</h2>
    <p>{{ t('listPreference.description') }}</p>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-if="readError" type="error" variant="tonal">
      {{ t('listPreference.loadFailed') }}
      <v-btn :disabled="busy" variant="text" @click="reload(false)">{{ t('listPreference.retry') }}</v-btn>
    </v-alert>
    <v-alert v-if="conflict" type="warning" variant="tonal">
      {{ t('listPreference.conflict') }}
      <v-btn :disabled="busy" variant="text" @click="reload(true)">{{ t('listPreference.reload') }}</v-btn>
    </v-alert>
    <form data-testid="list-preference-form" @submit.prevent="submit">
      <v-select :model-value="draft" :items="items" :label="t('listPreference.pageSize')" :error-messages="invalid ? t('listPreference.invalid') : undefined" :disabled="!original" variant="outlined" @update:model-value="edit" />
      <v-btn type="submit" data-testid="list-preference-save" :disabled="locked" :loading="pending" color="primary">{{ t('listPreference.save') }}</v-btn>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SHORT_LINK_PAGE_SIZES } from '@/features/short-link-pagination/pageSize'
import { useListPreferenceEditor } from './useListPreferenceEditor'
const props = defineProps<{ userId: string; active: boolean }>()
const { t } = useI18n()
const { eligible, query, original, draft, pending, busy, locked, readError, conflict, invalid, edit, reload, submit } = useListPreferenceEditor(props, t)
const items = computed(() => [{ title: t('listPreference.followDefault'), value: '' }, ...SHORT_LINK_PAGE_SIZES.map(size => ({ title: String(size), value: String(size) }))])
</script>
<style scoped>
.list-preference { display: grid; min-width: 0; align-content: start; gap: 14px; padding: 22px; border: 1px solid var(--moeurl-outline); border-radius: var(--moeurl-radius-panel); background: var(--moeurl-surface-elevated); box-shadow: var(--moeurl-shadow); }
.list-preference h2 { margin: 0; font-size: 1.18rem; }
.list-preference p { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.7; overflow-wrap: anywhere; }
.list-preference form { display: grid; min-width: 0; gap: 12px; justify-items: start; }
.list-preference form > :first-child { width: 100%; }
@media (max-width: 620px) { .list-preference { padding: 18px; } }
</style>
