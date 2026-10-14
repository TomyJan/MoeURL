<template>
  <Teleport :to="target">
    <Toaster position="top-right" :theme="dark ? 'dark' : 'light'" :visible-toasts="5" :duration="6000" expand rich-colors close-button :toast-options="{ closeButtonAriaLabel: t('feedback.dismiss') }" />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify'
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'

const { t } = useI18n()
const theme = useTheme()
const dark = computed(() => theme.global.current.value.dark)
const target = shallowRef<globalThis.HTMLElement | string>('body')
let observer: globalThis.MutationObserver

/** Keeps the single live region inside the active modal's accessibility and focus boundary. */
function syncTarget() {
  const panels = globalThis.document.querySelectorAll<globalThis.HTMLElement>(
    '[data-toast-modal-root], .v-dialog.v-overlay--active .v-overlay__content',
  )
  target.value = Array.from(panels).at(-1) ?? 'body'
}
onMounted(() => {
  syncTarget()
  observer = new globalThis.MutationObserver(syncTarget)
  observer.observe(globalThis.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
})
onUnmounted(() => observer.disconnect())
</script>

<style>
[data-sonner-toaster] { z-index: 10000; }
[data-sonner-toast] { overflow-wrap: anywhere; }
</style>
