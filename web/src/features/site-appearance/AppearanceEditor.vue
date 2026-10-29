<template>
  <section v-if="state.allowed" class="appearance" data-testid="appearance-editor" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">{{ t('appearance.heading') }}</h2>
    <p>{{ t('appearance.hint') }}</p>
    <v-progress-linear v-if="state.loading" indeterminate />
    <form :aria-label="t('appearance.heading')" @submit.prevent="save">
      <v-select :model-value="state.accentPreset" name="site-accent" :label="t('appearance.preset')" :items="items" :disabled="state.saving || !state.version" variant="outlined" @update:model-value="edit($event)" />
      <div class="appearance__swatches" aria-hidden="true"><span v-for="(preset, name) in accentPresets" :key="name" :style="{ backgroundColor: preset.light.primary }" /></div>
      <v-alert v-if="state.feedback" :type="state.feedback === 'saved' ? 'success' : 'error'" variant="tonal" aria-live="polite">{{ t('appearance.' + state.feedback) }}</v-alert>
      <div class="appearance__actions">
        <v-btn type="button" variant="text" :disabled="state.loading || state.saving" @click="load">{{ t('appearance.reload') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="!state.version || state.loading || state.saving" :loading="state.saving">{{ t('appearance.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { accentPresets } from '@/app/accent-presets'
import { useAppearanceDraft } from './useAppearanceDraft'
const { t } = useI18n()
const { state, edit, load, save } = useAppearanceDraft()
const items = computed(() => (['iris', 'ocean', 'forest'] as const).map(value => ({ value, title: t('appearance.' + value) })))
</script>

<style scoped>
.appearance { min-width: 0; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.appearance h2 { margin: 0 0 10px; font-size: 1.1rem; }
.appearance > p { margin: 0 0 18px; color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.appearance form { display: grid; min-width: 0; gap: 8px; }
.appearance__swatches { display: flex; gap: 8px; margin-bottom: 8px; }
.appearance__swatches span { width: 16px; height: 16px; border-radius: 50%; }
.appearance__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
</style>
