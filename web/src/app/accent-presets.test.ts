import { describe, expect, it, vi } from 'vitest'
import { createVuetify } from 'vuetify'
import { applyAccentPreset } from './accent-presets'
vi.mock('vuetify/components', () => ({
  VAlert: {}, VApp: {}, VBtn: {}, VBtnToggle: {}, VCheckbox: {}, VCheckboxBtn: {}, VChip: {}, VCard: {}, VCardActions: {}, VCardText: {}, VCardTitle: {}, VContainer: {}, VDialog: {}, VList: {}, VListItem: {}, VListItemTitle: {}, VMain: {}, VMenu: {}, VProgressLinear: {}, VSelect: {}, VSlider: {}, VSnackbar: {}, VSwitch: {}, VTab: {}, VTabs: {}, VTable: {}, VTextField: {}, VTextarea: {},
}))
vi.mock('vuetify/directives', () => ({ Ripple: {} }))
import { moeurlDarkTheme, moeurlLightTheme } from './vuetify'

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/.{2}/g)!.map(channel => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
const fixtures = [
  ['iris', '#5c4dde', '#ffffff', 'rgba(92, 77, 222, 0.09)', 'rgba(92, 77, 222, 0.38)', '#b9adff', '#272047', 'rgba(185, 173, 255, 0.07)', 'rgba(185, 173, 255, 0.44)'],
  ['ocean', '#075eae', '#ffffff', 'rgba(7, 94, 174, 0.09)', 'rgba(7, 94, 174, 0.38)', '#9bcaff', '#08335b', 'rgba(155, 202, 255, 0.07)', 'rgba(155, 202, 255, 0.44)'],
  ['forest', '#236744', '#ffffff', 'rgba(35, 103, 68, 0.09)', 'rgba(35, 103, 68, 0.38)', '#8dd9a3', '#0d3923', 'rgba(141, 217, 163, 0.07)', 'rgba(141, 217, 163, 0.44)'],
] as const
describe('fixed site accent application', () => {
  it.each(fixtures)('applies %s to the real reactive themes without replacing any other token or mode', (preset, lp, lo, lg, lr, dp, dO, dg, dr) => {
    const plugin = createVuetify({ theme: { defaultTheme: 'moeurlDark', themes: { moeurlLight: structuredClone(moeurlLightTheme), moeurlDark: structuredClone(moeurlDarkTheme) } } })
    const before = JSON.parse(JSON.stringify(plugin.theme.themes.value))
    const light = plugin.theme.themes.value.moeurlLight, dark = plugin.theme.themes.value.moeurlDark
    applyAccentPreset(plugin.theme.themes.value, preset)
    expect(plugin.theme.global.name.value).toBe('moeurlDark')
    expect(light).toBe(plugin.theme.themes.value.moeurlLight)
    expect(dark).toBe(plugin.theme.themes.value.moeurlDark)
    for (const [name, primary, onPrimary, glow, ring] of [['moeurlLight', lp, lo, lg, lr], ['moeurlDark', dp, dO, dg, dr]]) {
      const value = plugin.theme.themes.value[name]
      expect(value).toEqual({ ...before[name], colors: { ...before[name].colors, primary, 'on-primary': onPrimary }, variables: { ...before[name].variables, 'app-hero-glow': glow, 'app-ring': ring } })
      for (const [a, b] of [[primary, onPrimary], [primary, value.colors.surface]]) {
        const lum = [luminance(a), luminance(b)].sort((a, b) => b - a)
        expect((lum[0] + .05) / (lum[1] + .05)).toBeGreaterThanOrEqual(4.5)
      }
    }
    plugin.theme.global.name.value = 'moeurlLight'
    expect(plugin.theme.current.value.colors.primary).toBe(lp)
  })
})
