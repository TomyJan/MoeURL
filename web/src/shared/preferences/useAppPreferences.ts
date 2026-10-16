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
let activeLocale: { value: string } | undefined
let baselineLanguage: LanguagePreference = 'zh-CN'
let baselineTheme: ThemePreference = 'system'
let accountLanguage: LanguagePreference | null = null
let accountTheme: ThemePreference | null = null
let manualLanguage = false
let manualTheme = false

/** Removes identity-scoped overrides immediately when a session is replaced or revoked. */
export function resetAccountPreferences() {
  accountLanguage = null
  accountTheme = null
  manualLanguage = false
  manualTheme = false
  renderPreferences()
}

/** Resolves each field independently without persisting account values into browser storage. */
function renderPreferences() {
  language.value = manualLanguage ? baselineLanguage : accountLanguage ?? baselineLanguage
  themeMode.value = manualTheme ? baselineTheme : accountTheme ?? baselineTheme
  if (activeLocale) activeLocale.value = language.value
  if (activeThemeName) activeThemeName.value = resolveVuetifyTheme(themeMode.value)
}

/** Provides the shared language and theme state synchronized with vue-i18n and Vuetify. */
export function useAppPreferences() {
  const { locale } = useI18n()
  const theme = useTheme()
  activeThemeName = theme.global.name
  activeLocale = locale

  if (!preferencesLoaded) {
    preferencesLoaded = true
    const preferences = loadPreferences()
    baselineLanguage = preferences.language
    baselineTheme = preferences.theme
  }

  renderPreferences()
  installSystemThemeListener()

  /** Updates and persists the active interface language. */
  function setLanguage(value: LanguagePreference) {
    baselineLanguage = value
    manualLanguage = true
    saveLanguagePreference(value)
    renderPreferences()
  }

  /** Updates and persists the active interface theme mode. */
  function setTheme(value: ThemePreference) {
    baselineTheme = value
    manualTheme = true
    saveThemePreference(value)
    renderPreferences()
  }

  /** Applies server defaults only when the user has not chosen a local preference. */
  function applyServerDefaults(languageDefault: LanguagePreference, themeDefault: ThemePreference) {
    if (!manualLanguage && !hasStoredLanguagePreference() && !browserLanguagePreference() && languageOptions.includes(languageDefault)) {
      baselineLanguage = languageDefault
    }
    if (!manualTheme && !hasStoredThemePreference() && themeOptions.includes(themeDefault)) {
      baselineTheme = themeDefault
    }
    renderPreferences()
  }

  /** Applies a saved account override; automatic hydration preserves newer local choices per field. */
  function applyAccountPreferences(value: { language: LanguagePreference | null; theme: ThemePreference | null }, automatic = false) {
    accountLanguage = value.language
    accountTheme = value.theme
    if (!automatic) {
      manualLanguage = false
      manualTheme = false
    }
    renderPreferences()
  }

  return {
    language,
    setLanguage,
    setTheme,
    applyServerDefaults,
    applyAccountPreferences,
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
