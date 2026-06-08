import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export const moeurlLightTheme = {
  dark: false,
  colors: {
    primary: '#0f4f48',
    secondary: '#e49a3f',
    background: '#eff6f2',
    surface: '#ffffff',
    'surface-variant': '#f7fbf8',
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
    'app-glass-surface': 'rgba(255, 255, 255, 0.78)',
    'app-hero-glow': 'rgba(228, 154, 63, 0.18)',
    'app-soft-surface': '#f7fbf8',
    'app-strong-surface': '#e5f0eb',
    'app-outline': 'rgba(15, 79, 72, 0.12)',
    'app-ring': 'rgba(15, 79, 72, 0.22)',
    'app-shadow': '0 20px 56px rgba(15, 79, 72, 0.10)',
    'app-shadow-strong': '0 32px 90px rgba(15, 79, 72, 0.16)',
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
    background: '#111d1a',
    surface: '#17231f',
    'surface-variant': '#1f2e29',
    'on-primary': '#10211e',
    'on-secondary': '#10211e',
    'on-background': '#f3fbf6',
    'on-surface': '#f3fbf6',
    'on-surface-variant': '#b7ccc4',
    outline: 'rgba(232, 248, 240, 0.13)',
    error: '#ffb4ab',
  },
  variables: {
    'app-elevated-surface': '#182622',
    'app-glass-surface': 'rgba(23, 35, 31, 0.90)',
    'app-hero-glow': 'rgba(236, 182, 92, 0.16)',
    'app-soft-surface': '#121a18',
    'app-strong-surface': '#17332e',
    'app-outline': 'rgba(232, 248, 240, 0.13)',
    'app-ring': 'rgba(101, 214, 177, 0.26)',
    'app-shadow': '0 20px 56px rgba(0, 0, 0, 0.30)',
    'app-shadow-strong': '0 32px 90px rgba(0, 0, 0, 0.42)',
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
