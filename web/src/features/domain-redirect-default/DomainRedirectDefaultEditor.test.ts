import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { messages } from '@/app/i18n'
import type { SetDomainRedirectDefaultInput } from '@/entities/domain/redirect-default'
import DomainRedirectDefaultEditor from './DomainRedirectDefaultEditor.vue'

const setting = { domainId: '11111111-1111-4111-8111-111111111111', redirectMode: 'confirmation' as const, updatedAt: '2026-10-28T00:00:00.123456789Z' }
/** Mounts the real editor; emitted commands are its public parent-facing contract. */
function mount() {
  const commands: SetDomainRedirectDefaultInput[] = []
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const view = render(DomainRedirectDefaultEditor, { props: { setting, disabled: false, pending: false, conflict: false, onSave: (value) => commands.push(value) }, global: { plugins: [createVuetify({ components, directives }), createI18n({ legacy: false, locale: 'en', messages })] } })
  return { ...view, commands }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('preserves a dirty same-version draft and latches conflict until the parent renews it', async () => {
  const view = mount()
  const form = screen.getByRole('button', { name: 'Save redirect default' }).closest('form')!
  await fireEvent.submit(form)
  expect(view.commands).toHaveLength(0)
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await view.rerender({ setting: { ...setting } })
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  await view.rerender({ conflict: true })
  await view.rerender({ conflict: false })
  await fireEvent.submit(form)
  expect(view.commands).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
})

it('adopts a clean authoritative version and rejects disabled native form submissions', async () => {
  const view = mount()
  const renewed = { ...setting, redirectMode: 'direct' as const, updatedAt: '2026-10-28T00:00:01.987654321Z' }
  await view.rerender({ setting: renewed })
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  const form = screen.getByRole('button', { name: 'Save redirect default' }).closest('form')!
  await view.rerender({ disabled: true })
  await fireEvent.submit(form)
  expect(view.commands).toHaveLength(0)
  await view.rerender({ disabled: false })
  await fireEvent.submit(form)
  expect(view.commands).toEqual([{ id: setting.domainId, redirectMode: 'intermediate', expectedUpdatedAt: renewed.updatedAt }])
})
