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

export function loadPreferences(): UserPreferences {
  const storage = globalThis.window?.localStorage
  const storedLanguage = storage?.getItem(languageStorageKey)
  const storedTheme = storage?.getItem(themeStorageKey)
  return {
    language: languageOptions.includes(storedLanguage as LanguagePreference) ? (storedLanguage as LanguagePreference) : 'zh-CN',
    theme: themeOptions.includes(storedTheme as ThemePreference) ? (storedTheme as ThemePreference) : 'system',
  }
}

export function saveLanguagePreference(language: LanguagePreference): void {
  globalThis.window?.localStorage?.setItem(languageStorageKey, language)
}

export function saveThemePreference(theme: ThemePreference): void {
  globalThis.window?.localStorage?.setItem(themeStorageKey, theme)
}

export function resolveVuetifyTheme(theme: ThemePreference): 'moeurlLight' | 'moeurlDark' {
  if (theme === 'light') {
    return 'moeurlLight'
  }
  if (theme === 'dark') {
    return 'moeurlDark'
  }
  return globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'moeurlDark' : 'moeurlLight'
}
