<template>
  <v-app>
    <div class="app-preferences" aria-label="app preferences">
      <v-select
        v-model="language"
        class="toolbar-select"
        density="compact"
        hide-details
        :items="languageItems"
        variant="outlined"
      />
      <v-select v-model="themeMode" class="toolbar-select" density="compact" hide-details :items="themeItems" variant="outlined" />
    </div>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify/framework'

import {
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
} from '@/shared/preferences/preferences'
import type { LanguagePreference, ThemePreference } from '@/shared/preferences/preferences'

const { locale } = useI18n()
const theme = useTheme()
const preferences = loadPreferences()
const language = ref<LanguagePreference>(preferences.language)
const themeMode = ref<ThemePreference>(preferences.theme)

const languageItems = [
  { title: '简体中文', value: 'zh-CN' },
  { title: 'English', value: 'en' },
]
const themeItems = [
  { title: '跟随系统', value: 'system' },
  { title: '浅色', value: 'light' },
  { title: '深色', value: 'dark' },
]

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
</script>

<style scoped>
.app-preferences {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 10;
  display: flex;
  gap: 8px;
}

.toolbar-select {
  max-width: 128px;
}
</style>
