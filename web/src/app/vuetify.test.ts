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
    expect(moeurlLightTheme.colors.primary).toBe('#315f8c')
    expect(moeurlLightTheme.colors.background).toBe('#f5f7fb')
    expect(moeurlLightTheme.colors.secondary).toBe('#c47a4a')
    expect(moeurlLightTheme.colors['on-background']).toBe('#141a22')
    expect(moeurlLightTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#ffffff',
        'app-glass-surface': 'rgba(255, 255, 255, 0.86)',
        'app-hero-glow': 'rgba(49, 95, 140, 0.10)',
        'app-soft-surface': '#f8fafc',
        'app-workspace-surface': '#eef2f7',
        'app-strong-surface': '#e2e9f1',
        'app-outline': 'rgba(49, 95, 140, 0.14)',
        'app-outline-strong': 'rgba(49, 95, 140, 0.22)',
        'app-ring': 'rgba(49, 95, 140, 0.24)',
        'radius-panel': '32px',
      }),
    )

    expect(moeurlDarkTheme.dark).toBe(true)
    expect(moeurlDarkTheme.colors.primary).toBe('#8ab8e8')
    expect(moeurlDarkTheme.colors.background).toBe('#101722')
    expect(moeurlDarkTheme.colors.secondary).toBe('#e0a06f')
    expect(moeurlDarkTheme.colors['on-background']).toBe('#edf4fb')
    expect(moeurlDarkTheme.variables).toEqual(
      expect.objectContaining({
        'app-elevated-surface': '#1a2433',
        'app-glass-surface': 'rgba(26, 36, 51, 0.94)',
        'app-hero-glow': 'rgba(138, 184, 232, 0.10)',
        'app-soft-surface': '#172231',
        'app-workspace-surface': '#101722',
        'app-strong-surface': '#202c3d',
        'app-outline': 'rgba(237, 244, 251, 0.10)',
        'app-outline-strong': 'rgba(237, 244, 251, 0.16)',
        'app-ring': 'rgba(138, 184, 232, 0.30)',
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
