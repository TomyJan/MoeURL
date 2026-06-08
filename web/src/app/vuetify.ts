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
    'app-glass-surface': 'rgba(255, 255, 255, 0.72)',
    'app-hero-glow': 'rgba(240, 169, 79, 0.24)',
    'app-soft-surface': '#f6fbf8',
    'app-outline': 'rgba(15, 79, 72, 0.10)',
    'app-ring': 'rgba(15, 79, 72, 0.18)',
    'app-shadow': '0 24px 70px rgba(15, 79, 72, 0.12)',
    'app-shadow-strong': '0 38px 110px rgba(15, 79, 72, 0.18)',
    'radius-page': '40px',
    'radius-panel': '32px',
    'radius-card': '28px',
    'radius-control': '999px',
  },
}

export const moeurlDarkTheme = {
  dark: true,
  colors: {
    primary: '#65d6b1',
    secondary: '#ecb65c',
    background: '#101916',
    surface: '#1d2925',
    'surface-variant': '#263530',
    'on-primary': '#10211e',
    'on-secondary': '#10211e',
    'on-background': '#effdf6',
    'on-surface': '#effdf6',
    'on-surface-variant': '#bed3cb',
    outline: 'rgba(239, 253, 246, 0.14)',
    error: '#ffb4ab',
  },
  variables: {
    'app-elevated-surface': '#22312c',
    'app-glass-surface': 'rgba(29, 41, 37, 0.92)',
    'app-hero-glow': 'rgba(236, 182, 92, 0.20)',
    'app-soft-surface': '#16201d',
    'app-outline': 'rgba(239, 253, 246, 0.14)',
    'app-ring': 'rgba(101, 214, 177, 0.24)',
    'app-shadow': '0 24px 70px rgba(0, 0, 0, 0.28)',
    'app-shadow-strong': '0 38px 110px rgba(0, 0, 0, 0.38)',
    'radius-page': '40px',
    'radius-panel': '32px',
    'radius-card': '28px',
    'radius-control': '999px',
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
