<template>
  <details class="instant-details">
    <summary>
      <time :datetime="instant">{{ label }}</time>
      <span>{{ t('insights.preciseTime') }}</span>
    </summary>
    <p>{{ instant }}</p>
  </details>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ instant: string; label: string }>()
const { t } = useI18n()
</script>

<style scoped>
.instant-details { min-width: 12rem; max-width: 22rem; }
.instant-details > summary { cursor: pointer; white-space: normal; border-radius: 4px; }
.instant-details > summary:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
.instant-details time { display: inline-block; overflow-wrap: anywhere; }
.instant-details span { display: inline-block; margin-inline-start: 0.5em; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.85em; }
.instant-details > p { margin: 8px 0; white-space: normal; overflow-wrap: anywhere; }
</style>
