// Browser-only test fixture. No application router or production entry imports this module.
import { createApp } from 'vue'
import { i18n } from '../src/app/i18n'
import { vuetify } from '../src/app/vuetify'
import 'vuetify/styles'
import '../src/app/theme.css'
import FeedbackHarness from './FeedbackHarness.vue'
const params = new URLSearchParams(location.search)
i18n.global.locale.value = params.get('language') === 'en' ? 'en' : 'zh-CN'
vuetify.theme.global.name.value = params.get('theme') === 'dark' ? 'moeurlDark' : 'moeurlLight'
createApp(FeedbackHarness).use(vuetify).use(i18n).mount('#app')
