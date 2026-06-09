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
    expect(moeurlLightTheme.colors.primary).toBe('#145b53')
    expect(moeurlLightTheme.colors.background).toBe('#eef7f3')
    expect(moeurlLightTheme.colors.secondary).toBe('#e7a84b')
    expect(moeurlLightTheme.colors['on-background']).toBe('#132c27')
    expect(moeurlLightTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#ffffff',
        'app-glass-surface': 'rgba(255, 255, 255, 0.92)',
        'app-hero-glow': 'rgba(231, 168, 75, 0.14)',
        'app-soft-surface': '#f8fcf9',
        'app-workspace-surface': '#f2f8f4',
        'app-strong-surface': '#e4efe9',
        'app-outline': 'rgba(20, 91, 83, 0.10)',
        'app-outline-strong': 'rgba(20, 91, 83, 0.18)',
        'app-ring': 'rgba(20, 91, 83, 0.18)',
        'radius-panel': '32px',
      }),
    )

    expect(moeurlDarkTheme.dark).toBe(true)
    expect(moeurlDarkTheme.colors.primary).toBe('#7adfbd')
    expect(moeurlDarkTheme.colors.background).toBe('#14221f')
    expect(moeurlDarkTheme.colors.secondary).toBe('#e7bf75')
    expect(moeurlDarkTheme.colors['on-background']).toBe('#f2fbf5')
    expect(moeurlDarkTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#1d2b26',
        'app-glass-surface': 'rgba(29, 43, 38, 0.94)',
        'app-hero-glow': 'rgba(231, 191, 117, 0.14)',
        'app-soft-surface': '#1a2722',
        'app-workspace-surface': '#18211e',
        'app-strong-surface': '#284238',
        'app-outline': 'rgba(255, 255, 255, 0.10)',
        'app-outline-strong': 'rgba(255, 255, 255, 0.18)',
        'app-ring': 'rgba(122, 223, 189, 0.28)',
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
