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
    background: '#10231f',
    surface: '#1d332e',
    'surface-variant': '#24443c',
    'on-primary': '#10211e',
    'on-secondary': '#10211e',
    'on-background': '#effdf6',
    'on-surface': '#effdf6',
    'on-surface-variant': '#9eb6ad',
    outline: 'rgba(255, 255, 255, 0.08)',
    error: '#ffb4ab',
  },
  variables: {
    'app-elevated-surface': '#203a34',
    'app-glass-surface': 'rgba(31, 56, 49, 0.76)',
    'app-hero-glow': 'rgba(101, 214, 177, 0.24)',
    'app-soft-surface': '#142b26',
    'app-outline': 'rgba(199, 244, 226, 0.12)',
    'app-ring': 'rgba(101, 214, 177, 0.28)',
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
