<template>
  <div
    class="preference-switcher"
    :class="[`preference-switcher--${density}`, `preference-switcher--${placement}`]"
    role="group"
    aria-label="app preferences"
  >
    <div class="preference-switcher__menu">
      <button
        class="preference-switcher__trigger"
        type="button"
        :aria-label="t('preferences.language')"
        :aria-expanded="languageOpen"
        @click="toggleLanguageMenu"
      >
        <span class="preference-switcher__mark preference-switcher__mark--language" aria-hidden="true">文</span>
        <span class="preference-switcher__trigger-text">{{ currentLanguage.label }}</span>
        <span class="preference-switcher__chevron" aria-hidden="true" />
      </button>
      <div v-if="languageOpen" class="preference-switcher__popover" role="menu" :aria-label="t('preferences.languageOptions')">
        <button
          v-for="option in languageChoices"
          :key="option.value"
          class="preference-switcher__option"
          type="button"
          role="menuitemradio"
          :aria-checked="language === option.value"
          @click="selectLanguage(option.value)"
        >
          <span class="preference-switcher__option-label">{{ option.label }}</span>
          <span class="preference-switcher__option-check" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="preference-switcher__menu">
      <button
        class="preference-switcher__trigger"
        type="button"
        :aria-label="t('preferences.theme')"
        :aria-expanded="themeOpen"
        @click="toggleThemeMenu"
      >
        <span class="preference-switcher__mark preference-switcher__mark--theme" :class="`preference-switcher__mark--${themeMode}`" aria-hidden="true" />
        <span class="preference-switcher__trigger-text">{{ currentTheme.shortLabel }}</span>
        <span class="preference-switcher__chevron" aria-hidden="true" />
      </button>
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
          <span class="preference-switcher__theme-label">{{ option.label }}</span>
          <span class="preference-switcher__option-check" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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
const languageOpen = ref(false)
const themeOpen = ref(false)

const languageChoices = computed<Array<{ label: string; value: LanguagePreference }>>(() => [
  { label: '中文', value: 'zh-CN' },
  { label: 'English', value: 'en' },
])

const themeChoices = computed<Array<{ label: string; shortLabel: string; value: ThemePreference }>>(() => [
  { label: t('preferences.system'), shortLabel: t('preferences.systemShort'), value: 'system' },
  { label: t('preferences.light'), shortLabel: t('preferences.light'), value: 'light' },
  { label: t('preferences.dark'), shortLabel: t('preferences.dark'), value: 'dark' },
])

const currentLanguage = computed(() => languageChoices.value.find((item) => item.value === language.value) ?? languageChoices.value[0])
const currentTheme = computed(() => themeChoices.value.find((item) => item.value === themeMode.value) ?? themeChoices.value[0])

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
  gap: 6px;
}

.preference-switcher--sidebar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
  gap: 8px;
}

.preference-switcher__menu {
  position: relative;
}

.preference-switcher__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  width: 100%;
  padding: 4px 11px 4px 6px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 82%, var(--moeurl-surface-soft) 18%);
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
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, var(--moeurl-surface-elevated));
  color: rgb(var(--v-theme-secondary));
  font-size: 0.74rem;
  font-weight: 950;
  line-height: 1;
}

.preference-switcher__mark--theme {
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent);
  background:
    linear-gradient(135deg, #eff6f2 0 48%, #10211e 48% 100%);
}

.preference-switcher__mark--light {
  background: linear-gradient(135deg, #ffffff, #eff6f2 62%, #f0a94f 150%);
}

.preference-switcher__mark--dark {
  background: linear-gradient(135deg, #10211e, #17231f 68%, #65d6b1 180%);
}

.preference-switcher__trigger-text {
  min-width: 0;
  white-space: nowrap;
}

.preference-switcher__popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 80;
  display: grid;
  min-width: 148px;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 22px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 94%, var(--moeurl-surface-soft) 6%);
  box-shadow: var(--moeurl-shadow-strong);
}

.preference-switcher--sidebar .preference-switcher__popover {
  top: auto;
  bottom: calc(100% + 8px);
  right: auto;
  left: 50%;
  transform: translateX(-50%);
}

.preference-switcher__popover--theme {
  min-width: 178px;
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
  gap: 9px;
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
  grid-template-columns: minmax(0, 1fr) 12px;
  padding: 10px 10px 10px 12px;
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

.preference-switcher__theme-graphic span {
  align-self: end;
  justify-self: end;
  width: 11px;
  height: 11px;
  margin: 3px;
  border-radius: 999px;
  background: rgb(var(--v-theme-secondary));
}

.preference-switcher__chevron {
  display: block;
  width: 6px;
  height: 6px;
  margin-left: 1px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  color: rgb(var(--v-theme-on-surface-variant));
  transform: translateY(-1px) rotate(45deg);
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
  min-height: 36px;
  padding: 4px 10px 4px 5px;
  font-size: 0.78rem;
}

.preference-switcher--compact .preference-switcher__mark {
  width: 23px;
  height: 23px;
  border-radius: 8px;
}

.preference-switcher--topbar .preference-switcher__trigger-text,
.preference-switcher--topbar .preference-switcher__chevron {
  display: none;
}

.preference-switcher--topbar .preference-switcher__trigger {
  width: 38px;
  min-width: 38px;
  padding: 4px;
}

@media (max-width: 520px) {
  .preference-switcher {
    gap: 6px;
  }

  .preference-switcher:not(.preference-switcher--sidebar) .preference-switcher__trigger-text {
    display: none;
  }

  .preference-switcher:not(.preference-switcher--sidebar) .preference-switcher__chevron {
    display: none;
  }

  .preference-switcher__trigger {
    min-height: 34px;
    width: 34px;
    padding: 4px;
    font-size: 0.78rem;
  }

  .preference-switcher--sidebar .preference-switcher__trigger {
    width: 100%;
    padding: 4px 10px 4px 5px;
  }

  .preference-switcher--sidebar .preference-switcher__trigger-text,
  .preference-switcher--sidebar .preference-switcher__chevron {
    display: inline-block;
  }
}
</style>
