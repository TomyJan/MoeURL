<template>
  <div class="preference-switcher" role="group" aria-label="app preferences">
    <button class="preference-switcher__button" type="button" aria-label="切换语言" @click="toggleLanguage">
      {{ languageLabel }}
    </button>
    <button class="preference-switcher__button" type="button" aria-label="切换主题" @click="toggleTheme">
      {{ themeLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useAppPreferences } from './useAppPreferences'

const { language, themeMode, toggleLanguage, toggleTheme } = useAppPreferences()

const languageLabel = computed(() => (language.value === 'zh-CN' ? 'CN' : 'EN'))
const themeLabel = computed(() => {
  if (themeMode.value === 'system') return 'Auto'
  if (themeMode.value === 'dark') return 'Dark'
  return 'Light'
})
</script>

<style scoped>
.preference-switcher {
  display: inline-flex;
  gap: 6px;
  padding: 5px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 76%, transparent);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-glass) 68%, transparent);
  backdrop-filter: blur(18px);
}

.preference-switcher__button {
  min-width: 44px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 76%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 850;
}

.preference-switcher__button:hover {
  color: rgb(var(--v-theme-primary));
}
</style>
