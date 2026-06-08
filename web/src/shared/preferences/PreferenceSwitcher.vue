<template>
  <div
    ref="switcherRef"
    class="preference-switcher"
    :class="[`preference-switcher--${density}`, `preference-switcher--${placement}`]"
    role="group"
    aria-label="app preferences"
  >
    <div class="preference-switcher__menu">
      <button
        class="preference-switcher__trigger preference-switcher__trigger--icon"
        type="button"
        :aria-label="t('preferences.language')"
        :aria-expanded="languageOpen"
        @click="toggleLanguageMenu"
      >
        <span class="preference-switcher__mark preference-switcher__mark--language" aria-hidden="true">Aa</span>
      </button>
      <Transition name="preference-popover">
        <div v-if="languageOpen" class="preference-switcher__popover" role="menu" :aria-label="t('preferences.languageOptions')">
          <button
            v-for="option in languageChoices"
            :key="option.value"
            class="preference-switcher__option"
            type="button"
            role="menuitemradio"
            :aria-label="option.label"
            :aria-checked="language === option.value"
            @click="selectLanguage(option.value)"
          >
            <span class="preference-switcher__option-code">{{ option.code }}</span>
            <span class="preference-switcher__option-label">{{ option.label }}</span>
            <span class="preference-switcher__option-check" aria-hidden="true" />
          </button>
        </div>
      </Transition>
    </div>

    <div class="preference-switcher__menu">
      <button
        class="preference-switcher__trigger preference-switcher__trigger--icon"
        type="button"
        :aria-label="t('preferences.theme')"
        :aria-expanded="themeOpen"
        @click="toggleThemeMenu"
      >
        <span class="preference-switcher__mark preference-switcher__mark--theme" :class="`preference-switcher__mark--${themeMode}`" aria-hidden="true">
          <span />
        </span>
      </button>
      <Transition name="preference-popover">
        <div
          v-if="themeOpen"
          class="preference-switcher__popover preference-switcher__popover--theme"
          role="menu"
          :aria-label="t('preferences.themeOptions')"
        >
          <button
            v-for="option in themeChoices"
            :key="option.value"
            class="preference-switcher__theme-option"
            type="button"
            role="menuitemradio"
            data-testid="theme-choice"
            :aria-checked="themeMode === option.value"
            :aria-label="option.label"
            @click="selectTheme(option.value)"
          >
            <span class="preference-switcher__theme-graphic" :class="`preference-switcher__theme-graphic--${option.value}`" aria-hidden="true">
              <span />
            </span>
            <span class="preference-switcher__theme-copy">
              <span class="preference-switcher__theme-label">{{ option.label }}</span>
              <small>{{ option.description }}</small>
            </span>
            <span class="preference-switcher__option-check" aria-hidden="true" />
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { LanguagePreference, ThemePreference } from './preferences'
import { useAppPreferences } from './useAppPreferences'

withDefaults(
  defineProps<{
    density?: 'comfortable' | 'compact'
    placement?: 'inline' | 'sidebar' | 'topbar'
  }>(),
  {
    density: 'comfortable',
    placement: 'inline',
  },
)

const { language, setLanguage, setTheme, themeMode } = useAppPreferences()
const { t } = useI18n()
const switcherRef = ref<globalThis.HTMLElement | null>(null)
const languageOpen = ref(false)
const themeOpen = ref(false)

const languageChoices = computed<Array<{ code: string; label: string; value: LanguagePreference }>>(() => [
  { code: '中', label: '中文', value: 'zh-CN' },
  { code: 'En', label: 'English', value: 'en' },
])

const themeChoices = computed<Array<{ description: string; label: string; value: ThemePreference }>>(() => [
  { description: t('preferences.systemDescription'), label: t('preferences.system'), value: 'system' },
  { description: t('preferences.lightDescription'), label: t('preferences.light'), value: 'light' },
  { description: t('preferences.darkDescription'), label: t('preferences.dark'), value: 'dark' },
])

function toggleLanguageMenu() {
  languageOpen.value = !languageOpen.value
  if (languageOpen.value) {
    themeOpen.value = false
  }
}

function toggleThemeMenu() {
  themeOpen.value = !themeOpen.value
  if (themeOpen.value) {
    languageOpen.value = false
  }
}

function selectLanguage(value: LanguagePreference) {
  setLanguage(value)
  languageOpen.value = false
}

function selectTheme(value: ThemePreference) {
  setTheme(value)
  themeOpen.value = false
}

function closeMenus() {
  languageOpen.value = false
  themeOpen.value = false
}

function handlePointerDown(event: globalThis.PointerEvent) {
  const target = event.target
  if (target instanceof globalThis.Node && switcherRef.value?.contains(target)) {
    return
  }
  closeMenus()
}

