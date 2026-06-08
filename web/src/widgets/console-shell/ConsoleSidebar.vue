<template>
  <aside class="console-sidebar">
    <RouterLink class="console-sidebar__brand" to="/">
      <span class="console-sidebar__logo">M</span>
      <span class="console-sidebar__brand-text">
        <strong>MoeURL</strong>
        <small>short links</small>
      </span>
    </RouterLink>

    <v-btn class="console-sidebar__action" color="primary" variant="flat" @click="$emit('createShortLink')">
      {{ t('console.newShortLink') }}
    </v-btn>

    <RouterLink class="console-sidebar__home" data-testid="console-sidebar-home" to="/">
      <span class="console-sidebar__home-mark" aria-hidden="true" />
      <span>{{ t('console.backHome') }}</span>
    </RouterLink>

    <nav class="console-sidebar__nav">
      <section v-for="group in navGroups" :key="group.labelKey" class="console-sidebar__nav-group">
        <p class="console-sidebar__nav-label">{{ t(group.labelKey) }}</p>
        <template v-for="item in group.items" :key="item.to || item.labelKey">
          <v-btn
            v-if="item.to"
            :to="item.to"
            class="console-sidebar__nav-item"
            :class="{ 'console-sidebar__nav-item--child': item.level === 2 }"
            variant="text"
          >
            {{ t(item.labelKey) }}
          </v-btn>
          <div v-else class="console-sidebar__nav-subgroup">
            <p>{{ t(item.labelKey) }}</p>
            <v-btn
              v-for="child in item.children"
              :key="child.to"
              :to="child.to"
              class="console-sidebar__nav-item console-sidebar__nav-item--child"
              variant="text"
            >
              {{ t(child.labelKey) }}
            </v-btn>
          </div>
        </template>
      </section>
    </nav>

    <PreferenceSwitcher class="console-sidebar__preferences" />

    <ConsoleAccountCard
      class="console-sidebar__account"
      :display-name="displayName"
      :logout-pending="logoutPending"
      :username="username"
      @logout="$emit('logout')"
    />
  </aside>
</template>

<!--
  Navigation is intentionally grouped here instead of using a flat router list.
  It mirrors the v0.0.3 product IA: workspace first, management second, then
  nested management subjects.
-->
<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import ConsoleAccountCard from './ConsoleAccountCard.vue'

export interface ConsoleNavItem {
  children?: ConsoleNavItem[]
  labelKey: string
  level?: 1 | 2
  to?: string
}

export interface ConsoleNavGroup {
  items: ConsoleNavItem[]
  labelKey: string
}

defineProps<{
  displayName: string
  logoutPending?: boolean
  navGroups: ConsoleNavGroup[]
  username: string
}>()

defineEmits<{
  createShortLink: []
  logout: []
}>()

const { t } = useI18n()
</script>

<style scoped>
.console-sidebar {
  position: sticky;
  top: 18px;
  display: grid;
  min-height: calc(100vh - 36px);
  grid-template-rows: auto auto auto 1fr auto auto;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-page);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--moeurl-surface-glass) 94%, transparent), var(--moeurl-surface-glass)),
    var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow-strong);
  backdrop-filter: blur(24px);
}

.console-sidebar__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
}

.console-sidebar__brand-text {
  display: grid;
  line-height: 1.1;
}

.console-sidebar__brand-text strong {
  font-weight: 950;
}

.console-sidebar__brand-text small {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
  font-weight: 700;
}

.console-sidebar__logo {
  display: inline-grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 16px;
  background:
    linear-gradient(145deg, rgb(var(--v-theme-primary)), color-mix(in srgb, rgb(var(--v-theme-primary)) 74%, black 26%));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 14px 34px color-mix(in srgb, rgb(var(--v-theme-primary)) 26%, transparent);
}

.console-sidebar__action {
  width: 100%;
  min-height: 48px;
  box-shadow: 0 18px 42px color-mix(in srgb, rgb(var(--v-theme-primary)) 22%, transparent);
}

.console-sidebar__home {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 1px dashed color-mix(in srgb, var(--moeurl-outline) 92%, rgb(var(--v-theme-secondary)) 8%);
  border-radius: 22px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 8%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.88rem;
  font-weight: 850;
  text-decoration: none;
}

.console-sidebar__home-mark {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: rgb(var(--v-theme-secondary));
  box-shadow: 0 0 0 5px color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
}

.console-sidebar__nav {
  display: grid;
  align-content: start;
  gap: 18px;
}

.console-sidebar__nav-group,
.console-sidebar__nav-subgroup {
  display: grid;
  gap: 7px;
}

.console-sidebar__nav-label,
.console-sidebar__nav-subgroup p {
  margin: 0;
  padding: 0 10px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.76rem;
  font-weight: 900;
}

.console-sidebar__nav-subgroup {
  margin-top: 2px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 34%, transparent);
}

.console-sidebar__nav-item {
  justify-content: flex-start;
  min-height: 44px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-sidebar__nav-item--child {
  min-height: 40px;
  padding-inline-start: 18px;
  font-size: 0.9rem;
}

.console-sidebar__nav-item.router-link-active,
.console-sidebar__nav-item[aria-current="page"] {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 800;
}

.console-sidebar__preferences {
  align-self: end;
}

.console-sidebar__account {
  align-self: end;
}
</style>
