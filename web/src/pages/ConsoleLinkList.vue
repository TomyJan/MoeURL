<template>
  <div class="console-link-list" data-testid="console-link-list">
    <article v-for="link in links" :key="link.id" class="console-link-row" data-testid="console-link-row">
      <div class="console-link-row__main">
        <span class="console-link-row__label">{{ t('links.shortUrl') }}</span>
        <a :href="link.url" target="_blank" rel="noreferrer">{{ link.url }}</a>
      </div>

      <div class="console-link-row__target">
        <span class="console-link-row__label">{{ t('links.targetUrl') }}</span>
        <span>{{ link.targetUrl }}</span>
      </div>

      <div v-if="link.owner" class="console-link-row__owner">
        <span class="console-link-row__label">{{ t('links.owner') }}</span>
        <strong>{{ link.owner.username }}</strong>
        <small>{{ link.owner.nickname || link.owner.id }}</small>
      </div>

      <div class="console-link-row__meta">
        <span class="console-link-row__status" :class="`console-link-row__status--${link.status}`">
          {{ t(`links.status.${link.status}`) }}
        </span>
      </div>

      <div class="console-link-row__actions">
        <v-btn size="small" color="primary" variant="tonal" @click="$emit('copy', link.url)">{{ t('links.actions.copy') }}</v-btn>
        <v-btn size="small" variant="text" :href="link.url" target="_blank" rel="noreferrer">
          {{ t('links.actions.open') }}
        </v-btn>
        <button class="console-link-row__more" type="button" @click="toggleMore(link.id)">
          {{ t('links.actions.more') }}
        </button>
        <div v-if="openedMoreId === link.id" class="console-link-row__more-menu">
          <v-btn size="small" variant="text" :loading="updatingId === link.id" @click="$emit('toggleStatus', link)">
            {{ t(link.status === 'active' ? 'links.actions.disable' : 'links.actions.enable') }}
          </v-btn>
          <v-btn size="small" variant="text" color="error" :loading="deletingId === link.id" @click="$emit('remove', link.id)">
            {{ t('links.actions.delete') }}
          </v-btn>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface ConsoleLinkListItem {
  id: string
  owner?: {
    id: string
    nickname: string
    username: string
  }
  status: 'active' | 'disabled'
  targetUrl: string
  url: string
}

defineProps<{
  deletingId?: string
  links: ConsoleLinkListItem[]
  updatingId?: string
}>()

defineEmits<{
  copy: [url: string]
  remove: [id: string]
  toggleStatus: [link: ConsoleLinkListItem]
}>()

const { t } = useI18n()
const openedMoreId = ref('')

function toggleMore(id: string) {
  openedMoreId.value = openedMoreId.value === id ? '' : id
}
</script>
