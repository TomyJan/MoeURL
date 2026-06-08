<template>
  <section class="short-link-create-panel" :class="`short-link-create-panel--${mode}`">
    <div class="short-link-create-panel__shell">
      <div v-if="mode === 'full'" class="short-link-create-panel__header">
        <div>
          <p class="short-link-create-panel__eyebrow">{{ t('shortLinkCreate.eyebrow') }}</p>
          <h2>{{ t('shortLinkCreate.title') }}</h2>
        </div>
      </div>

      <div class="short-link-create-panel__form">
        <div class="short-link-create-panel__field-row">
          <v-text-field
            v-model="targetUrl"
            class="short-link-create-panel__input"
            :label="t('shortLinkCreate.targetLabel')"
            :placeholder="t('shortLinkCreate.targetPlaceholder')"
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
        <div v-if="!canCreateShortLink" class="short-link-create-panel__permission" role="status">
          {{ t('shortLinkCreate.permissionRequired') }}
        </div>
      </div>

      <Transition name="moe-layout">
        <div v-if="createdUrl" class="short-link-create-panel__result" data-testid="short-link-create-result" role="status">
          <div class="short-link-create-panel__created">
            <strong>{{ t('shortLinkCreate.successTitle') }}</strong>
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
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

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
const queryClient = useQueryClient()
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
    void queryClient.invalidateQueries({ queryKey: ['short-link'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
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
  padding: clamp(16px, 2.6vw, 24px);
  border: 1px solid var(--moeurl-outline);
  border-radius: clamp(28px, 4vw, 40px);
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 7%, transparent), transparent 44%),
    var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.short-link-create-panel__header,
.short-link-create-panel__form,
.short-link-create-panel__result {
  position: relative;
  z-index: 1;
}

.short-link-create-panel__header {
  display: grid;
  margin-bottom: 16px;
  text-align: left;
}

.short-link-create-panel__header h2 {
  margin: 4px 0 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(1.12rem, 2vw, 1.42rem);
  line-height: 1.2;
}

.short-link-create-panel__eyebrow {
  margin: 0;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 900;
}

.short-link-create-panel__form {
  display: grid;
  gap: 12px;
}

.short-link-create-panel__permission {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-secondary)) 22%, transparent);
  border-radius: 20px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 7%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 750;
  text-align: center;
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
  border-radius: var(--moeurl-radius-pill);
}

.short-link-create-panel__result {
  display: grid;
  place-items: center;
  margin: 16px auto 0;
  padding: 16px;
  width: min(560px, 100%);
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent);
  border-radius: 26px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 11%, transparent);
}

.short-link-create-panel__created {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-width: 0;
  text-align: center;
}

.short-link-create-panel__created a {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-primary));
  font-weight: 850;
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
