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
  return {
    language: parseLanguage(storage?.getItem(languageStorageKey) ?? null),
    theme: parseTheme(storage?.getItem(themeStorageKey) ?? null),
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

function parseLanguage(value: string | null): LanguagePreference {
  switch (value) {
    case 'en':
    case 'zh-CN':
      return value
    default:
      return 'zh-CN'
  }
}

function parseTheme(value: string | null): ThemePreference {
  switch (value) {
    case 'light':
    case 'dark':
    case 'system':
      return value
    default:
      return 'system'
  }
}
