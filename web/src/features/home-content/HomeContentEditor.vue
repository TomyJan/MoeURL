<template>
  <section v-if="state.allowed" class="home-content" data-testid="home-content-editor" aria-labelledby="home-content-heading">
    <h2 id="home-content-heading">{{ t('homeContent.heading') }}</h2>
    <p>{{ t('homeContent.hint') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('homeContent.heading')" @submit.prevent="save">
      <v-text-field :model-value="state.title" name="home-title" :label="t('homeContent.title')" :disabled="state.saving || !state.version" variant="outlined" @update:model-value="edit('title', $event)" />
      <p class="home-content__count">{{ [...state.title].length }} / 80</p>
      <v-text-field :model-value="state.summary" name="home-summary" :label="t('homeContent.summary')" :disabled="state.saving || !state.version" variant="outlined" @update:model-value="edit('summary', $event)" />
      <p class="home-content__count">{{ [...state.summary].length }} / 200</p>
      <v-alert v-if="state.feedback" :type="state.feedback === 'saved' ? 'success' : 'error'" variant="tonal" aria-live="polite">{{ t(`homeContent.${state.feedback}`) }}</v-alert>
      <div class="home-content__actions">
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('homeContent.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="!state.version || state.loading || state.saving" :loading="state.saving">{{ t('homeContent.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useHomeContentDraft } from './useHomeContentDraft'
const { t } = useI18n()
const { state, edit, load, save } = useHomeContentDraft()
</script>

<style scoped>
.home-content { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.home-content h2 { margin: 0 0 10px; font-size: 1.1rem; }
.home-content > p { margin: 0 0 18px; color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.home-content form { display: grid; min-width: 0; gap: 8px; }
.home-content__count { margin: -6px 0 12px; color: rgb(var(--v-theme-on-surface-variant)); font-size: .8rem; text-align: end; }
.home-content__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
</style>
