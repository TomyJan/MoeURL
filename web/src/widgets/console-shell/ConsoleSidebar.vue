<template>
  <aside class="console-sidebar">
    <RouterLink class="console-sidebar__brand" to="/">
      <span class="console-sidebar__logo">M</span>
      <span class="console-sidebar__brand-text">
        <strong>MoeURL</strong>
        <small>short links</small>
      </span>
    </RouterLink>

    <div class="console-sidebar__quick">
      <v-btn class="console-sidebar__action" color="primary" variant="flat" @click="$emit('createShortLink')">
        <span aria-hidden="true">+</span>
        {{ t('console.newShortLink') }}
      </v-btn>
    </div>

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
            <button
              class="console-sidebar__nav-item console-sidebar__nav-parent"
              type="button"
              :aria-expanded="expandedGroups.has(item.labelKey)"
              @click="toggleGroup(item.labelKey)"
            >
              {{ t(item.labelKey) }}
              <span class="console-sidebar__nav-caret" aria-hidden="true" />
            </button>
            <Transition name="console-nav-children">
              <div v-if="expandedGroups.has(item.labelKey)" class="console-sidebar__nav-children">
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
            </Transition>
          </div>
        </template>
      </section>
    </nav>

    <RouterLink class="console-sidebar__home" data-testid="console-sidebar-home" to="/">
      <span class="console-sidebar__home-mark" aria-hidden="true">↗</span>
      <span>{{ t('console.backHome') }}</span>
    </RouterLink>

    <PreferenceSwitcher class="console-sidebar__preferences" density="compact" placement="sidebar" />

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
import { reactive, watchEffect } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
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

const props = defineProps<{
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
const route = useRoute()
const expandedGroups = reactive(new Set<string>())

watchEffect(() => {
  for (const group of props.navGroups) {
    for (const item of group.items) {
      if (item.children?.some((child) => child.to === route.path)) {
        expandedGroups.add(item.labelKey)
      }
    }
  }
})

function toggleGroup(labelKey: string) {
  if (expandedGroups.has(labelKey)) {
    expandedGroups.delete(labelKey)
    return
  }
  expandedGroups.add(labelKey)
}
</script>

<style scoped>
.console-sidebar {
  position: sticky;
  top: 20px;
  display: grid;
  min-height: calc(100vh - 40px);
  grid-template-rows: auto auto 1fr auto auto auto;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-page);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 96%, var(--moeurl-surface-soft) 4%);
  box-shadow: 0 18px 42px color-mix(in srgb, rgb(var(--v-theme-primary)) 3%, transparent);
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
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, var(--moeurl-surface-strong));
  color: rgb(var(--v-theme-primary));
  font-weight: 900;
}

.console-sidebar__quick {
  display: grid;
  padding: 0;
  background: transparent;
}

.console-sidebar__action {
  width: 100%;
  min-height: 44px;
  border-radius: var(--moeurl-radius-pill);
  box-shadow: 0 12px 24px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  font-weight: 850;
}

.console-sidebar__action :deep(.v-btn__content) {
  gap: 8px;
}

.console-sidebar__home {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--moeurl-radius-pill);
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.84rem;
  font-weight: 850;
  text-decoration: none;
}

.console-sidebar__home:hover {
  border-color: color-mix(in srgb, rgb(var(--v-theme-secondary)) 32%, transparent);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 9%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-sidebar__home-mark {
  display: inline-grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-sidebar__nav {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 4px 2px;
}

.console-sidebar__nav-group,
.console-sidebar__nav-subgroup {
  display: grid;
  gap: 4px;
}

.console-sidebar__nav-label {
  margin: 0;
  padding: 0 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.71rem;
  font-weight: 900;
  text-transform: uppercase;
}

.console-sidebar__nav-subgroup {
  margin: 0;
  padding: 0;
  background: transparent;
}

.console-sidebar__nav-children {
  display: grid;
  gap: 4px;
  margin: 2px 0 4px 14px;
  padding-left: 9px;
  border-left: 1px solid var(--moeurl-outline-strong);
}

.console-sidebar__nav-caret {
  width: 8px;
  height: 8px;
  margin-left: auto;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(-45deg);
  transition: transform 180ms ease;
}

.console-sidebar__nav-item {
  justify-content: flex-start;
  min-height: 38px;
  border-radius: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 760;
}

.console-sidebar__nav-parent {
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.console-sidebar__nav-parent[aria-expanded="true"] .console-sidebar__nav-caret {
  transform: rotate(45deg) translateY(-1px);
}

.console-sidebar__nav-item::before {
  width: 3px;
  height: 16px;
  margin-inline-end: 6px;
  border-radius: 999px;
  background: transparent;
  content: "";
}

.console-sidebar__nav-item--child {
  min-height: 34px;
  margin-left: 0;
  padding-inline-start: 8px;
  font-size: 0.9rem;
}

.console-sidebar__nav-item.router-link-active,
.console-sidebar__nav-item[aria-current="page"] {
  background: color-mix(in srgb, var(--moeurl-surface-strong) 48%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 860;
}

.console-sidebar__nav-item.router-link-active::before,
.console-sidebar__nav-item[aria-current="page"]::before {
  background: rgb(var(--v-theme-secondary));
}

.console-sidebar__preferences {
  align-self: end;
  padding-top: 12px;
  border-top: 1px solid var(--moeurl-outline);
}

.console-sidebar__account {
  align-self: end;
}

.console-nav-children-enter-active,
.console-nav-children-leave-active {
  overflow: hidden;
  transition: opacity 170ms ease, transform 170ms ease, max-height 170ms ease;
}

.console-nav-children-enter-from,
.console-nav-children-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.console-nav-children-enter-to,
.console-nav-children-leave-from {
  max-height: 180px;
  opacity: 1;
  transform: translateY(0);
}
</style>
