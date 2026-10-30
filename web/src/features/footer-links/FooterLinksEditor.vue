<template>
  <section v-if="state.allowed" class="footer-links" aria-labelledby="footer-links-heading">
    <h2 id="footer-links-heading">{{ t('footerLinks.heading') }}</h2>
    <p>{{ t('footerLinks.hint') }}</p>
    <p>{{ t('footerLinks.urlHint') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('footerLinks.form')" @submit.prevent="save">
      <fieldset v-for="(row, index) in state.rows" :key="row.key" class="footer-links__row">
        <legend>{{ t('footerLinks.item') }} {{ index + 1 }}</legend>
        <v-text-field :model-value="row.label" :name="'footer-label-' + row.key" :label="t('footerLinks.label') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[index + ':label'] ? t(state.errors[index + ':label']!) : ''" variant="outlined" @update:model-value="edit(index, 'label', $event)" />
        <v-text-field :model-value="row.url" :name="'footer-url-' + row.key" :label="t('footerLinks.url') + ' ' + (index + 1)" :disabled="state.saving || !state.version" :error-messages="state.errors[index + ':url'] ? t(state.errors[index + ':url']!) : ''" variant="outlined" @update:model-value="edit(index, 'url', $event)" />
        <div class="footer-links__actions">
          <v-btn type="button" variant="text" :aria-label="t('footerLinks.up') + ' ' + (index + 1)" :disabled="busy || index === 0" @click="move(index, -1)">{{ t('footerLinks.up') }}</v-btn>
          <v-btn type="button" variant="text" :aria-label="t('footerLinks.down') + ' ' + (index + 1)" :disabled="busy || index === state.rows.length - 1" @click="move(index, 1)">{{ t('footerLinks.down') }}</v-btn>
          <v-btn type="button" variant="text" :aria-label="t('footerLinks.remove') + ' ' + (index + 1)" :disabled="busy" @click="remove(index)">{{ t('footerLinks.remove') }}</v-btn>
        </div>
      </fieldset>
      <v-alert v-if="state.feedback && state.feedback !== 'saved' && state.feedback !== 'saveFailed'" type="error" variant="tonal" aria-live="polite">{{ t('footerLinks.' + state.feedback) }}</v-alert>
      <ActionToast v-if="state.feedback === 'saved' || state.feedback === 'saveFailed'" :type="state.feedback === 'saved' ? 'success' : 'error'">{{ t('footerLinks.' + state.feedback) }}</ActionToast>
      <div class="footer-links__actions">
        <v-btn type="button" variant="text" :disabled="busy || state.rows.length >= 5" @click="add">{{ t('footerLinks.add') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('footerLinks.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="busy" :loading="state.saving">{{ t('footerLinks.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { useFooterLinksDraft } from './useFooterLinksDraft'
const { t } = useI18n()
const { state, edit, add, remove, move, load, save } = useFooterLinksDraft()
const busy = computed(() => state.loading || state.saving || !state.version)
</script>

<style scoped>
.footer-links { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.footer-links h2 { margin: 0 0 10px; font-size: 1.1rem; }
.footer-links > p { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.footer-links form { display: grid; min-width: 0; gap: 12px; }
.footer-links__row { display: grid; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--moeurl-outline); border-radius: 12px; }
.footer-links__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
</style>
