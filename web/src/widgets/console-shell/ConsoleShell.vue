<template>
  <div class="console-shell">
    <ConsoleSidebar
      class="console-shell__sidebar"
      :display-name="displayName"
      :logout-pending="logoutMutation.isPending.value"
      :nav-items="navItems"
      :username="username"
      @create-short-link="openCreatePanel"
      @logout="submitLogout"
    />
    <ConsoleTopbar
      :display-name="displayName"
      @create-short-link="openCreatePanel"
      @open-menu="mobileNavOpen = true"
    />

    <div v-if="mobileNavOpen" class="console-shell__mobile-nav" data-testid="console-mobile-nav">
      <div class="console-shell__mobile-panel">
        <button class="console-shell__mobile-close" type="button" @click="mobileNavOpen = false">
          {{ t('console.closeMenu') }}
        </button>
        <v-btn color="primary" variant="flat" @click="openCreatePanel">{{ t('console.newShortLink') }}</v-btn>
        <nav>
          <v-btn v-for="item in navItems" :key="item.to" :to="item.to" variant="text">
            {{ t(item.labelKey) }}
          </v-btn>
        </nav>
      </div>
    </div>

    <main class="console-shell__main">
      <slot>
        <RouterView />
      </slot>
    </main>

    <div v-if="createPanelOpen" class="console-shell__dialog" role="dialog" aria-modal="true">
      <section class="console-shell__dialog-panel">
        <div class="console-shell__dialog-heading">
          <h2>{{ t('console.createShortLink') }}</h2>
          <button type="button" @click="createPanelOpen = false">{{ t('console.closeCreate') }}</button>
        </div>
        <ShortLinkCreatePanel mode="compact" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { logout, me } from '@/entities/auth/api'
import ShortLinkCreatePanel from '@/features/short-link-create/ShortLinkCreatePanel.vue'
import ConsoleSidebar from './ConsoleSidebar.vue'
import ConsoleTopbar from './ConsoleTopbar.vue'
import type { ConsoleNavItem } from './ConsoleSidebar.vue'

const { t } = useI18n()
const queryClient = useQueryClient()
const mobileNavOpen = ref(false)
const createPanelOpen = ref(false)
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})

const currentUser = computed(() => currentUserQuery.data.value?.user)
const displayName = computed(() => currentUser.value?.nickname || currentUser.value?.username || 'guest')
const username = computed(() => currentUser.value?.username || 'guest')
const permissions = computed(() => currentUser.value?.permissions ?? [])
const navItems = computed<ConsoleNavItem[]>(() => {
  const items: ConsoleNavItem[] = []
  if (permissions.value.includes('short_link:read_own')) {
    items.push({ labelKey: 'nav.links', to: '/link' })
  }
  if (permissions.value.includes('admin:access')) {
    items.push(
      { labelKey: 'nav.admin', to: '/admin/link' },
      { labelKey: 'nav.users', to: '/admin/user' },
      { labelKey: 'page.createUser', to: '/admin/user/new' },
    )
  }
  return items
})
const logoutMutation = useMutation({
  mutationFn: logout,
  onSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  },
})

function openCreatePanel() {
  createPanelOpen.value = true
  mobileNavOpen.value = false
}

function submitLogout() {
  logoutMutation.mutate()
}
</script>

<style scoped>
.console-shell {
  display: grid;
  min-height: 100vh;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 22px;
  padding: 18px;
  background:
    radial-gradient(circle at 10% 8%, rgba(240, 169, 79, 0.12), transparent 26%),
    rgb(var(--v-theme-background));
}

.console-shell__main {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-page);
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 84%, transparent);
  box-shadow: var(--moeurl-shadow);
}

.console-shell__mobile-nav,
.console-shell__dialog {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  background: rgba(0, 0, 0, 0.32);
}

.console-shell__mobile-panel {
  display: grid;
  align-content: start;
  gap: 14px;
  width: min(340px, calc(100% - 32px));
  height: calc(100% - 32px);
  margin: 16px;
  padding: 18px;
  border-radius: var(--moeurl-radius-panel);
  background: rgb(var(--v-theme-surface));
}

.console-shell__mobile-panel nav {
  display: grid;
  gap: 8px;
}

.console-shell__mobile-close,
.console-shell__dialog-heading button {
  justify-self: end;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.console-shell__dialog {
  place-items: center;
  padding: 16px;
}

.console-shell__dialog-panel {
  display: grid;
  gap: 16px;
  width: min(680px, 100%);
  padding: 22px;
  border-radius: var(--moeurl-radius-page);
  background: rgb(var(--v-theme-surface));
}

.console-shell__dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.console-shell__dialog-heading h2 {
  margin: 0;
  font-size: 1.25rem;
}

@media (max-width: 900px) {
  .console-shell {
    display: block;
    padding: 0;
  }

  .console-shell__sidebar {
    display: none;
  }

  .console-shell__main {
    margin: 0 12px 12px;
    padding: 16px;
    border-radius: 32px;
  }

  .console-shell__dialog {
    align-items: end;
  }

  .console-shell__dialog-panel {
    border-radius: 32px 32px 0 0;
  }
}
</style>
