<template>
  <footer class="site-footer">
    <span v-if="config.footerText">{{ config.footerText }}</span>
    <nav v-if="footerLinks.links.length" :aria-label="t('footerLinks.navigation')">
      <ul>
        <li v-for="(link, index) in footerLinks.links" :key="index">
          <a :href="link.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{{ link.label }}<span aria-hidden="true"> ↗</span><span class="site-footer__sr-only"> {{ t('footerLinks.newWindow') }}</span></a>
        </li>
      </ul>
    </nav>
    <span>Powered by MoeURL <a :href="build.url" target="_blank" rel="noopener noreferrer">{{ build.label }}</a></span>
  </footer>
</template>

<script setup lang="ts">
/* global __MOEURL_BUILD__ */
import { useSiteConfig } from './useSiteConfig'
import { useI18n } from 'vue-i18n'
import { useSiteFooterLinks } from './useSiteFooterLinks'

const { config } = useSiteConfig()
const { t } = useI18n()
const { footerLinks } = useSiteFooterLinks()
const build = __MOEURL_BUILD__
</script>

<style scoped>
.site-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px 24px;
  padding: 18px clamp(20px, 4vw, 56px);
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.site-footer > span:only-child {
  margin-inline: auto;
}

.site-footer > span {
  min-width: 0;
}

.site-footer nav { min-width: 0; max-width: 100%; }
.site-footer ul { display: flex; flex-wrap: wrap; gap: 8px 20px; list-style: none; margin: 0; padding: 0; }
.site-footer li { min-width: 0; max-width: 100%; }
.site-footer__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.site-footer a:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; border-radius: 2px; }

.site-footer a {
  color: inherit;
  text-decoration-color: transparent;
  text-underline-offset: 3px;
  transition: color 180ms ease, text-decoration-color 180ms ease;
}

.site-footer a:hover,
.site-footer a:focus-visible {
  color: rgb(var(--v-theme-primary));
  text-decoration-color: currentColor;
}

@media (prefers-reduced-motion: reduce) {
  .site-footer a {
    transition: none;
  }
}
</style>
