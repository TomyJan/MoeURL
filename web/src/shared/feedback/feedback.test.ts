import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Component } from 'vue'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { messages } from '@/app/i18n'
import ActionToast from './ActionToast.vue'
import AppToasts from './AppToasts.vue'

vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: ref({ dark: false }) } }) }))
afterEach(() => {
  toast.dismiss()
  vi.restoreAllMocks()
})

describe('application notifications', () => {
  it('retains the old message during dismissal when the next failure publishes a new toast', async () => {
    const publish = vi.spyOn(toast, 'error')
    const visible = ref(true)
    const message = ref('This slug is already taken.')
    const Page = {
      components: { ActionToast },
      setup: () => ({ visible, message }),
      template: '<ActionToast v-if="visible" type="error">{{ message }}</ActionToast>',
    }
    render(Page)
    // Keep the published content mounted, as the toaster does during its exit animation.
    const first = render(publish.mock.calls[0]![0] as Component)
    expect(first.container.textContent).toBe('This slug is already taken.')
    visible.value = false
    await nextTick()
    message.value = 'This slug is a reserved system path.'
    visible.value = true
    await nextTick()
    const second = render(publish.mock.calls[1]![0] as Component)
    expect(first.container.textContent).toBe('This slug is already taken.')
    expect(second.container.textContent).toBe('This slug is a reserved system path.')
  })
  it('keepsOneToastAcrossModalMigration', async () => {
    const modal = ref(false)
    const Page = {
      components: { AppToasts },
      setup: () => ({ modal }),
      template: '<AppToasts /><section v-if="modal" data-toast-modal-root><button>Cancel</button></section>',
    }
    render(Page, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.error('Retry operation')
    await screen.findByText('Retry operation')
    const original = screen.getByText('Retry operation').closest('[data-sonner-toast]')
    modal.value = true
    await waitFor(() => expect(screen.getByText('Retry operation').closest('[data-toast-modal-root]')).not.toBeNull())
    expect(screen.getByText('Retry operation').closest('[data-sonner-toast]')).toBe(original)
    modal.value = false
    await waitFor(() => expect(screen.getByText('Retry operation').closest('[data-toast-modal-root]')).toBeNull())
    expect(screen.getByText('Retry operation').closest('[data-sonner-toast]')).toBe(original)
    await fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    await waitFor(() => expect(screen.queryByText('Retry operation')).toBeNull())
  })

  it('usesHighestActiveModalInsteadOfLastDOMNode', async () => {
    render({ components: { AppToasts }, template: '<AppToasts /><div class="v-dialog v-overlay--active" style="z-index: 2500"><section class="v-overlay__content" aria-label="Top"><button>Top cancel</button></section></div><div class="v-dialog v-overlay--active" style="z-index: 2400"><section class="v-overlay__content" aria-label="Lower"><button>Lower cancel</button></section></div>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('Highest layer message')
    await waitFor(() => expect(screen.getByText('Highest layer message').closest('.v-overlay__content')?.getAttribute('aria-label')).toBe('Top'))
    const original = screen.getByText('Highest layer message')
    document.querySelector<HTMLElement>('.v-dialog')!.style.zIndex = '2300'
    await waitFor(() => expect(screen.getByText('Highest layer message').closest('.v-overlay__content')?.getAttribute('aria-label')).toBe('Lower'))
    expect(screen.getByText('Highest layer message')).toBe(original)
  })

  it('returnsToParentAfterNestedClose', async () => {
    const nested = ref(true)
    render({ components: { AppToasts }, setup: () => ({ nested }), template: '<AppToasts /><section data-toast-modal-root aria-label="Parent"><button>Parent cancel</button></section><section v-if="nested" data-toast-modal-root aria-label="Child"><button>Child cancel</button></section>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('Nested message')
    await waitFor(() => expect(screen.getByText('Nested message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('Child'))
    const original = screen.getByText('Nested message')
    nested.value = false
    await waitFor(() => expect(screen.getByText('Nested message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('Parent'))
    expect(screen.getByText('Nested message')).toBe(original)
  })

  it('moves from a closing custom drawer to its newly opened dialog', async () => {
    const opening = ref(false)
    render({ components: { AppToasts }, setup: () => ({ opening }), template: '<AppToasts /><div class="console-shell__mobile-nav" :class="{ \'moe-overlay-leave-active\': opening }" style="z-index:120"><section data-toast-modal-root aria-label="Closing drawer" style="z-index:1"><button>Drawer control</button></section></div><div v-if="opening" class="console-shell__dialog" style="z-index:120"><section data-toast-modal-root aria-label="New dialog"><button>Dialog cancel</button></section></div>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('Drawer handoff message')
    await waitFor(() => expect(screen.getByText('Drawer handoff message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('Closing drawer'))
    const original = screen.getByText('Drawer handoff message')
    opening.value = true
    await waitFor(() => expect(screen.getByText('Drawer handoff message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('New dialog'))
    expect(screen.getByText('Drawer handoff message')).toBe(original)
  })

  it('ignoresHiddenModal', async () => {
    const hidden = ref(true)
    render({ components: { AppToasts }, setup: () => ({ hidden }), template: '<AppToasts /><section data-toast-modal-root aria-label="Visible"><button>Visible cancel</button></section><section data-toast-modal-root :hidden="hidden" aria-label="Hidden"><button>Hidden cancel</button></section>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('Visible layer message')
    await waitFor(() => expect(screen.getByText('Visible layer message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('Visible'))
    hidden.value = false
    await waitFor(() => expect(screen.getByText('Visible layer message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('Hidden'))
  })

  it('leavesNoModalRegionWithoutMessages', async () => {
    render({ components: { AppToasts }, template: '<AppToasts /><section data-toast-modal-root><h2>Safe title</h2><button>Cancel</button></section>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    expect(document.querySelector('[data-toast-modal-region]')).toBeNull()
    toast.success('Dismiss this message')
    await screen.findByText('Dismiss this message')
    await fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    await waitFor(() => expect(screen.queryByText('Dismiss this message')).toBeNull())
    expect(document.querySelector('[data-toast-modal-region]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Safe title' })).toBeTruthy()
  })

  it('restores the last safe modal control after its focused notification actually leaves', async () => {
    render({ components: { AppToasts }, template: '<AppToasts /><section data-toast-modal-root tabindex="-1"><button>Safe cancel</button></section>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    const cancel = screen.getByRole('button', { name: 'Safe cancel' })
    cancel.focus()
    toast.success('Focus restoration message')
    await screen.findByText('Focus restoration message')
    const close = screen.getByRole('button', { name: '关闭提示' })
    close.focus()
    await fireEvent.click(close)
    await waitFor(() => expect(screen.queryByText('Focus restoration message')).toBeNull())
    expect(document.activeElement).toBe(cancel)
  })

  it('does not steal a newer modal focus while the dismissed notification exits', async () => {
    render({ components: { AppToasts }, template: '<AppToasts /><section data-toast-modal-root tabindex="-1"><button>Safe cancel</button><button>Another control</button></section>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    screen.getByRole('button', { name: 'Safe cancel' }).focus()
    toast.success('Preserve newer focus')
    await screen.findByText('Preserve newer focus')
    const close = screen.getByRole('button', { name: '关闭提示' }), other = screen.getByRole('button', { name: 'Another control' })
    close.focus()
    await fireEvent.click(close)
    other.focus()
    await waitFor(() => expect(screen.queryByText('Preserve newer focus')).toBeNull())
    expect(document.activeElement).toBe(other)
  })

  it('returns focus to the modal itself when its remembered control becomes disabled', async () => {
    render({ components: { AppToasts }, template: '<AppToasts /><section data-toast-modal-root tabindex="-1" aria-label="Safe modal"><button>Safe cancel</button></section>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    const cancel = screen.getByRole('button', { name: 'Safe cancel' }) as HTMLButtonElement
    cancel.focus()
    toast.success('Disabled fallback message')
    await screen.findByText('Disabled fallback message')
    const close = screen.getByRole('button', { name: '关闭提示' })
    close.focus()
    cancel.disabled = true
    await fireEvent.click(close)
    await waitFor(() => expect(screen.queryByText('Disabled fallback message')).toBeNull())
    expect(document.activeElement).toBe(document.querySelector('[data-toast-modal-root]'))
  })

  it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"'])('ignores a modal with a hidden ancestor: %s', async attribute => {
    render({ components: { AppToasts }, template: '<AppToasts /><section data-toast-modal-root aria-label="Visible"><button>Cancel</button></section><div ' + attribute + '><section data-toast-modal-root aria-label="Unavailable"><button>Unavailable cancel</button></section></div>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('Ancestor visibility message')
    await waitFor(() => expect(screen.getByText('Ancestor visibility message').closest('[data-toast-modal-root]')?.getAttribute('aria-label')).toBe('Visible'))
  })

  it('returns to the page while a closed dialog is still leaving', async () => {
    const active = ref(true)
    render({ components: { AppToasts }, setup: () => ({ active }), template: '<AppToasts /><div class="v-dialog v-overlay" :class="{ \'v-overlay--active\': active }"><section data-toast-modal-root class="v-overlay__content"><button>Cancel</button></section></div>' }, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('Leaving modal message')
    await waitFor(() => expect(screen.getByText('Leaving modal message').closest('[data-toast-modal-root]')).not.toBeNull())
    active.value = false
    await waitFor(() => expect(screen.getByText('Leaving modal message').closest('[data-toast-modal-root]')).toBeNull())
  })

  it('stacks independent messages, renders text safely, and dismisses only the chosen toast', async () => {
    const visible = ref(true)
    const message = ref('<script>alert("unsafe")</script>')
    const Page = {
      components: { ActionToast, AppToasts },
      setup: () => ({ visible, message }),
      template: '<AppToasts /><ActionToast v-if="visible" type="error">{{ message }}</ActionToast>',
    }
    render(Page, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.success('保存成功')
    await screen.findByText(message.value)
    await screen.findByText('保存成功')
    expect(document.querySelector('[data-sonner-toast] script')).toBeNull()
    message.value = '请重试'
    await screen.findByText('请重试')
    const saved = screen.getByText('保存成功').closest('[data-sonner-toast]')!
    await fireEvent.click(saved.querySelector('button[aria-label="关闭提示"]')!)
    await waitFor(() => expect(screen.queryByText('保存成功')).toBeNull())
    expect(screen.getByText('请重试')).toBeTruthy()
    visible.value = false
    await waitFor(() => expect(screen.queryByText('请重试')).toBeNull())
  })
})
