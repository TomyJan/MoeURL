import type { AccentPreset } from '@/entities/appearance/api'

export const accentPresets = {
  iris: {
    light: { primary: '#5c4dde', onPrimary: '#ffffff', glow: 'rgba(92, 77, 222, 0.09)', ring: 'rgba(92, 77, 222, 0.38)' },
    dark: { primary: '#b9adff', onPrimary: '#272047', glow: 'rgba(185, 173, 255, 0.07)', ring: 'rgba(185, 173, 255, 0.44)' },
  },
  ocean: {
    light: { primary: '#075eae', onPrimary: '#ffffff', glow: 'rgba(7, 94, 174, 0.09)', ring: 'rgba(7, 94, 174, 0.38)' },
    dark: { primary: '#9bcaff', onPrimary: '#08335b', glow: 'rgba(155, 202, 255, 0.07)', ring: 'rgba(155, 202, 255, 0.44)' },
  },
  forest: {
    light: { primary: '#236744', onPrimary: '#ffffff', glow: 'rgba(35, 103, 68, 0.09)', ring: 'rgba(35, 103, 68, 0.38)' },
    dark: { primary: '#8dd9a3', onPrimary: '#0d3923', glow: 'rgba(141, 217, 163, 0.07)', ring: 'rgba(141, 217, 163, 0.44)' },
  },
} as const

type ThemeTokens = { colors: Record<string, string>; variables: Record<string, string | number> }
/** Mutates only four tokens in the existing reactive themes, never the selected mode. */
export function applyAccentPreset(themes: Record<string, ThemeTokens>, preset: AccentPreset) {
  for (const [name, mode] of [['moeurlLight', 'light'], ['moeurlDark', 'dark']] as const) {
    const value = accentPresets[preset][mode]
    Object.assign(themes[name].colors, { primary: value.primary, 'on-primary': value.onPrimary })
    Object.assign(themes[name].variables, { 'app-hero-glow': value.glow, 'app-ring': value.ring })
  }
}
