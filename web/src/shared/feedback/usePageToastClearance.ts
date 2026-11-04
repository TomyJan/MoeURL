import { onMounted, onUnmounted, shallowRef } from 'vue'

/** Keeps page notifications below the real, currently visible navigation and its expanded menus. */
export function usePageToastClearance(isPage: () => boolean, isActive: (element: globalThis.HTMLElement) => boolean) {
  const top = shallowRef<number | null>(null)
  const observed = new Set<globalThis.HTMLElement>()
  let mounted = false
  let observer: globalThis.ResizeObserver | undefined

  /** Rejects hidden, empty, nonfinite and offscreen boxes rather than reproducing a CSS breakpoint. */
  function visibleRect(element: globalThis.HTMLElement) {
    if (!isActive(element) || !element.getClientRects().length) return null
    const rect = element.getBoundingClientRect()
    if (![rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)) return null
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < globalThis.innerHeight && rect.left < globalThis.innerWidth ? rect : null
  }

  /** Reconciles only the active boxes; unchanged geometry never creates another reactive style write. */
  function refresh() {
    if (!mounted) return
    const current = new Set<globalThis.HTMLElement>()
    let bottom: number | null = null
    if (isPage()) {
      for (const header of globalThis.document.querySelectorAll<globalThis.HTMLElement>('[data-toast-page-header]')) {
        const rect = visibleRect(header)
        if (!rect) continue
        current.add(header)
        bottom = Math.max(bottom ?? 0, rect.bottom)
        for (const menu of header.querySelectorAll<globalThis.HTMLElement>('[role="menu"]')) {
          const menuRect = visibleRect(menu)
          if (!menuRect) continue
          current.add(menu)
          bottom = Math.max(bottom, menuRect.bottom)
        }
      }
    }
    for (const element of observed) {
      if (!current.has(element)) { observer?.unobserve(element); observed.delete(element) }
    }
    for (const element of current) {
      if (!observed.has(element)) { observer?.observe(element); observed.add(element) }
    }
    const next = bottom === null ? null : bottom + 8
    if (top.value !== next) top.value = next
  }

  onMounted(() => {
    mounted = true
    if (typeof globalThis.ResizeObserver === 'function') observer = new globalThis.ResizeObserver(refresh)
    globalThis.addEventListener('resize', refresh)
    globalThis.addEventListener('scroll', refresh, true)
    globalThis.document.addEventListener('transitionend', refresh)
    refresh()
  })
  onUnmounted(() => {
    mounted = false
    observer?.disconnect()
    observed.clear()
    globalThis.removeEventListener('resize', refresh)
    globalThis.removeEventListener('scroll', refresh, true)
    globalThis.document.removeEventListener('transitionend', refresh)
  })
  return { top, refresh }
}
