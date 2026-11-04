import { cleanup, render, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'
import AppToasts from './AppToasts.vue'

vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: ref({ dark: false }) } }) }))

let rectangles: WeakMap<Element, DOMRect>
let fixtures: HTMLElement[]
let observers: TestResizeObserver[]

/** Supplies only the browser measurement boundary; Vue, observers and the notification owner stay real. */
class TestResizeObserver {
  readonly observed = new Set<Element>()
  constructor(private callback: globalThis.ResizeObserverCallback) { observers.push(this) }
  observe(element: Element) { this.observed.add(element) }
  unobserve(element: Element) { this.observed.delete(element) }
  disconnect() { this.observed.clear() }
  resize(element: Element) { if (this.observed.has(element)) this.deliver() }
  deliver() { this.callback([], this as unknown as globalThis.ResizeObserver) }
}

/** Places a real DOM fixture at a controlled, independently specified border box. */
function element(top = 0, height = 80, parent = document.body, attribute = 'data-toast-page-header') {
  const node = document.createElement('div')
  node.setAttribute(attribute, attribute === 'role' ? 'menu' : '')
  parent.append(node)
  fixtures.push(node)
  rectangles.set(node, new DOMRect(0, top, 390, height))
  return node
}

async function mountToasts() {
  const view = render(AppToasts, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
  await nextTick()
  return view
}

/** Reads the consumer's rendered layout, rather than a mock or a private hook field. */
function top() { return document.querySelector<HTMLElement>('.app-toasts')!.style.top }

beforeEach(() => {
  rectangles = new WeakMap()
  fixtures = []
  observers = []
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return rectangles.get(this) ?? new DOMRect() })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    const rect = rectangles.get(this)
    return (rect ? [rect] : []) as unknown as DOMRectList
  })
})

afterEach(() => {
  cleanup()
  for (const node of fixtures) node.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('page notification navigation clearance', () => {
  // Omitting navigation measurement must leave the consumer at the old, obstructing page position.
  it('places page messages below the visible header and recomputes its actual height', async () => {
    const header = element()
    await mountToasts()
    expect(top()).toBe('88px')
    rectangles.set(header, new DOMRect(0, 0, 390, 100))
    observers[0]!.resize(header)
    await nextTick()
    expect(top()).toBe('108px')
  })

  it('reserves an expanded internal menu, including its exit, but ignores unrelated menus', async () => {
    const header = element()
    element(0, 600, document.body, 'role')
    await mountToasts()
    expect(top()).toBe('88px')
    const menu = element(80, 140, header, 'role')
    await waitFor(() => expect(top()).toBe('228px'))
    expect(observers[0]!.observed.has(menu)).toBe(true)
    menu.classList.add('menu-leave-active')
    await nextTick()
    expect(top()).toBe('228px')
    menu.hidden = true
    await waitFor(() => expect(top()).toBe('88px'))
    menu.hidden = false
    await waitFor(() => expect(top()).toBe('228px'))
    menu.remove()
    await waitFor(() => expect(top()).toBe('88px'))
    expect(observers[0]!.observed.has(menu)).toBe(false)
  })

  it.each(['hidden', 'inert', 'aria-hidden', 'display', 'visibility'])('restores the original page position when an ancestor is %s', async attribute => {
    const parent = element(0, 100, document.body, 'data-fixture')
    element(0, 80, parent)
    await mountToasts()
    expect(top()).toBe('88px')
    if (attribute === 'display') parent.style.display = 'none'
    else if (attribute === 'visibility') parent.style.visibility = 'hidden'
    else parent.setAttribute(attribute, attribute === 'aria-hidden' ? 'true' : '')
    await waitFor(() => expect(top()).toBe(''))
    expect(observers[0]!.observed.size).toBe(0)
  })

  it.each([
    ['above', new DOMRect(0, -80, 390, 80)],
    ['below', new DOMRect(0, 1000, 390, 80)],
    ['left', new DOMRect(-390, 0, 390, 80)],
    ['right', new DOMRect(2000, 0, 390, 80)],
    ['zero width', new DOMRect(0, 0, 0, 80)],
    ['zero height', new DOMRect(0, 0, 390, 0)],
    ['nonfinite', new DOMRect(0, 0, 390, Number.NaN)],
  ])('ignores a header with %s geometry', async (_, rect) => {
    const header = element()
    await mountToasts()
    expect(top()).toBe('88px')
    rectangles.set(header, rect)
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(top()).toBe('')
  })

  it('ignores a box without client rects and restores after DOM replacement', async () => {
    const header = element()
    await mountToasts()
    expect(top()).toBe('88px')
    rectangles.delete(header)
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(top()).toBe('')
    header.remove()
    const replacement = element(0, 90)
    await waitFor(() => expect(top()).toBe('98px'))
    expect(observers[0]!.observed.has(header)).toBe(false)
    expect(observers[0]!.observed.has(replacement)).toBe(true)
    replacement.remove()
    await waitFor(() => expect(top()).toBe(''))
  })

  it('responds to captured descendant scroll, resize and completed menu transitions without ResizeObserver', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const header = element()
    await mountToasts()
    expect(top()).toBe('88px')
    rectangles.set(header, new DOMRect(0, -20, 390, 80))
    header.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(top()).toBe('68px')
    rectangles.set(header, new DOMRect(0, 0, 390, 90))
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(top()).toBe('98px')
    const menu = element(90, 130, header, 'role')
    await waitFor(() => expect(top()).toBe('228px'))
    rectangles.set(menu, new DOMRect(0, 90, 390, 100))
    menu.dispatchEvent(new Event('transitionend', { bubbles: true }))
    await nextTick()
    expect(top()).toBe('198px')
  })

  it('clears page-only layout inside a modal and restores it on return without recreating the Toaster', async () => {
    const header = element()
    const view = await mountToasts(), original = document.querySelector('[data-sonner-toaster]')
    expect(top()).toBe('88px')
    const modal = element(80, 200, document.body, 'data-toast-modal-root')
    await waitFor(() => expect(top()).toBe(''))
    expect(document.querySelector('.app-toasts')!.closest('[data-toast-modal-root]')).toBe(modal)
    expect(observers[0]!.observed.has(header)).toBe(false)
    modal.removeAttribute('data-toast-modal-root')
    // Trigger the existing owner observer through its declared class boundary.
    modal.classList.add('closed')
    await waitFor(() => expect(top()).toBe('88px'))
    expect(document.querySelector('[data-sonner-toaster]')).toBe(original)
    const observer = observers[0]!
    for (let i = 0; i < 10; i++) observer.deliver()
    await nextTick()
    expect(top()).toBe('88px')
    view.unmount()
    expect(observer.observed.size).toBe(0)
    observer.deliver()
    window.dispatchEvent(new Event('resize'))
    header.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('transitionend'))
    await nextTick()
    expect(document.querySelector('.app-toasts')).toBeNull()
  })
})
