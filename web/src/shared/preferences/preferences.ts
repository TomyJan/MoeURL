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
  return {
    language: parseLanguage(window.localStorage.getItem(languageStorageKey)),
    theme: parseTheme(window.localStorage.getItem(themeStorageKey)),
  }
}

export function saveLanguagePreference(language: LanguagePreference): void {
  window.localStorage.setItem(languageStorageKey, language)
}

export function saveThemePreference(theme: ThemePreference): void {
  window.localStorage.setItem(themeStorageKey, theme)
}

export function resolveVuetifyTheme(theme: ThemePreference): 'moeurlLight' | 'moeurlDark' {
  if (theme === 'light') {
    return 'moeurlLight'
  }
  if (theme === 'dark') {
    return 'moeurlDark'
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'moeurlDark' : 'moeurlLight'
}

function parseLanguage(value: string | null): LanguagePreference {
  return value === 'en' || value === 'zh-CN' ? value : 'zh-CN'
}

function parseTheme(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}
