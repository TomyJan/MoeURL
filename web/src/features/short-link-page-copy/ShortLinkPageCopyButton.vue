<template>
  <div v-if="state.visible.value" class="page-links-copy">
    <v-btn :data-testid="content.testId" variant="tonal" :disabled="state.disabled.value" :loading="state.pending.value" @click="state.copy">
      {{ t(`${content.key}.action`) }}
    </v-btn>
    <p>{{ t(`${content.key}.description`) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PageLinksCopyState } from './usePageLinksCopy'
const props = defineProps<{ state: PageLinksCopyState; mode?: 'page' | 'selected' | 'selected-markdown' }>()
const modes = {
  page: { testId: 'short-link-page-copy', key: 'pageLinksCopy' },
  selected: { testId: 'short-link-selected-copy', key: 'selectedLinksCopy' },
  'selected-markdown': { testId: 'short-link-selected-markdown-copy', key: 'selectedMarkdownCopy' },
}
const content = computed(() => modes[props.mode ?? 'page'])
const { t } = useI18n()
</script>

<style scoped>
.page-links-copy { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; min-width: 0; max-width: 100%; }
.page-links-copy p { margin: 0; max-width: 260px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; text-align: right; }
@media (max-width: 760px) {
  .page-links-copy { align-items: flex-start; }
  .page-links-copy p { text-align: left; }
}
</style>
