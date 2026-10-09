<template>
  <footer v-if="config.footerText || config.showPoweredBy" class="site-footer">
    <span v-if="config.footerText">{{ config.footerText }}</span>
    <span v-if="config.footerText && config.showPoweredBy" aria-hidden="true"> · </span>
    <span v-if="config.showPoweredBy">Powered by MoeURL</span>
  </footer>
</template>

<script setup lang="ts">
import { useSiteConfig } from './useSiteConfig'

const { config } = useSiteConfig()
</script>

<style scoped>
.site-footer {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 18px 16px 24px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  text-align: center;
}
</style>
