<template>
  <section class="console-page console-placeholder" :data-testid="`console-page-placeholder-${kind}`">
    <header class="console-page__header">
      <div>
        <h1>{{ t(meta.titleKey) }}</h1>
      </div>
      <span class="console-placeholder__status">{{ t('placeholder.status') }}</span>
    </header>

    <div class="console-placeholder__panel">
      <div>
        <h2>{{ t(meta.panelTitleKey) }}</h2>
        <p>{{ t(meta.descriptionKey) }}</p>
      </div>
    </div>

    <div class="console-placeholder__grid">
      <article v-for="item in meta.items" :key="item" class="console-placeholder__item">
        <span aria-hidden="true" />
        <p>{{ t(`placeholder.${kind}.items.${item}`) }}</p>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

type PlaceholderKind = 'overview' | 'analytics' | 'userGroups' | 'settings'

const props = defineProps<{
  kind: PlaceholderKind
}>()

const { t } = useI18n()

const metadata: Record<
  PlaceholderKind,
  {
    descriptionKey: string
    items: string[]
    panelTitleKey: string
    titleKey: string
  }
> = {
  overview: {
    descriptionKey: 'placeholder.overview.description',
    items: ['links', 'permissions', 'actions'],
    panelTitleKey: 'placeholder.overview.panelTitle',
    titleKey: 'page.overview',
  },
  analytics: {
    descriptionKey: 'placeholder.analytics.description',
    items: ['scope', 'privacy', 'future'],
    panelTitleKey: 'placeholder.analytics.panelTitle',
    titleKey: 'page.analytics',
  },
  userGroups: {
    descriptionKey: 'placeholder.userGroups.description',
    items: ['admin', 'guest', 'groups'],
    panelTitleKey: 'placeholder.userGroups.panelTitle',
    titleKey: 'page.userGroups',
  },
  settings: {
    descriptionKey: 'placeholder.settings.description',
    items: ['domains', 'preferences', 'deployment'],
    panelTitleKey: 'placeholder.settings.panelTitle',
    titleKey: 'page.settings',
  },
}

const meta = computed(() => metadata[props.kind])
</script>
