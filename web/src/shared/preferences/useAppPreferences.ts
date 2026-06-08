import { ref } from 'vue'
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

  function setLanguage(value: LanguagePreference) {
    language.value = value
    locale.value = value
    saveLanguagePreference(value)
  }

  function setTheme(value: ThemePreference) {
    themeMode.value = value
    theme.global.name.value = resolveVuetifyTheme(value)
    saveThemePreference(value)
  }

  return {
    language,
    setLanguage,
    setTheme,
    themeMode,
  }
}
