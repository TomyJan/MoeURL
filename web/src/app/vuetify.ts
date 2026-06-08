import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export const moeurlLightTheme = {
  dark: false,
  colors: {
    primary: '#0f4f48',
    secondary: '#f0a94f',
    background: '#eff6f2',
    surface: '#ffffff',
    'surface-variant': '#f6fbf8',
    'on-primary': '#ffffff',
    'on-secondary': '#14302b',
    'on-background': '#14302b',
    'on-surface': '#14302b',
    'on-surface-variant': '#5d766d',
    outline: 'rgba(15, 79, 72, 0.10)',
    error: '#ba1a1a',
  },
  variables: {
    'app-elevated-surface': '#ffffff',
    'app-glass-surface': 'rgba(255, 255, 255, 0.92)',
    'app-hero-glow': 'rgba(240, 169, 79, 0.13)',
    'app-soft-surface': '#f7fbf8',
    'app-workspace-surface': '#f3faf6',
    'app-strong-surface': '#e7f1ec',
    'app-outline': 'rgba(15, 79, 72, 0.10)',
    'app-outline-strong': 'rgba(15, 79, 72, 0.18)',
    'app-ring': 'rgba(15, 79, 72, 0.18)',
    'app-shadow': '0 18px 44px rgba(15, 79, 72, 0.08)',
    'app-shadow-strong': '0 28px 70px rgba(15, 79, 72, 0.14)',
    'radius-page': '40px',
    'radius-panel': '32px',
    'radius-card': '28px',
    'radius-control': '22px',
    'radius-pill': '999px',
  },
}

export const moeurlDarkTheme = {
  dark: true,
  colors: {
    primary: '#65d6b1',
    secondary: '#ecb65c',
    background: '#0f1d1a',
    surface: '#151f1c',
    'surface-variant': '#1b2925',
    'on-primary': '#10211e',
    'on-secondary': '#10211e',
    'on-background': '#effdf6',
    'on-surface': '#effdf6',
    'on-surface-variant': '#9eb6ad',
    outline: 'rgba(255, 255, 255, 0.08)',
    error: '#ffb4ab',
  },
  variables: {
    'app-elevated-surface': '#151f1c',
    'app-glass-surface': 'rgba(21, 31, 28, 0.96)',
    'app-hero-glow': 'rgba(236, 182, 92, 0.08)',
    'app-soft-surface': '#111815',
    'app-workspace-surface': '#101614',
    'app-strong-surface': '#1c302a',
    'app-outline': 'rgba(255, 255, 255, 0.08)',
    'app-outline-strong': 'rgba(255, 255, 255, 0.14)',
    'app-ring': 'rgba(236, 182, 92, 0.28)',
    'app-shadow': '0 18px 46px rgba(0, 0, 0, 0.26)',
    'app-shadow-strong': '0 30px 78px rgba(0, 0, 0, 0.38)',
    'radius-page': '40px',
    'radius-panel': '32px',
    'radius-card': '28px',
    'radius-control': '22px',
    'radius-pill': '999px',
  },
}

export const vuetify = createVuetify({
  components,
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
  theme: {
    defaultTheme: 'moeurlLight',
    themes: {
      moeurlLight: moeurlLightTheme,
      moeurlDark: moeurlDarkTheme,
    },
  },
  directives,
})
