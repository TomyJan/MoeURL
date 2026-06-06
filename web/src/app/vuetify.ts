import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export const moeurlLightTheme = {
  dark: false,
  colors: {
    primary: '#4f6356',
    secondary: '#52635a',
    background: '#f7fbf6',
    surface: '#ffffff',
    error: '#ba1a1a',
  },
}

export const moeurlDarkTheme = {
  dark: true,
  colors: {
    primary: '#b7ccbd',
    secondary: '#bac8bf',
    background: '#101512',
    surface: '#191d1a',
    error: '#ffb4ab',
  },
}

export const vuetify = createVuetify({
  components,
  defaults: {
    VBtn: {
      rounded: 'lg',
    },
    VCard: {
      rounded: 'lg',
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
