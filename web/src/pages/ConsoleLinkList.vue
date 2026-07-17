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
        <dl class="console-link-row__stats">
          <div>
            <dt>{{ t('links.stats.visitCount') }}</dt>
            <dd>{{ link.stats?.visitCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>{{ t('links.stats.todayVisitCount') }}</dt>
            <dd>{{ link.stats?.todayVisitCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>{{ t('links.stats.lastVisitedAt') }}</dt>
            <dd>{{ formatVisitedAt(link.stats?.lastVisitedAt) }}</dd>
          </div>
        </dl>
      </div>

      <div class="console-link-row__actions" :data-link-more-id="link.id">
        <v-btn size="small" color="primary" variant="tonal" @click="$emit('copy', link.url)">{{ t('links.actions.copy') }}</v-btn>
        <v-btn size="small" variant="text" :href="link.url" target="_blank" rel="noreferrer">
          {{ t('links.actions.open') }}
        </v-btn>
        <v-btn size="small" variant="text" :to="{ path: '/analytics', query: { shortLinkId: link.id } }">
          {{ t('links.actions.analytics') }}
        </v-btn>
        <button
          class="console-link-row__more"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="openedMoreId === link.id"
          @click="toggleMore(link.id)"
        >
          {{ t('links.actions.more') }}
        </button>
        <div v-if="openedMoreId === link.id" class="console-link-row__more-menu" role="menu">
          <v-btn size="small" variant="text" role="menuitem" :loading="updatingId === link.id" @click="$emit('toggleStatus', link)">
            {{ t(link.status === 'active' ? 'links.actions.disable' : 'links.actions.enable') }}
          </v-btn>
          <v-btn size="small" variant="text" color="error" role="menuitem" :loading="deletingId === link.id" @click="$emit('remove', link.id)">
            {{ t('links.actions.delete') }}
          </v-btn>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export interface ConsoleLinkListItem {
  id: string
  owner?: {
    id: string
    nickname: string
    username: string
  }
  status: 'active' | 'disabled'
  stats?: {
    visitCount: number
    todayVisitCount: number
    lastVisitedAt: string | null
  }
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

watch(openedMoreId, (id, _oldId, onCleanup) => {
  if (!id) {
    return
  }
  globalThis.document?.addEventListener('pointerdown', handleDocumentPointerDown)
  globalThis.document?.addEventListener('keydown', handleDocumentKeyDown)
  onCleanup(removeDocumentListeners)
})

onBeforeUnmount(removeDocumentListeners)

function toggleMore(id: string) {
  openedMoreId.value = openedMoreId.value === id ? '' : id
}

function closeMore() {
  openedMoreId.value = ''
}

function formatVisitedAt(value?: string | null) {
  if (!value) {
    return t('links.stats.neverVisited')
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return t('links.stats.neverVisited')
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function handleDocumentPointerDown(event: globalThis.PointerEvent) {
  const target = event.target
  const activeActions = globalThis.document?.querySelector(`[data-link-more-id="${openedMoreId.value}"]`)
  if (target instanceof globalThis.Node && activeActions?.contains(target)) {
    return
  }
  closeMore()
}

function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
  if (event.key === 'Escape') {
    closeMore()
  }
}

function removeDocumentListeners() {
  globalThis.document?.removeEventListener('pointerdown', handleDocumentPointerDown)
  globalThis.document?.removeEventListener('keydown', handleDocumentKeyDown)
}
</script>
