import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { PublicConfig } from '@/entities/system/api'

export const productDefaultSiteConfig: PublicConfig = {
  siteName: 'MoeURL',
  defaultLanguage: 'zh-CN',
  defaultTheme: 'system',
  footerText: '',
  showPoweredBy: true,
}

const sharedSiteConfig = ref<PublicConfig>(productDefaultSiteConfig)

/** Exposes the shared public branding settings with product defaults before loading. */
export function useSiteConfig() {
  return { config: sharedSiteConfig }
}

/** Replaces the shared site configuration after a validated public-config response. */
export function setSiteConfig(config: PublicConfig) {
  sharedSiteConfig.value = config
}

/** Applies the configured site name to the browser document title without trusting markup. */
export function bindSiteTitle(siteName: Readonly<Ref<string>>) {
  watch(siteName, (value) => {
    if (globalThis.document) {
      globalThis.document.title = value
    }
  }, { immediate: true })
}
