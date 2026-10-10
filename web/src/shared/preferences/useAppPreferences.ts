import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify'

import {
  browserLanguagePreference,
  hasStoredLanguagePreference,
  hasStoredThemePreference,
  languageOptions,
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
  themeOptions,
} from './preferences'
import type { LanguagePreference, ThemePreference } from './preferences'

const language = ref<LanguagePreference>('zh-CN')
const themeMode = ref<ThemePreference>('system')
let preferencesLoaded = false
let systemThemeListenerInstalled = false
let activeThemeName: { value: string } | undefined

/** Provides the shared language and theme state synchronized with vue-i18n and Vuetify. */
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

  /** Updates and persists the active interface language. */
  function setLanguage(value: LanguagePreference) {
    language.value = value
    locale.value = value
    saveLanguagePreference(value)
  }

  /** Updates and persists the active interface theme mode. */
  function setTheme(value: ThemePreference) {
    themeMode.value = value
    theme.global.name.value = resolveVuetifyTheme(value)
    saveThemePreference(value)
  }

  /** Applies server defaults only when the user has not chosen a local preference. */
  function applyServerDefaults(languageDefault: LanguagePreference, themeDefault: ThemePreference) {
    if (!hasStoredLanguagePreference() && !browserLanguagePreference() && languageOptions.includes(languageDefault) && language.value !== languageDefault) {
      language.value = languageDefault
      locale.value = languageDefault
    }
    if (!hasStoredThemePreference() && themeOptions.includes(themeDefault) && themeMode.value !== themeDefault) {
      themeMode.value = themeDefault
      theme.global.name.value = resolveVuetifyTheme(themeDefault)
    }
  }

  return {
    language,
    setLanguage,
    setTheme,
    applyServerDefaults,
    themeMode,
  }
}

/** Keeps system theme mode synchronized with operating-system preference changes. */
function installSystemThemeListener() {
  if (systemThemeListenerInstalled) {
    return
  }
  const mediaQuery = globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mediaQuery?.addEventListener) {
    return
  }
  systemThemeListenerInstalled = true
  mediaQuery.addEventListener('change', () => {
    if (themeMode.value !== 'system') {
      return
    }
    activeThemeName!.value = resolveVuetifyTheme('system')
  })
}
