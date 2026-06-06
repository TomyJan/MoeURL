<template>
  <v-container class="py-10">
    <h1 class="text-h4 mb-4">{{ t('page.home') }}</h1>
    <v-card max-width="760" variant="outlined">
      <v-card-text>
        <v-text-field
          v-model="targetUrl"
          label="https://example.com"
          variant="outlined"
          :disabled="!canCreateShortLink"
          :error-messages="errorMessage"
          @keyup.enter="submit"
        />
        <v-alert v-if="!canCreateShortLink" class="mb-4" type="info" variant="tonal">请登录后创建短链</v-alert>
        <v-btn color="primary" :disabled="!canCreateShortLink" :loading="mutation.isPending.value" @click="submit">
          创建短链
        </v-btn>
        <v-alert v-if="createdUrl" class="mt-4" type="success" variant="tonal">
          <div class="created-link">
            <a :href="createdUrl" target="_blank" rel="noreferrer">{{ createdUrl }}</a>
            <div class="created-actions">
              <v-btn size="small" variant="text" @click="copyUrl(createdUrl)">复制短链</v-btn>
              <v-btn size="small" variant="text" :href="createdUrl" target="_blank" rel="noreferrer">打开短链</v-btn>
              <v-btn size="small" variant="text" @click="resetForm">继续创建</v-btn>
            </div>
          </div>
        </v-alert>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import { createShortLink } from '@/entities/short-link/api'

const { t } = useI18n()
const targetUrl = ref('')
const createdUrl = ref('')
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const canCreateShortLink = computed(
  () =>
    currentUserQuery.data.value?.user.permissions.includes('short_link:create') &&
    currentUserQuery.data.value?.user.permissions.includes('domain:use_default'),
)

const mutation = useMutation({
  mutationFn: createShortLink,
  onSuccess(result) {
    createdUrl.value = result.shortLink.url
  },
})

const errorMessage = computed(() => {
  if (!mutation.data.value && mutation.error.value) {
    return mutation.error.value.message || '创建失败，请检查链接和权限'
  }
  return ''
})

function submit() {
  if (!canCreateShortLink.value) {
    return
  }
  createdUrl.value = ''
  mutation.mutate({ targetUrl: targetUrl.value })
}

function resetForm() {
  targetUrl.value = ''
  createdUrl.value = ''
}

function copyUrl(url: string) {
  void navigator.clipboard?.writeText(url)
}
</script>

<style scoped>
.created-link {
  display: grid;
  gap: 8px;
}

.created-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
