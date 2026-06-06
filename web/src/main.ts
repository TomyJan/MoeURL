import 'vuetify/styles'

import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'

import App from './app/App.vue'
import { i18n } from './app/i18n'
import { queryClient } from './app/query'
import { router } from './app/router'
import { vuetify } from './app/vuetify'
import { registerServiceWorker } from './shared/pwa/register'

createApp(App)
  .use(createPinia())
  .use(router)
  .use(vuetify)
  .use(i18n)
  .use(VueQueryPlugin, { queryClient })
  .mount('#app')

registerServiceWorker()
