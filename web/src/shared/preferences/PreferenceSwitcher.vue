<template>
  <div class="preference-switcher" role="group" aria-label="app preferences">
    <div class="preference-switcher__menu">
      <button
        class="preference-switcher__trigger"
        type="button"
        aria-label="选择语言"
        :aria-expanded="languageOpen"
        @click="toggleLanguageMenu"
      >
        <span>{{ currentLanguage.label }}</span>
        <span class="preference-switcher__chevron" aria-hidden="true">⌄</span>
      </button>
      <div v-if="languageOpen" class="preference-switcher__popover" role="menu" aria-label="语言选项">
        <button
          v-for="option in languageChoices"
          :key="option.value"
          class="preference-switcher__option"
          type="button"
          role="menuitemradio"
          :aria-checked="language === option.value"
          @click="selectLanguage(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="preference-switcher__menu">
      <button
        class="preference-switcher__trigger"
        type="button"
        aria-label="选择主题"
        :aria-expanded="themeOpen"
        @click="toggleThemeMenu"
      >
        <span>{{ currentTheme.shortLabel }}</span>
        <span class="preference-switcher__chevron" aria-hidden="true">⌄</span>
      </button>
      <div
        v-if="themeOpen"
        class="preference-switcher__popover preference-switcher__popover--theme"
        role="menu"
        aria-label="主题选项"
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
          <span class="preference-switcher__theme-graphic" :class="`preference-switcher__theme-graphic--${option.value}`" aria-hidden="true" />
          <span>{{ option.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import type { LanguagePreference, ThemePreference } from './preferences'
import { useAppPreferences } from './useAppPreferences'

const { language, setLanguage, setTheme, themeMode } = useAppPreferences()
const languageOpen = ref(false)
const themeOpen = ref(false)

const languageChoices: Array<{ label: string; value: LanguagePreference }> = [
  { label: '中文', value: 'zh-CN' },
  { label: 'English', value: 'en' },
]

const themeChoices: Array<{ label: string; shortLabel: string; value: ThemePreference }> = [
  { label: '跟随系统', shortLabel: '系统', value: 'system' },
  { label: '浅色', shortLabel: '浅色', value: 'light' },
  { label: '深色', shortLabel: '深色', value: 'dark' },
]

const currentLanguage = computed(() => languageChoices.find((item) => item.value === language.value) ?? languageChoices[0])
const currentTheme = computed(() => themeChoices.find((item) => item.value === themeMode.value) ?? themeChoices[0])

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
</script>

<style scoped>
.preference-switcher {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.preference-switcher__menu {
  position: relative;
}

.preference-switcher__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 13px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 86%, transparent);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 850;
}

.preference-switcher__trigger:hover,
.preference-switcher__option:hover,
.preference-switcher__theme-option:hover {
  border-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 28%, var(--moeurl-outline));
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 9%, var(--moeurl-surface-elevated));
}

.preference-switcher__popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 80;
  display: grid;
  min-width: 148px;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 22px;
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.preference-switcher__popover--theme {
  min-width: 220px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.preference-switcher__option,
.preference-switcher__theme-option {
  border: 1px solid transparent;
  border-radius: 16px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 800;
}

.preference-switcher__option {
  padding: 10px 12px;
  text-align: left;
}

.preference-switcher__theme-option {
  display: grid;
  justify-items: center;
  gap: 7px;
  min-width: 0;
  padding: 10px 6px;
}

.preference-switcher__option[aria-checked="true"],
.preference-switcher__theme-option[aria-checked="true"] {
  border-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 34%, transparent);
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 14%, transparent);
  color: rgb(var(--v-theme-primary));
}

.preference-switcher__theme-graphic {
  position: relative;
  display: block;
  width: 34px;
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 80%, transparent);
  border-radius: 999px;
}

.preference-switcher__chevron {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.76rem;
}

.preference-switcher__theme-graphic--system {
  background: linear-gradient(90deg, #f7fbf8 0 50%, #17231f 50% 100%);
}

.preference-switcher__theme-graphic--light {
  background: linear-gradient(135deg, #fffdf7, #cdebe1);
}

.preference-switcher__theme-graphic--dark {
  background: linear-gradient(135deg, #151817, #2d4a42);
}

@media (max-width: 520px) {
  .preference-switcher {
    gap: 6px;
  }

  .preference-switcher__trigger {
    min-height: 34px;
    padding-inline: 10px;
    font-size: 0.78rem;
  }
}
</style>
