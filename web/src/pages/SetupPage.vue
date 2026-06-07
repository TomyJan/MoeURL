<template>
  <v-container class="py-10">
    <h1 class="text-h4 mb-4">{{ t('page.setup') }}</h1>
    <v-alert v-if="isLoading" class="mb-4" color="primary" variant="tonal">Loading</v-alert>
    <v-alert v-else-if="data?.initialized || initialized" class="mb-4" type="success" variant="tonal">
      Initialized
    </v-alert>
    <v-card v-else max-width="720" variant="outlined">
      <v-card-text>
        <v-text-field v-model="form.adminUsername" label="Admin username" variant="outlined" />
        <v-text-field v-model="form.adminPassword" label="Admin password" type="password" variant="outlined" />
        <v-text-field v-model="form.adminNickname" label="Admin nickname" variant="outlined" />
        <v-text-field v-model="form.siteName" label="Site name" variant="outlined" />
        <v-text-field v-model="form.systemDomain" label="System domain" variant="outlined" />
        <v-text-field v-model="form.shortLinkDomain" label="Short link domain" variant="outlined" />
        <v-select v-model="form.defaultLanguage" label="Default language" :items="languageItems" variant="outlined" />
        <v-select v-model="form.defaultTheme" label="Default theme" :items="themeItems" variant="outlined" />
        <v-alert v-if="mutation.isError.value" class="mb-4" type="error" variant="tonal">
          {{ mutation.error.value?.message || '初始化失败' }}
        </v-alert>
        <v-btn color="primary" :loading="mutation.isPending.value" @click="submit">初始化</v-btn>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery } from '@tanstack/vue-query'

import { getInitStatus, setupSystem } from '@/entities/system/api'
import type { SetupInput } from '@/entities/system/api'

const { t } = useI18n()
const { data, isLoading } = useQuery({
  queryKey: ['init-status'],
  queryFn: getInitStatus,
})
const initialized = ref(false)
const form = reactive<SetupInput>({
  adminUsername: '',
  adminPassword: '',
  adminNickname: '',
  siteName: 'MoeURL',
  systemDomain: '127.0.0.1:8080',
  shortLinkDomain: '127.0.0.1:8080',
  defaultLanguage: 'zh-CN',
  defaultTheme: 'system',
})

const languageItems = [
  { title: '简体中文', value: 'zh-CN' },
  { title: 'English', value: 'en' },
]
const themeItems = [
  { title: '跟随系统', value: 'system' },
  { title: '浅色', value: 'light' },
  { title: '深色', value: 'dark' },
]
const mutation = useMutation({
  mutationFn: setupSystem,
  onSuccess(result) {
    initialized.value = result.initialized
  },
})

function submit() {
  mutation.mutate({ ...form })
}
</script>
