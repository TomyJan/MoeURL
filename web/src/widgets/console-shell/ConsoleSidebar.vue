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
  top: 20px;
  display: grid;
  min-height: calc(100vh - 40px);
  grid-template-rows: auto auto auto 1fr auto auto;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-page);
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
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
  border-radius: 17px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.console-sidebar__action {
  width: 100%;
  min-height: 44px;
  border-radius: var(--moeurl-radius-pill);
  font-weight: 850;
}

.console-sidebar__home {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-secondary)) 38%, var(--moeurl-outline));
  border-radius: 20px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 9%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.88rem;
  font-weight: 850;
  text-decoration: none;
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
  padding: 8px 0 8px 10px;
  border-left: 1px solid var(--moeurl-outline);
  background: transparent;
}

.console-sidebar__nav-item {
  justify-content: flex-start;
  min-height: 40px;
  border-radius: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-sidebar__nav-item--child {
  min-height: 38px;
  padding-inline-start: 18px;
  font-size: 0.9rem;
}

.console-sidebar__nav-item.router-link-active,
.console-sidebar__nav-item[aria-current="page"] {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent);
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
