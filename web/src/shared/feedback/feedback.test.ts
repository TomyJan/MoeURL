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
  it('keeps notifications inside the active modal and returns them to the page when it closes', async () => {
    const modal = ref(false)
    const Page = {
      components: { AppToasts },
      setup: () => ({ modal }),
      template: '<AppToasts /><section v-if="modal" data-toast-modal-root><button>Cancel</button></section>',
    }
    render(Page, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] } })
    toast.error('Retry operation')
    await screen.findByText('Retry operation')
    modal.value = true
    await waitFor(() => expect(screen.getByText('Retry operation').closest('[data-toast-modal-root]')).not.toBeNull())
    modal.value = false
    await waitFor(() => expect(screen.getByText('Retry operation').closest('[data-toast-modal-root]')).toBeNull())
    await fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    await waitFor(() => expect(screen.queryByText('Retry operation')).toBeNull())
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