function handleKeyDown(event: globalThis.KeyboardEvent) {
  if (event.key === 'Escape') {
    closeMenus()
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
.preference-switcher {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.preference-switcher--sidebar {
  display: flex;
  justify-content: flex-start;
  width: auto;
  gap: 8px;
}

.preference-switcher__menu {
  position: relative;
}

.preference-switcher__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  width: 42px;
  padding: 0;
  border: 1px solid var(--moeurl-outline);
  border-radius: 999px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 76%, var(--moeurl-surface-soft) 24%);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 820;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease;
}

.preference-switcher__trigger:hover,
.preference-switcher__option:hover,
.preference-switcher__theme-option:hover {
  border-color: color-mix(in srgb, rgb(var(--v-theme-secondary)) 34%, var(--moeurl-outline));
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 8%, var(--moeurl-surface-elevated));
}

.preference-switcher__trigger:hover {
  transform: translateY(-1px);
}

.preference-switcher__mark {
  display: inline-grid;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 13%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.72rem;
  font-weight: 950;
  line-height: 1;
}

.preference-switcher__mark--theme {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent);
}

.preference-switcher__mark--light {
  background: #f6fbf8;
}

.preference-switcher__mark--light span {
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: #f0a94f;
  box-shadow: 0 0 0 4px rgba(240, 169, 79, 0.18);
}

.preference-switcher__mark--dark {
  background: #10211e;
}

.preference-switcher__mark--dark span {
  width: 15px;
  height: 15px;
  border-radius: 999px;
  background: #65d6b1;
  box-shadow: -5px -2px 0 0 #10211e;
  transform: translateX(2px);
}

.preference-switcher__mark--system {
  background: linear-gradient(135deg, #f6fbf8 0 50%, #10211e 50% 100%);
}

.preference-switcher__popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 80;
  display: grid;
  min-width: 172px;
  gap: 6px;
  padding: 9px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 24px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 96%, var(--moeurl-surface-soft) 4%);
  box-shadow: var(--moeurl-shadow-strong);
}

.preference-switcher--sidebar .preference-switcher__popover {
  top: auto;
  bottom: calc(100% + 8px);
  right: auto;
  left: 0;
}

.preference-switcher__popover--theme {
  min-width: 238px;
  grid-template-columns: 1fr;
}

.preference-switcher--sidebar .preference-switcher__popover--theme {
  left: 50%;
  right: auto;
}

.preference-switcher__option,
.preference-switcher__theme-option {
  position: relative;
  display: grid;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 15px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 800;
  text-align: left;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.preference-switcher__option {
  grid-template-columns: auto minmax(0, 1fr) 12px;
  padding: 10px;
}

.preference-switcher__theme-option {
  grid-template-columns: auto minmax(0, 1fr) 12px;
  min-width: 0;
  padding: 9px 10px;
}

.preference-switcher__option[aria-checked="true"],
.preference-switcher__theme-option[aria-checked="true"] {
  border-color: color-mix(in srgb, rgb(var(--v-theme-secondary)) 32%, transparent);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 11%, transparent);
  color: rgb(var(--v-theme-primary));
}

.preference-switcher__option-check {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: transparent;
}

.preference-switcher__option-code {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent);
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 950;
}

.preference-switcher__option[aria-checked="true"] .preference-switcher__option-check,
.preference-switcher__theme-option[aria-checked="true"] .preference-switcher__option-check {
  background: rgb(var(--v-theme-secondary));
}

.preference-switcher__theme-graphic {
  position: relative;
  display: grid;
  width: 34px;
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 80%, transparent);
  border-radius: 12px;
  overflow: hidden;
}

.preference-switcher__theme-copy {
  display: grid;
  gap: 1px;
}

.preference-switcher__theme-copy small {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.72rem;
  font-weight: 650;
}

.preference-switcher__theme-graphic span {
  align-self: end;
  justify-self: end;
  width: 11px;
  height: 11px;
  margin: 3px;
  border-radius: 999px;
  background: rgb(var(--v-theme-secondary));
}

.preference-switcher__theme-graphic--system {
  background: linear-gradient(90deg, #eff6f2 0 50%, #10211e 50% 100%);
}

.preference-switcher__theme-graphic--light {
  background: linear-gradient(135deg, #ffffff, #eff6f2 58%, #f0a94f 130%);
}

.preference-switcher__theme-graphic--dark {
  background: linear-gradient(135deg, #10211e, #17231f 58%, #65d6b1 150%);
}

.preference-switcher--compact .preference-switcher__trigger {
  min-height: 40px;
  width: 40px;
  font-size: 0.76rem;
}

.preference-switcher--compact .preference-switcher__mark {
  width: 28px;
  height: 28px;
}

.preference-popover-enter-active,
.preference-popover-leave-active {
  transform-origin: top right;
  transition: opacity 160ms ease, transform 160ms ease;
}

.preference-popover-enter-from,
.preference-popover-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}

@media (max-width: 520px) {
  .preference-switcher {
    gap: 6px;
  }

  .preference-switcher__trigger {
    min-height: 38px;
    width: 38px;
    font-size: 0.78rem;
  }
}
</style>
