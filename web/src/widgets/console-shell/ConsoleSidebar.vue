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

    <nav class="console-sidebar__nav">
      <v-btn to="/" class="console-sidebar__nav-item console-sidebar__nav-item--home" variant="text">
        {{ t('console.backHome') }}
      </v-btn>
      <v-btn v-for="item in navItems" :key="item.to" :to="item.to" class="console-sidebar__nav-item" variant="text">
        {{ t(item.labelKey) }}
      </v-btn>
    </nav>

    <ConsoleAccountCard
      class="console-sidebar__account"
      :display-name="displayName"
      :logout-pending="logoutPending"
      :username="username"
      @logout="$emit('logout')"
    />
  </aside>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import ConsoleAccountCard from './ConsoleAccountCard.vue'

export interface ConsoleNavItem {
  labelKey: string
  to: string
}

defineProps<{
  displayName: string
  logoutPending?: boolean
  navItems: ConsoleNavItem[]
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
  grid-template-rows: auto auto 1fr auto;
  gap: 18px;
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

.console-sidebar__nav {
  display: grid;
  align-content: start;
  gap: 8px;
}

.console-sidebar__nav-item {
  justify-content: flex-start;
  min-height: 44px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-sidebar__nav-item.router-link-active,
.console-sidebar__nav-item[aria-current="page"] {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 800;
}

.console-sidebar__account {
  align-self: end;
}
</style>
