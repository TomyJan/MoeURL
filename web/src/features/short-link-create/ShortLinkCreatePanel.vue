<template>
  <v-card class="short-link-create-panel" :class="`short-link-create-panel--${mode}`" variant="flat">
    <v-card-text>
      <div class="short-link-create-panel__form">
        <v-text-field
          v-model="targetUrl"
          label="https://example.com"
          variant="outlined"
          :disabled="!canCreateShortLink"
          :error-messages="errorMessage"
          @keyup.enter="submit"
        />
        <v-alert v-if="!canCreateShortLink" type="info" variant="tonal">
          {{ t('shortLinkCreate.permissionRequired') }}
        </v-alert>
        <v-btn color="primary" :disabled="!canCreateShortLink" :loading="mutation.isPending.value" @click="submit">
          {{ t('shortLinkCreate.submit') }}
        </v-btn>
      </div>

      <v-alert v-if="createdUrl" class="short-link-create-panel__result" type="success" variant="tonal">
        <div class="short-link-create-panel__created">
          <a :href="createdUrl" target="_blank" rel="noreferrer">{{ createdUrl }}</a>
          <div class="short-link-create-panel__actions">
            <v-btn size="small" variant="text" @click="copyUrl(createdUrl)">{{ t('shortLinkCreate.copy') }}</v-btn>
            <v-btn size="small" variant="text" :href="createdUrl" target="_blank" rel="noreferrer">
              {{ t('shortLinkCreate.open') }}
            </v-btn>
            <v-btn size="small" variant="text" @click="resetForm">{{ t('shortLinkCreate.reset') }}</v-btn>
          </div>
        </div>
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import { createShortLink } from '@/entities/short-link/api'

withDefaults(
  defineProps<{
    mode?: 'compact' | 'full'
  }>(),
  {
    mode: 'compact',
  },
)

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
    return mutation.error.value instanceof Error ? mutation.error.value.message : t('shortLinkCreate.failed')
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
.short-link-create-panel {
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--moeurl-shadow);
}

.short-link-create-panel--full {
  width: min(760px, 100%);
}

.short-link-create-panel__form {
  display: grid;
  gap: 16px;
}

.short-link-create-panel__result {
  margin-top: 16px;
}

.short-link-create-panel__created {
  display: grid;
  gap: 8px;
}

.short-link-create-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
