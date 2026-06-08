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
    expect(moeurlLightTheme.colors.secondary).toBe('#e49a3f')
    expect(moeurlLightTheme.colors['on-background']).toBe('#14302b')
    expect(moeurlLightTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#ffffff',
        'app-glass-surface': 'rgba(255, 255, 255, 0.78)',
        'app-hero-glow': 'rgba(228, 154, 63, 0.18)',
        'app-soft-surface': '#f7fbf8',
        'app-strong-surface': '#e5f0eb',
        'app-outline': 'rgba(15, 79, 72, 0.12)',
        'app-ring': 'rgba(15, 79, 72, 0.22)',
        'radius-panel': '32px',
      }),
    )

    expect(moeurlDarkTheme.dark).toBe(true)
    expect(moeurlDarkTheme.colors.primary).toBe('#65d6b1')
    expect(moeurlDarkTheme.colors.background).toBe('#111d1a')
    expect(moeurlDarkTheme.colors.secondary).toBe('#ecb65c')
    expect(moeurlDarkTheme.colors['on-background']).toBe('#f3fbf6')
    expect(moeurlDarkTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#182622',
        'app-glass-surface': 'rgba(23, 35, 31, 0.90)',
        'app-hero-glow': 'rgba(236, 182, 92, 0.16)',
        'app-soft-surface': '#121a18',
        'app-strong-surface': '#17332e',
        'app-outline': 'rgba(232, 248, 240, 0.13)',
        'app-ring': 'rgba(101, 214, 177, 0.26)',
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
