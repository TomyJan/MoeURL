<template>
  <footer v-if="config.footerText || config.showPoweredBy" class="site-footer">
    <span v-if="config.footerText">{{ config.footerText }}</span>
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
</style>
