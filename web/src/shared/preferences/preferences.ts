export type LanguagePreference = 'zh-CN' | 'en'
export type ThemePreference = 'system' | 'light' | 'dark'

export interface UserPreferences {
  language: LanguagePreference
  theme: ThemePreference
}

export const languageOptions: LanguagePreference[] = ['zh-CN', 'en']
export const themeOptions: ThemePreference[] = ['system', 'light', 'dark']

const languageStorageKey = 'moeurl.language'
const themeStorageKey = 'moeurl.theme'

/** Loads validated UI preferences, falling back to product defaults. */
export function loadPreferences(): UserPreferences {
  const storage = globalThis.window?.localStorage
  const storedLanguage = storage?.getItem(languageStorageKey)
  const storedTheme = storage?.getItem(themeStorageKey)
  return {
    language: languageOptions.includes(storedLanguage as LanguagePreference) ? (storedLanguage as LanguagePreference) : 'zh-CN',
    theme: themeOptions.includes(storedTheme as ThemePreference) ? (storedTheme as ThemePreference) : 'system',
  }
}

/** Persists the selected interface language for future sessions. */
export function saveLanguagePreference(language: LanguagePreference): void {
  globalThis.window?.localStorage?.setItem(languageStorageKey, language)
}

/** Persists the selected theme mode for future sessions. */
export function saveThemePreference(theme: ThemePreference): void {
  globalThis.window?.localStorage?.setItem(themeStorageKey, theme)
}

/** Maps a preference to a concrete Vuetify theme, including system mode. */
export function resolveVuetifyTheme(theme: ThemePreference): 'moeurlLight' | 'moeurlDark' {
  if (theme === 'light') {
    return 'moeurlLight'
  }
  if (theme === 'dark') {
    return 'moeurlDark'
  }
  return globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'moeurlDark' : 'moeurlLight'
}
