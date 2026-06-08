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
let systemThemeListenerInstalled = false
let activeThemeName: { value: string } | undefined

export function useAppPreferences() {
  const { locale } = useI18n()
  const theme = useTheme()
  activeThemeName = theme.global.name

  if (!preferencesLoaded) {
    preferencesLoaded = true
    const preferences = loadPreferences()
    language.value = preferences.language
    themeMode.value = preferences.theme
  }

  locale.value = language.value
  theme.global.name.value = resolveVuetifyTheme(themeMode.value)
  installSystemThemeListener()

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

function installSystemThemeListener() {
  if (systemThemeListenerInstalled) {
    return
  }
  const mediaQuery = globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mediaQuery?.addEventListener) {
    return
  }
  systemThemeListenerInstalled = true
  mediaQuery.addEventListener('change', (event) => {
    if (themeMode.value !== 'system') {
      return
    }
    activeThemeName!.value = event.matches ? 'moeurlDark' : 'moeurlLight'
  })
}
