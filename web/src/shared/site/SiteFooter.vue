<template>
  <footer class="site-footer">
    <span v-if="config.footerText">{{ config.footerText }}</span>
    <span><a :href="build.url" target="_blank" rel="noopener noreferrer">Powered by MoeURL {{ build.label }}</a></span>
  </footer>
</template>

<script setup lang="ts">
/* global __MOEURL_BUILD__ */
import { useSiteConfig } from './useSiteConfig'

const { config } = useSiteConfig()
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
