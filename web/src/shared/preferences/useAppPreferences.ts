import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify/framework'

import {
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
} from './preferences'
import type { LanguagePreference, ThemePreference } from './preferences'

const language = ref<LanguagePreference>('zh-CN')
const themeMode = ref<ThemePreference>('system')
let preferencesLoaded = false
let watchersInstalled = false

export function useAppPreferences() {
  const { locale } = useI18n()
  const theme = useTheme()

  if (!preferencesLoaded) {
    preferencesLoaded = true
    const preferences = loadPreferences()
    language.value = preferences.language
    themeMode.value = preferences.theme
  }

  locale.value = language.value
  theme.global.name.value = resolveVuetifyTheme(themeMode.value)

  if (!watchersInstalled) {
    watchersInstalled = true
    watch(language, (value) => {
      locale.value = value
      saveLanguagePreference(value)
    })
    watch(themeMode, (value) => {
      theme.global.name.value = resolveVuetifyTheme(value)
      saveThemePreference(value)
    })
  }

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

  return {
    language,
    themeMode,
    toggleLanguage,
    toggleTheme,
  }
}
