<template>
  <section class="short-link-create-panel" :class="`short-link-create-panel--${mode}`">
    <div class="short-link-create-panel__shell">
      <div class="short-link-create-panel__header" aria-hidden="true">
        <span class="short-link-create-panel__status-dot" />
        <span class="short-link-create-panel__status-line" />
        <span class="short-link-create-panel__status-pill">https</span>
      </div>

      <div class="short-link-create-panel__form">
        <div class="short-link-create-panel__field-row">
          <v-text-field
            v-model="targetUrl"
            class="short-link-create-panel__input"
            label="https://example.com"
            variant="outlined"
            :disabled="!canCreateShortLink"
            :error-messages="errorMessage"
            @keyup.enter="submit"
          />
          <v-btn
            class="short-link-create-panel__submit"
            color="primary"
            size="large"
            :disabled="!canCreateShortLink"
            :loading="mutation.isPending.value"
            @click="submit"
          >
            {{ t('shortLinkCreate.submit') }}
          </v-btn>
        </div>
        <v-alert v-if="!canCreateShortLink" type="info" variant="tonal">
          {{ t('shortLinkCreate.permissionRequired') }}
        </v-alert>
      </div>

      <div v-if="createdUrl" class="short-link-create-panel__result" role="status">
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
      </div>
    </div>
  </section>
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
    currentUserQuery.data.value?.user?.permissions.includes('short_link:create') &&
    currentUserQuery.data.value?.user?.permissions.includes('domain:use_default'),
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
  width: 100%;
}

.short-link-create-panel--full {
  width: min(760px, 100%);
}

.short-link-create-panel__shell {
  position: relative;
  overflow: hidden;
  padding: clamp(14px, 2.4vw, 20px);
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--moeurl-surface-elevated) 88%, transparent), var(--moeurl-surface-glass)),
    var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow);
  backdrop-filter: blur(22px);
}

.short-link-create-panel__shell::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 18%, transparent), transparent 36%);
  content: "";
  pointer-events: none;
}

.short-link-create-panel__header,
.short-link-create-panel__form,
.short-link-create-panel__result {
  position: relative;
  z-index: 1;
}

.short-link-create-panel__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.short-link-create-panel__status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 6px color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
}

.short-link-create-panel__status-line {
  flex: 1;
  height: 1px;
  background: var(--moeurl-outline);
}

.short-link-create-panel__status-pill {
  padding: 4px 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 72%, transparent);
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
}

.short-link-create-panel__form {
  display: grid;
  gap: 12px;
}

.short-link-create-panel__field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.short-link-create-panel__input {
  min-width: 0;
}

.short-link-create-panel__submit {
  min-height: 56px;
  padding-inline: 24px;
}

.short-link-create-panel__result {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent);
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

@media (max-width: 620px) {
  .short-link-create-panel__field-row {
    grid-template-columns: 1fr;
  }

  .short-link-create-panel__submit {
    width: 100%;
  }
}
</style>
