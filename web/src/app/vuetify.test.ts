import { describe, expect, it, vi } from 'vitest'

// Keep component CSS outside the Node test runner; browser tests exercise rendering.
vi.mock('vuetify/components', () => ({
  VAlert: {}, VApp: {}, VBtn: {}, VBtnToggle: {}, VCheckbox: {}, VChip: {},
  VCard: {}, VCardActions: {}, VCardText: {}, VCardTitle: {}, VContainer: {},
  VDialog: {}, VList: {}, VListItem: {}, VListItemTitle: {}, VMain: {}, VMenu: {},
  VProgressLinear: {}, VSelect: {}, VSlider: {}, VSnackbar: {}, VSwitch: {},
  VTab: {}, VTabs: {}, VTable: {}, VTextField: {}, VTextarea: {},
}))
vi.mock('vuetify/directives', () => ({ Ripple: {} }))

import { moeurlDarkTheme, moeurlLightTheme, vuetify } from './vuetify'

describe('vuetify', () => {
  it('keeps text, actions and semantic colors readable in both themes', () => {
    /** Computes WCAG relative luminance for an opaque theme color. */
    function luminance(hex: string) {
      const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
        const value = Number.parseInt(channel, 16) / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    for (const theme of [moeurlLightTheme, moeurlDarkTheme]) {
      for (const [foreground, background] of [
        [theme.colors['on-background'], theme.colors.background],
        [theme.colors['on-surface'], theme.colors.surface],
        [theme.colors['on-surface-variant'], theme.colors.background],
        [theme.colors['on-primary'], theme.colors.primary],
        [theme.colors['on-secondary'], theme.colors.secondary],
        [theme.colors['on-tertiary'], theme.colors.tertiary],
        [theme.colors.primary, theme.colors.surface],
        [theme.colors.secondary, theme.colors.surface],
        [theme.colors.tertiary, theme.colors.surface],
        [theme.colors.success, theme.colors.surface],
        [theme.colors.warning, theme.colors.surface],
        [theme.colors.error, theme.colors.surface],
        [theme.colors['on-surface-variant'], theme.variables['app-soft-surface']],
        [theme.colors['on-surface-variant'], theme.variables['app-strong-surface']],
      ]) {
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
        expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('creates a Vuetify plugin instance', () => {
    expect(vuetify.install).toEqual(expect.any(Function))
  })
})
