<template>
  <div class="console-shell">
    <ConsoleSidebar
      class="console-shell__sidebar"
      :display-name="displayName"
      :logout-pending="logoutMutation.isPending.value"
      :nav-groups="navGroups"
      :username="username"
      @create-short-link="openCreatePanel"
      @logout="submitLogout"
    />
    <ConsoleTopbar
      :display-name="displayName"
      :logout-pending="logoutMutation.isPending.value"
      :username="username"
      @create-short-link="openCreatePanel"
      @logout="submitLogout"
      @open-menu="mobileNavOpen = true"
    />

    <Transition name="moe-overlay">
      <div v-if="mobileNavOpen" class="console-shell__mobile-nav" data-testid="console-mobile-nav">
        <div class="console-shell__mobile-panel moe-overlay-panel" data-testid="console-drawer-transition">
          <div class="console-shell__mobile-head">
            <RouterLink class="console-shell__mobile-brand" to="/" @click="closeMobileNav">MoeURL</RouterLink>
            <button class="console-shell__mobile-close" type="button" @click="mobileNavOpen = false">
              {{ t('console.closeMenu') }}
            </button>
          </div>
          <div class="console-shell__mobile-utilities" data-testid="console-mobile-utilities">
            <RouterLink class="console-shell__mobile-home" data-testid="console-mobile-home" to="/" @click="closeMobileNav">
              <span class="console-shell__mobile-home-mark" aria-hidden="true">
                <MoeIcon name="home" />
              </span>
              <span>{{ t('console.backHome') }}</span>
            </RouterLink>
            <PreferenceSwitcher density="compact" placement="sidebar" />
          </div>
          <div class="console-shell__mobile-quick">
            <v-btn class="console-shell__mobile-create" color="primary" variant="flat" @click="openCreatePanel">
              <span aria-hidden="true">+</span>
              {{ t('console.newShortLink') }}
            </v-btn>
          </div>
          <ConsoleNavList :nav-groups="navGroups" variant="mobile" @navigate="closeMobileNav" />
        </div>
      </div>
    </Transition>

    <main class="console-shell__main">
      <Transition name="moe-layout" mode="out-in">
        <div :key="route.path || 'console'" class="console-shell__workspace">
          <slot>
            <RouterView />
          </slot>
        </div>
      </Transition>
    </main>

    <Transition name="moe-overlay">
      <div v-if="createPanelOpen" class="console-shell__dialog" role="dialog" aria-modal="true">
        <section class="console-shell__dialog-panel moe-overlay-panel" data-testid="console-create-transition">
          <div class="console-shell__dialog-heading">
            <h2>{{ t('console.createShortLink') }}</h2>
            <button type="button" @click="createPanelOpen = false">{{ t('console.closeCreate') }}</button>
          </div>
          <ShortLinkCreatePanel mode="compact" />
        </section>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { logout, me } from '@/entities/auth/api'
import ShortLinkCreatePanel from '@/features/short-link-create/ShortLinkCreatePanel.vue'
import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import MoeIcon from '@/shared/ui/MoeIcon.vue'
import ConsoleNavList from './ConsoleNavList.vue'
import ConsoleSidebar from './ConsoleSidebar.vue'
import ConsoleTopbar from './ConsoleTopbar.vue'
import type { ConsoleNavGroup } from './ConsoleNavList.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
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
const navGroups = computed<ConsoleNavGroup[]>(() => {
  const groups: ConsoleNavGroup[] = []
  if (permissions.value.includes('short_link:read_own')) {
    groups.push({
      labelKey: 'console.nav.workspace',
      items: [
        { labelKey: 'nav.overview', planned: true, to: '/console' },
        { labelKey: 'nav.links', to: '/link' },
        { labelKey: 'nav.analytics', planned: true, to: '/analytics' },
      ],
    })
  }
  if (permissions.value.includes('admin:access')) {
    groups.push({
      labelKey: 'nav.admin',
      items: [
        { labelKey: 'page.adminLinks', to: '/admin/link' },
        {
          labelKey: 'console.nav.userManagement',
          children: [
            { labelKey: 'nav.users', level: 2, to: '/admin/user' },
            { labelKey: 'nav.userGroups', level: 2, planned: true, to: '/admin/user/group' },
          ],
        },
        { labelKey: 'nav.settings', planned: true, to: '/admin/setting' },
      ],
    })
  }
  return groups
})

const logoutMutation = useMutation({
  mutationFn: logout,
  onSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    void router.push('/login')
  },
})

function closeMobileNav() {
  mobileNavOpen.value = false
}

function openCreatePanel() {
  createPanelOpen.value = true
  closeMobileNav()
}

function submitLogout() {
  logoutMutation.mutate()
}

</script>

<style scoped>
.console-shell {
  display: grid;
  min-height: 100vh;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
  padding: 18px;
  background:
    radial-gradient(circle at 8% -10%, var(--moeurl-hero-glow), transparent 22rem),
    var(--moeurl-surface-workspace);
}

.console-shell__main {
  min-width: 0;
  padding: 0;
  border-radius: var(--moeurl-radius-page);
  background: transparent;
}

.console-shell__workspace {
  min-height: calc(100vh - 36px);
  padding: clamp(22px, 3vw, 36px);
  border-radius: var(--moeurl-radius-page);
  background: transparent;
}

.console-shell__mobile-nav,
.console-shell__dialog {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  background: color-mix(in srgb, black 76%, rgb(var(--v-theme-background)) 24%);
  backdrop-filter: blur(14px);
}

.console-shell__mobile-panel {
  position: relative;
  z-index: 1;
  display: grid;
  align-content: start;
  gap: 14px;
  width: min(340px, calc(100% - 32px));
  height: calc(100% - 32px);
  margin: 16px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 90%, transparent);
  border-radius: var(--moeurl-radius-panel);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 96%, var(--moeurl-surface-soft) 4%);
  box-shadow: var(--moeurl-shadow-strong);
}

.console-shell__mobile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.console-shell__mobile-brand {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 900;
  text-decoration: none;
}

.console-shell__mobile-quick {
  display: grid;
  gap: 10px;
  padding: 0;
  background: transparent;
}

.console-shell__mobile-create {
  min-height: 46px;
}

.console-shell__mobile-create :deep(.v-btn__content) {
  gap: 8px;
}

.console-shell__mobile-utilities {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 86%, transparent);
  border-radius: 28px;
  background: color-mix(in srgb, var(--moeurl-surface-strong) 34%, transparent);
}

.console-shell__mobile-home {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 40px;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 20px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 850;
  text-decoration: none;
}

.console-shell__mobile-home span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-shell__mobile-home:hover {
  border-color: color-mix(in srgb, rgb(var(--v-theme-secondary)) 32%, transparent);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 9%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-shell__mobile-home-mark {
  display: inline-grid;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-shell__mobile-home-mark :deep(.moe-icon) {
  width: 15px;
  height: 15px;
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
  border: 1px solid var(--moeurl-outline);
  background: var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow-strong);
  backdrop-filter: blur(24px);
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
    padding: 0;
    border-radius: 0;
  }

  .console-shell__workspace {
    min-height: calc(100vh - 90px);
    padding: 16px;
    border-radius: 30px;
  }

  .console-shell__dialog {
    align-items: end;
  }

  .console-shell__dialog-panel {
    border-radius: 32px 32px 0 0;
  }
}
</style>
