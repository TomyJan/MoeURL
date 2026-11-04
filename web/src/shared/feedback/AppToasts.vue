<template>
  <Teleport :to="target">
    <div ref="region" class="app-toasts" :class="{ 'app-toasts--modal': target !== 'body' }" :data-toast-modal-region="target !== 'body' && hasMessages ? '' : undefined" @pointerdown.capture="allowNativeModalScroll">
      <Toaster position="top-right" :theme="dark ? 'dark' : 'light'" :visible-toasts="5" :duration="6000" expand rich-colors close-button :toast-options="{ closeButtonAriaLabel: t('feedback.dismiss') }" />
    </div>
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
const region = shallowRef<globalThis.HTMLElement | null>(null)
const hasMessages = shallowRef(false)
let observer: globalThis.MutationObserver
let focusedToastControl: globalThis.HTMLElement | null = null
const modalFocus = new WeakMap<globalThis.HTMLElement, globalThis.HTMLElement>()

/** Native touch scrolling must not start Sonner's swipe state, which lacks pointercancel cleanup. */
function allowNativeModalScroll(event: globalThis.PointerEvent) {
  if (target.value === 'body' || event.pointerType !== 'touch') return
  // Reparenting can leave Sonner's old mouse hover paused without a native mouseleave.
  // A touch starts outside that mouse interaction; resume its remaining timer through its DOM boundary.
  for (const list of region.value?.querySelectorAll('[data-sonner-toaster]') ?? []) list.dispatchEvent(new globalThis.MouseEvent('mouseleave'))
  event.stopPropagation()
}

/** Remembers the user's safe modal focus without replacing newer focus during an exit animation. */
function rememberFocus(event: globalThis.FocusEvent) {
  const element = event.target
  if (!(element instanceof globalThis.HTMLElement)) return
  focusedToastControl = region.value?.contains(element) ? element : null
  if (!focusedToastControl && typeof target.value !== 'string' && target.value.contains(element)) modalFocus.set(target.value, element)
}

/** Excludes hidden ancestors as well as dialogs that are finishing their closing transition. */
function isActive(panel: globalThis.HTMLElement) {
  const dialog = panel.closest('.v-dialog')
  if (dialog && !dialog.classList.contains('v-overlay--active')) return false
  for (let element: globalThis.HTMLElement | null = panel; element; element = element.parentElement) {
    const style = globalThis.getComputedStyle(element)
    if (element.classList.contains('moe-overlay-leave-active')) return false
    if (element.hidden || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/** Keeps the single live region inside the active modal's accessibility and focus boundary. */
function syncTarget() {
  const panels = globalThis.document.querySelectorAll<globalThis.HTMLElement>(
    '[data-toast-modal-root], .v-dialog.v-overlay--active .v-overlay__content',
  )
  let top: globalThis.HTMLElement | string = 'body'
  let layer = -Infinity
  for (const panel of panels) {
    if (!isActive(panel)) continue
    const overlay = panel.closest('.v-dialog, .v-overlay, .console-shell__mobile-nav, .console-shell__dialog') ?? panel
    const z = Number.parseFloat(globalThis.getComputedStyle(overlay).zIndex) || 0
    if (z >= layer) { top = panel; layer = z }
  }
  target.value = top
  hasMessages.value = Boolean(region.value?.querySelector('[data-sonner-toast]'))
  if (focusedToastControl && !focusedToastControl.isConnected) {
    focusedToastControl = null
    if (typeof top !== 'string' && globalThis.document.activeElement === globalThis.document.body) {
      const previous = modalFocus.get(top)
      const safe = previous?.isConnected && top.contains(previous) && isActive(previous) && !previous.matches(':disabled, [aria-disabled="true"]') ? previous : top
      safe.focus({ preventScroll: true })
    }
  }
}
onMounted(() => {
  syncTarget()
  globalThis.document.addEventListener('focusin', rememberFocus)
  observer = new globalThis.MutationObserver(syncTarget)
  observer.observe(globalThis.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'] })
})
onUnmounted(() => {
  observer.disconnect()
  globalThis.document.removeEventListener('focusin', rememberFocus)
})
</script>

<style>
[data-sonner-toaster] { z-index: 10000; }
[data-sonner-toast] { overflow-wrap: anywhere; }
.app-toasts--modal { order: -1; flex: 0 1 auto; min-height: 0; max-height: 30dvh; overflow: auto; }
.app-toasts--modal:not([data-toast-modal-region]) { position: absolute; width: 0; height: 0; }
.app-toasts--modal[data-toast-modal-region] { padding: 10px; }
.app-toasts--modal [data-sonner-toaster] { position: static; display: flex; flex-direction: column; gap: var(--gap); width: 100%; transform: none; }
.app-toasts.app-toasts--modal [data-sonner-toast] { position: relative; inset: auto; flex-shrink: 0; width: 100%; height: auto; transform: none; touch-action: pan-y; }
.app-toasts--modal [data-sonner-toast][data-visible='false'] { display: none; }
.app-toasts--modal [data-sonner-toast] [data-content] { min-width: 0; }
.app-toasts--modal [data-sonner-toast]::before,
.app-toasts--modal [data-sonner-toast]::after { display: none; }
</style>
