<template>
  <TagCatalogBrowser class="personal-tag-browser" context="own" :access="access" :blocked="blocked" @select="$emit('select', $event)" />
</template>

<script setup lang="ts">
import TagCatalogBrowser from './TagCatalogBrowser.vue'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

defineOptions({ inheritAttrs: false })
defineProps<{ access: ReturnType<typeof useShortLinkAccess>; blocked?: boolean }>()
defineEmits<{ select: [tag: string] }>()
</script>
