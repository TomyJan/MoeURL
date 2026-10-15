<template>
  <v-table class="moe-data-table link-table" :class="{ 'link-table--owned': hasOwners }" density="comfortable" data-testid="console-link-list">
    <colgroup>
      <col class="link-table__short-column" />
      <col class="link-table__target-column" />
      <col v-if="hasOwners" class="link-table__owner-column" />
      <col class="link-table__access-column" />
      <col class="link-table__stats-column" />
      <col class="link-table__actions-column" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col">{{ t('links.shortUrl') }}</th>
        <th scope="col">{{ t('links.targetUrl') }}</th>
        <th v-if="hasOwners" scope="col">{{ t('links.owner') }}</th>
        <th scope="col">{{ t('links.headers.access') }}</th>
        <th scope="col">{{ t('links.headers.statistics') }}</th>
        <th scope="col">{{ t('links.headers.actions') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="link in links" :key="link.id" data-testid="console-link-row">
        <td>
          <div class="link-table__stack console-link-row__main">
            <a class="link-table__url" :href="link.url" :title="link.url" target="_blank" rel="noreferrer">{{ link.url }}</a>
            <div v-if="link.title || link.tags.length" class="link-table__metadata" data-testid="link-metadata">
              <strong v-if="link.title">{{ link.title }}</strong>
              <ul v-if="link.tags.length" class="link-table__tags" :aria-label="t('linkMetadata.tagList')">
                <li v-for="tag in link.tags" :key="tag"><v-chip size="x-small" variant="tonal">{{ tag }}</v-chip></li>
              </ul>
            </div>
          </div>
        </td>
        <td class="console-link-row__target">
          <a class="link-table__url link-table__target" :href="link.targetUrl" :title="link.targetUrl" target="_blank" rel="noreferrer">{{ link.targetUrl }}</a>
        </td>
        <td v-if="hasOwners">
          <div v-if="link.owner" class="link-table__stack">
            <strong>{{ link.owner.username }}</strong>
            <small>{{ link.owner.nickname || link.owner.id }}</small>
          </div>
        </td>
        <td>
          <div class="link-table__stack">
            <div class="link-table__badges">
              <v-chip size="small" variant="tonal" :color="link.status === 'active' ? 'success' : undefined">{{ t(`links.status.${link.status}`) }}</v-chip>
              <v-chip v-if="link.passwordEnabled" size="x-small" color="secondary" variant="tonal">{{ t('links.passwordProtected') }}</v-chip>
            </div>
            <small>{{ t(`shortLinkCreate.redirectModes.${link.redirectMode}`) }}</small>
            <small v-if="link.expired" class="text-error">{{ t('links.expired') }}</small>
            <small v-else>{{ formatExpiration(link.expiresAt) }}</small>
            <div v-if="link.maxVisits !== null" class="link-table__stack link-table__quota" data-testid="visit-limit">
              <small>{{ t('visitLimit.usage', { used: link.visitsUsed, maximum: link.maxVisits, remaining: link.visitsRemaining }) }}</small>
              <small v-if="link.exhausted" class="text-error">{{ t('visitLimit.exhausted') }}</small>
            </div>
          </div>
        </td>
        <td>
          <dl class="link-table__stats">
            <div><dt>{{ t('links.stats.visitCount') }}</dt><dd>{{ link.stats?.visitCount ?? 0 }}</dd></div>
            <div><dt>{{ t('links.stats.todayVisitCount') }}</dt><dd>{{ link.stats?.todayVisitCount ?? 0 }}</dd></div>
            <div><dt>{{ t('links.stats.lastVisitedAt') }}</dt><dd>{{ formatVisitedAt(link.stats?.lastVisitedAt) }}</dd></div>
          </dl>
        </td>
        <td>
          <div class="link-table__actions">
            <v-btn size="small" color="primary" variant="tonal" @click="$emit('copy', link.url)">{{ t('links.actions.copy') }}</v-btn>
            <v-btn size="small" variant="text" :to="analyticsScope === 'admin' ? `/admin/link/${encodeURIComponent(link.id)}/analytics` : `/link/${encodeURIComponent(link.id)}/analytics`">{{ t('links.actions.analytics') }}</v-btn>
            <v-menu location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn v-bind="menuProps" size="small" variant="text">{{ t('links.actions.more') }}</v-btn>
              </template>
              <v-list density="compact" role="menu" :aria-label="t('links.actions.more')">
                <v-list-item role="menuitem" :href="link.url" target="_blank" rel="noreferrer">{{ t('links.actions.open') }}</v-list-item>
                <v-list-item tag="div" role="menuitem" @click="$emit('configure', link)">{{ t('links.actions.configure') }}</v-list-item>
                <v-list-item tag="div" role="menuitem" @click="$emit('qr', link)">{{ t('links.actions.qrCode') }}</v-list-item>
                <v-list-item tag="div" role="menuitem" :disabled="updatingId === link.id" :aria-disabled="updatingId === link.id" @click="$emit('toggleStatus', link)">{{ t(link.status === 'active' ? 'links.actions.disable' : 'links.actions.enable') }}</v-list-item>
                <v-list-item tag="div" role="menuitem" class="text-error" :disabled="deletingId === link.id" :aria-disabled="deletingId === link.id" @click="$emit('remove', link.id)">{{ t('links.actions.delete') }}</v-list-item>
              </v-list>
            </v-menu>
          </div>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { RedirectMode } from '@/entities/short-link/model'

export interface ConsoleLinkListItem {
  id: string
  slug: string
  owner?: {
    id: string
    nickname: string
    username: string
  }
  status: 'active' | 'disabled'
  redirectMode: RedirectMode
  intermediateDelaySeconds: number
  expiresAt: string | null
  expired: boolean
  passwordEnabled: boolean
  maxVisits: number | null
  visitsUsed: number
  visitsRemaining: number | null
  exhausted: boolean
  stats?: {
    visitCount: number
    todayVisitCount: number
    lastVisitedAt: string | null
  }
  targetUrl: string
  title: string
  tags: string[]
  url: string
}

const props = withDefaults(defineProps<{
  analyticsScope?: 'own' | 'admin'
  deletingId?: string
  links: ConsoleLinkListItem[]
  updatingId?: string
}>(), { analyticsScope: 'own', deletingId: undefined, updatingId: undefined })

defineEmits<{
  configure: [link: ConsoleLinkListItem]
  copy: [url: string]
  qr: [link: ConsoleLinkListItem]
  remove: [id: string]
  toggleStatus: [link: ConsoleLinkListItem]
}>()

const { t } = useI18n()
const hasOwners = computed(() => props.links.some((link) => link.owner))

/** Formats an optional last-visit date with the product fallback label. */
function formatVisitedAt(value?: string | null) {
  return formatLocalDate(value, t('links.stats.neverVisited'))
}

/** Formats an expiration timestamp with local date and minute precision. */
function formatExpiration(value: string | null) {
  if (!value) {
    return t('links.neverExpires')
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return t('links.neverExpires')
  }
  return `${formatLocalDate(value, t('links.neverExpires'))} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Formats a valid timestamp as YYYY-MM-DD or returns the supplied fallback. */
function formatLocalDate(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

</script>

<style scoped>
.link-table { --moe-table-min-width: 1080px; }
.link-table--owned { --moe-table-min-width: 1230px; }
.link-table__short-column { width: 25%; }
.link-table__target-column { width: 22%; }
.link-table__owner-column { width: 13%; }
.link-table__access-column { width: 20%; }
.link-table__stats-column { width: 17%; }
.link-table__actions-column { width: 210px; }
.link-table--owned .link-table__short-column { width: 21%; }
.link-table--owned .link-table__target-column { width: 18%; }
.link-table--owned .link-table__access-column { width: 18%; }
.link-table__stack, .link-table__metadata { display: grid; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.link-table__url { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-table__target, .link-table small, .link-table__stats dt { color: rgb(var(--v-theme-on-surface-variant)); }
.link-table__metadata strong { font-size: 0.875rem; white-space: pre-wrap; }
.link-table__tags, .link-table__badges, .link-table__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.link-table__tags { padding: 0; margin: 0; list-style: none; }
.link-table__tags li { min-width: 0; max-width: 100%; }
.link-table__tags :deep(.v-chip) { height: auto; min-height: 20px; max-width: 100%; }
.link-table__tags :deep(.v-chip__content) { white-space: pre-wrap; overflow-wrap: anywhere; }
.link-table__quota { margin-top: 2px; }
.link-table__stats { display: grid; gap: 5px; margin: 0; font-size: 0.8rem; }
.link-table__stats > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; }
.link-table__stats dd { margin: 0; font-variant-numeric: tabular-nums; }
.link-table__actions { gap: 2px; }
</style>
