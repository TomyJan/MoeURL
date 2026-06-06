<template>
  <v-container class="py-10">
    <h1 class="text-h4">{{ t('page.notFound') }}</h1>
  </v-container>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
