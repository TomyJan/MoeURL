import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export const moeurlLightTheme = {
  dark: false,
  colors: {
    primary: '#145b53',
    secondary: '#e7a84b',
    background: '#eef7f3',
    surface: '#ffffff',
    'surface-variant': '#f8fcf9',
    'on-primary': '#ffffff',
    'on-secondary': '#132c27',
    'on-background': '#132c27',
    'on-surface': '#132c27',
    'on-surface-variant': '#5f766e',
    outline: 'rgba(20, 91, 83, 0.10)',
    error: '#ba1a1a',
  },
  variables: {
    'app-elevated-surface': '#ffffff',
    'app-glass-surface': 'rgba(255, 255, 255, 0.92)',
    'app-hero-glow': 'rgba(231, 168, 75, 0.14)',
    'app-soft-surface': '#f8fcf9',
    'app-workspace-surface': '#f2f8f4',
    'app-strong-surface': '#e4efe9',
    'app-outline': 'rgba(20, 91, 83, 0.10)',
    'app-outline-strong': 'rgba(20, 91, 83, 0.18)',
    'app-ring': 'rgba(20, 91, 83, 0.18)',
    'app-shadow': '0 18px 44px rgba(20, 91, 83, 0.08)',
    'app-shadow-strong': '0 28px 70px rgba(20, 91, 83, 0.14)',
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
    primary: '#7adfbd',
    secondary: '#e7bf75',
    background: '#14221f',
    surface: '#1d2b26',
    'surface-variant': '#284238',
    'on-primary': '#10211e',
    'on-secondary': '#10211e',
    'on-background': '#f2fbf5',
    'on-surface': '#f2fbf5',
    'on-surface-variant': '#a9bcb3',
    outline: 'rgba(255, 255, 255, 0.10)',
    error: '#ffb4ab',
  },
  variables: {
    'app-elevated-surface': '#1d2b26',
    'app-glass-surface': 'rgba(29, 43, 38, 0.94)',
    'app-hero-glow': 'rgba(231, 191, 117, 0.14)',
    'app-soft-surface': '#1a2722',
    'app-workspace-surface': '#18211e',
    'app-strong-surface': '#284238',
    'app-outline': 'rgba(255, 255, 255, 0.10)',
    'app-outline-strong': 'rgba(255, 255, 255, 0.18)',
    'app-ring': 'rgba(122, 223, 189, 0.28)',
    'app-shadow': '0 18px 46px rgba(7, 17, 14, 0.20)',
    'app-shadow-strong': '0 30px 78px rgba(7, 17, 14, 0.30)',
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
