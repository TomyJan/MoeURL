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
