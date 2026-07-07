<template>
  <header class="console-topbar">
    <button class="console-topbar__menu" type="button" :aria-label="t('console.openMenu')" @click="$emit('openMenu')">
      <MoeIcon name="menu" data-testid="console-icon-menu" />
    </button>
    <RouterLink class="console-topbar__brand" to="/">MoeURL</RouterLink>
    <PreferenceSwitcher class="console-topbar__preferences" density="compact" placement="topbar" />
    <v-btn color="primary" variant="flat" @click="$emit('createShortLink')">{{ t('console.newShortLink') }}</v-btn>
    <div ref="accountRef" class="console-topbar__account">
      <button
        class="console-topbar__avatar"
        type="button"
        :aria-expanded="accountOpen"
        :aria-label="t('console.openAccountMenu')"
        @click="accountOpen = !accountOpen"
      >
        {{ avatarText }}
      </button>
      <Transition name="console-account-menu">
        <div v-if="accountOpen" class="console-topbar__account-menu" data-testid="console-mobile-account-menu" role="menu">
          <span class="console-topbar__account-name">
            <strong>{{ displayName }}</strong>
            <small>{{ username }}</small>
          </span>
          <button type="button" role="menuitem" :disabled="logoutPending" @click="submitLogout">
            {{ t('nav.logout') }}
          </button>
        </div>
      </Transition>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import MoeIcon from '@/shared/ui/MoeIcon.vue'
import { useAvatarText } from '@/shared/user/useAvatarText'

const props = defineProps<{
  displayName: string
  logoutPending?: boolean
  username: string
}>()

const { t } = useI18n()
const emit = defineEmits<{
  createShortLink: []
  logout: []
  openMenu: []
}>()
const accountRef = ref<globalThis.HTMLElement | null>(null)
const accountOpen = ref(false)
const displayName = computed(() => props.displayName)
const avatarText = useAvatarText(displayName)

function submitLogout() {
  accountOpen.value = false
  emit('logout')
}

function closeAccountMenu() {
  accountOpen.value = false
}

function handlePointerDown(event: globalThis.PointerEvent) {
  const target = event.target
  if (target instanceof globalThis.Node && accountRef.value?.contains(target)) {
    return
  }
  closeAccountMenu()
}

function handleKeyDown(event: globalThis.KeyboardEvent) {
  if (event.key === 'Escape') {
    closeAccountMenu()
  }
}

onMounted(() => {
  globalThis.document?.addEventListener('pointerdown', handlePointerDown)
  globalThis.document?.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  globalThis.document?.removeEventListener('pointerdown', handlePointerDown)
  globalThis.document?.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
.console-topbar {
  display: none;
  position: sticky;
  top: 10px;
  z-index: 15;
  align-items: center;
  gap: 10px;
  margin: 10px 10px 8px;
  padding: 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 28px;
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.console-topbar__menu {
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid var(--moeurl-outline);
  border-radius: 18px;
  background: color-mix(in srgb, var(--moeurl-surface-soft) 76%, transparent);
  cursor: pointer;
}

.console-topbar__menu :deep(.moe-icon) {
  width: 19px;
  height: 19px;
  color: rgb(var(--v-theme-on-surface));
}

.console-topbar__brand {
  flex: 1;
  color: rgb(var(--v-theme-on-background));
  font-weight: 900;
  text-decoration: none;
}

.console-topbar__account {
  position: relative;
  display: inline-grid;
}

.console-topbar__avatar {
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 0;
  border-radius: 18px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  cursor: pointer;
  font-weight: 800;
}

.console-topbar__account-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 30;
  display: grid;
  min-width: 190px;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 22px;
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow-strong);
}

.console-topbar__account-name {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.console-topbar__account-name strong,
.console-topbar__account-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-topbar__account-name small {
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-topbar__account-menu button {
  min-height: 36px;
  border: 0;
  border-radius: 18px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 12%, transparent);
  color: rgb(var(--v-theme-secondary));
  cursor: pointer;
  font: inherit;
  font-weight: 820;
}

.console-topbar__account-menu button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.console-account-menu-enter-active,
.console-account-menu-leave-active {
  transform-origin: top right;
  transition: opacity 160ms ease, transform 160ms ease;
}

.console-account-menu-enter-from,
.console-account-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

@media (max-width: 720px) {
  .console-topbar__preferences {
    display: none;
  }
}

@media (max-width: 900px) {
  .console-topbar {
    display: flex;
  }
}
</style>
