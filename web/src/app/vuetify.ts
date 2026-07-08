import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export const moeurlLightTheme = {
  dark: false,
  colors: {
    primary: '#315f8c',
    secondary: '#c47a4a',
    background: '#f5f7fb',
    surface: '#ffffff',
    'surface-variant': '#f8fafc',
    'on-primary': '#ffffff',
    'on-secondary': '#141a22',
    'on-background': '#141a22',
    'on-surface': '#141a22',
    'on-surface-variant': '#5f6b7a',
    outline: 'rgba(49, 95, 140, 0.14)',
    error: '#b25555',
  },
  variables: {
    'app-elevated-surface': '#ffffff',
    'app-glass-surface': 'rgba(255, 255, 255, 0.86)',
    'app-hero-glow': 'rgba(49, 95, 140, 0.10)',
    'app-soft-surface': '#f8fafc',
    'app-workspace-surface': '#eef2f7',
    'app-strong-surface': '#e2e9f1',
    'app-outline': 'rgba(49, 95, 140, 0.14)',
    'app-outline-strong': 'rgba(49, 95, 140, 0.22)',
    'app-ring': 'rgba(49, 95, 140, 0.24)',
    'app-shadow': '0 18px 44px rgba(33, 48, 67, 0.08)',
    'app-shadow-strong': '0 28px 70px rgba(33, 48, 67, 0.14)',
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
    primary: '#8ab8e8',
    secondary: '#e0a06f',
    background: '#101722',
    surface: '#1a2433',
    'surface-variant': '#202c3d',
    'on-primary': '#101722',
    'on-secondary': '#101722',
    'on-background': '#edf4fb',
    'on-surface': '#edf4fb',
    'on-surface-variant': '#a7b4c4',
    outline: 'rgba(237, 244, 251, 0.10)',
    error: '#e68a8a',
  },
  variables: {
    'app-elevated-surface': '#1a2433',
    'app-glass-surface': 'rgba(26, 36, 51, 0.94)',
    'app-hero-glow': 'rgba(138, 184, 232, 0.10)',
    'app-soft-surface': '#172231',
    'app-workspace-surface': '#101722',
    'app-strong-surface': '#202c3d',
    'app-outline': 'rgba(237, 244, 251, 0.10)',
    'app-outline-strong': 'rgba(237, 244, 251, 0.16)',
    'app-ring': 'rgba(138, 184, 232, 0.30)',
    'app-shadow': '0 18px 46px rgba(0, 0, 0, 0.24)',
    'app-shadow-strong': '0 30px 78px rgba(0, 0, 0, 0.34)',
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
