import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createVuetify: vi.fn((options: unknown) => ({
    install: vi.fn(),
    options,
  })),
}))

vi.mock('vuetify', () => ({
  createVuetify: mocks.createVuetify,
}))

vi.mock('vuetify/components', () => ({
  VBtn: {},
  VCard: {},
  VDialog: {},
  VTextField: {},
}))

vi.mock('vuetify/directives', () => ({
  Ripple: {},
}))

import { moeurlDarkTheme, moeurlLightTheme, vuetify } from './vuetify'

describe('vuetify', () => {
  it('defines MoeURL light and dark themes', () => {
    expect(moeurlLightTheme.dark).toBe(false)
    expect(moeurlLightTheme.colors.primary).toBe('#0f4f48')
    expect(moeurlLightTheme.colors.background).toBe('#eff6f2')
    expect(moeurlLightTheme.colors.secondary).toBe('#f0a94f')
    expect(moeurlLightTheme.colors['on-background']).toBe('#14302b')
    expect(moeurlLightTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#ffffff',
        'app-glass-surface': 'rgba(255, 255, 255, 0.72)',
        'app-hero-glow': 'rgba(240, 169, 79, 0.24)',
        'app-soft-surface': '#f6fbf8',
        'app-outline': 'rgba(15, 79, 72, 0.10)',
        'app-ring': 'rgba(15, 79, 72, 0.18)',
        'radius-panel': '32px',
      }),
    )

    expect(moeurlDarkTheme.dark).toBe(true)
    expect(moeurlDarkTheme.colors.primary).toBe('#65d6b1')
    expect(moeurlDarkTheme.colors.background).toBe('#10231f')
    expect(moeurlDarkTheme.colors.secondary).toBe('#ecb65c')
    expect(moeurlDarkTheme.colors['on-background']).toBe('#effdf6')
    expect(moeurlDarkTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#203a34',
        'app-glass-surface': 'rgba(31, 56, 49, 0.76)',
        'app-hero-glow': 'rgba(101, 214, 177, 0.24)',
        'app-soft-surface': '#142b26',
        'app-outline': 'rgba(199, 244, 226, 0.12)',
        'app-ring': 'rgba(101, 214, 177, 0.28)',
        'radius-panel': '32px',
      }),
    )
  })

  it('creates a Vuetify plugin instance', () => {
    expect(vuetify.install).toEqual(expect.any(Function))
    expect(mocks.createVuetify).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: {
          VBtn: {
            rounded: 'pill',
          },
          VCard: {
            rounded: 'xl',
          },
          VDialog: {
            rounded: 'xl',
          },
          VTextField: {
            rounded: 'xl',
          },
        },
      }),
    )
  })
})
