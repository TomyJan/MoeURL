<template>
  <v-app>
    <div
      v-if="!isConsoleRoute"
      class="app-preferences app-preferences--compact"
      :class="{ 'app-preferences--console': isConsoleRoute }"
      aria-label="app preferences"
    >
      <button class="app-preferences__button" type="button" aria-label="切换语言" @click="toggleLanguage">
        {{ languageLabel }}
      </button>
      <button class="app-preferences__button" type="button" aria-label="切换主题" @click="toggleTheme">
        {{ themeLabel }}
      </button>
    </div>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useTheme } from 'vuetify/framework'

import {
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
} from '@/shared/preferences/preferences'
import type { LanguagePreference, ThemePreference } from '@/shared/preferences/preferences'

const { locale } = useI18n()
const route = useRoute()
const theme = useTheme()
const preferences = loadPreferences()
const language = ref<LanguagePreference>(preferences.language)
const themeMode = ref<ThemePreference>(preferences.theme)
const isConsoleRoute = computed(() => route.path === '/link' || route.path.startsWith('/admin'))

const languageLabel = computed(() => (language.value === 'zh-CN' ? 'CN' : 'EN'))
const themeLabel = computed(() => {
  if (themeMode.value === 'system') return 'Auto'
  if (themeMode.value === 'dark') return 'Dark'
  return 'Light'
})

locale.value = language.value
theme.global.name.value = resolveVuetifyTheme(themeMode.value)

watch(language, (value) => {
  locale.value = value
  saveLanguagePreference(value)
})

watch(themeMode, (value) => {
  theme.global.name.value = resolveVuetifyTheme(value)
  saveThemePreference(value)
})

function toggleLanguage() {
  language.value = language.value === 'zh-CN' ? 'en' : 'zh-CN'
}

function toggleTheme() {
  const nextTheme: Record<ThemePreference, ThemePreference> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  }
  themeMode.value = nextTheme[themeMode.value]
}
</script>

<style scoped>
.app-preferences {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 10;
  display: flex;
  gap: 6px;
  max-width: min(184px, calc(100vw - 36px));
  padding: 4px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-glass) 76%, transparent);
  box-shadow: 0 14px 38px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  opacity: 0.34;
  transform: scale(0.8);
  transform-origin: bottom left;
  transition: opacity 160ms ease, transform 160ms ease;
  backdrop-filter: blur(18px);
}

.app-preferences__button {
  min-width: 52px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 72%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
}

.app-preferences:hover,
.app-preferences:focus-within {
  opacity: 1;
  transform: scale(1);
}

.app-preferences--console {
  right: 18px;
  bottom: 18px;
  left: auto;
  z-index: 4;
  opacity: 0.28;
  transform-origin: bottom right;
}

@media (max-width: 700px) {
  .app-preferences {
    left: 12px;
    bottom: 12px;
    transform: scale(0.76);
  }

  .app-preferences--console {
    right: 12px;
    left: auto;
    max-width: 196px;
    opacity: 0.22;
    transform: scale(0.72);
  }
}
</style>
