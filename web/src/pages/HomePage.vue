<template>
  <v-container class="py-10">
    <h1 class="text-h4 mb-4">{{ t('page.home') }}</h1>
    <ShortLinkCreatePanel mode="full" />
  </v-container>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import ShortLinkCreatePanel from '@/features/short-link-create/ShortLinkCreatePanel.vue'

const { t } = useI18n()
</script>
