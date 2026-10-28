import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { getCurrentInstance, type ComponentInternalInstance } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { afterEach, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import type { OIDCProvider } from '@/entities/oidc/api'
import { createDeferred } from '@/test/deferred'
import OIDCProviderTemplatePicker from '@/features/oidc-provider-template/OIDCProviderTemplatePicker.vue'
import type { ProviderTemplateFields } from '@/features/oidc-provider-template/template'
import AdminAuthenticationPage from './AdminAuthenticationPage.vue'

let client: QueryClient
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals() })

/** Keeps the production page, API, query cache, controls and translations real; only HTTP is controlled. */
function mountTemplates(options: { providers?: OIDCProvider[]; create?: () => Response | Promise<Response>; locale?: 'en' | 'zh-CN' } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } })
  const requests: string[] = []
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    requests.push(path)
    if (path === '/api/v1/admin/oidc/provider/list') return response({ providers: options.providers ?? [] })
    if (path === '/api/v1/admin/oidc/provider/create') {
      writes.push(JSON.parse(init!.body as string) as Record<string, unknown>)
      return options.create ? options.create() : response(null, 340100)
    }
    throw new Error('Unexpected OIDC fixture request: ' + path)
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1280, height: 720, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  const instances: ComponentInternalInstance[] = []
  const view = render(AdminAuthenticationPage, { global: { mixins: [{ mounted() { const instance = getCurrentInstance(); if (instance) instances.push(instance) } }], plugins: [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives }), createI18n({ legacy: false, locale: options.locale ?? 'en', fallbackLocale: 'en', messages })] } })
  return { ...view, instances, requests, writes }
}

function response(data: unknown, code = 0) {
  return new Response(JSON.stringify({ code, message: code ? 'Request rejected' : 'OK', data, meta: {} }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function beginCreate() {
  await screen.findByText('No OIDC providers')
  await fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
}

async function apply(name: string) {
  await fireEvent.click(screen.getByRole('button', { name }))
  await fireEvent.click(screen.getByRole('button', { name: 'Apply template' }))
}

async function fillCredentials() {
  await fireEvent.update(screen.getByLabelText('Client ID'), 'old-client')
  await fireEvent.update(screen.getByLabelText('Client Secret'), 'old-secret')
  await fireEvent.update(screen.getByLabelText('Allowed email domains'), 'old.example')
}

it('offers an explicit template action in the real new-provider form', async () => {
  mountTemplates()
  await screen.findByText('No OIDC providers')
  await fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
  expect(screen.getByRole('textbox', { name: 'Client ID' })).toHaveProperty('value', '')
  // This visible action is absent in the old production page: the intended feature RED.
  expect(screen.getByRole('button', { name: 'Apply template' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Microsoft Entra ID' })).toBeNull()
})

it('changes no business field and sends no request when selecting a template', async () => {
  const view = mountTemplates()
  await beginCreate()
  await fireEvent.update(screen.getByLabelText('Provider key'), 'original')
  await fireEvent.click(screen.getByRole('button', { name: 'Google' }))
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', 'original')
  expect(screen.getByLabelText('Issuer URL')).toHaveProperty('value', '')
  expect(view.requests).toEqual(['/api/v1/admin/oidc/provider/list'])
  expect(view.writes).toEqual([])
})

it('applies Google only explicitly and starts the complete template draft disabled without credentials', async () => {
  const view = mountTemplates()
  await beginCreate()
  await apply('Google')
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', 'google')
  expect(screen.getByLabelText('Display name')).toHaveProperty('value', 'Google')
  expect(screen.getByLabelText('Issuer URL')).toHaveProperty('value', 'https://accounts.google.com')
  expect(screen.getByRole('checkbox', { name: 'Enabled' })).toHaveProperty('checked', false)
  for (const label of ['Client ID', 'Client Secret', 'Allowed email domains']) expect(screen.getByLabelText(label)).toHaveProperty('value', '')
  expect(view.writes).toEqual([])
})

it('cancels a whole-draft replacement without losing any value, then clears old credentials on confirmation', async () => {
  mountTemplates()
  await beginCreate()
  await fireEvent.update(screen.getByLabelText('Provider key'), 'old')
  await fireEvent.update(screen.getByLabelText('Display name'), 'Old provider')
  await fireEvent.update(screen.getByLabelText('Issuer URL'), 'https://old.example')
  await fillCredentials()
  await apply('Google')
  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.getByText(/Client ID, Client Secret/)).toBeTruthy()
  await fireEvent.click(dialog.getByRole('button', { name: 'Keep draft' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  for (const [label, value] of [['Provider key', 'old'], ['Display name', 'Old provider'], ['Issuer URL', 'https://old.example'], ['Client ID', 'old-client'], ['Client Secret', 'old-secret'], ['Allowed email domains', 'old.example']]) {
    expect(screen.getByLabelText(label!)).toHaveProperty('value', value)
  }
  expect(screen.getByRole('checkbox', { name: 'Enabled' })).toHaveProperty('checked', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Apply template' }))
  await fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace draft' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', 'google')
  for (const label of ['Client ID', 'Client Secret', 'Allowed email domains']) expect(screen.getByLabelText(label)).toHaveProperty('value', '')
  expect(screen.getByRole('checkbox', { name: 'Enabled' })).toHaveProperty('checked', false)
})

it.each(['secret', 'whitespace', 'disabled'] as const)('confirms replacement of a draft containing only %s changes', async kind => {
  mountTemplates()
  await beginCreate()
  if (kind === 'secret') await fireEvent.update(screen.getByLabelText('Client Secret'), 'only-secret')
  if (kind === 'whitespace') await fireEvent.update(screen.getByLabelText('Client ID'), ' ')
  if (kind === 'disabled') await fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }))
  await apply('Google')
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

it('restores the original blank manual defaults explicitly after using the Google template', async () => {
  mountTemplates()
  await beginCreate()
  await apply('Google')
  expect(screen.getByLabelText('Issuer URL')).toHaveProperty('value', 'https://accounts.google.com')
  await apply('Manual / blank')
  await fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace draft' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  for (const label of ['Provider key', 'Display name', 'Issuer URL', 'Client ID', 'Client Secret', 'Allowed email domains']) expect(screen.getByLabelText(label)).toHaveProperty('value', '')
  expect(screen.getByRole('checkbox', { name: 'Enabled' })).toHaveProperty('checked', true)
})

it('invalidates a pending template confirmation when the template selection changes or creation is cancelled', async () => {
  mountTemplates()
  await beginCreate()
  await fireEvent.update(screen.getByLabelText('Client Secret'), 'keep-this')
  await apply('Google')
  expect(await screen.findByRole('dialog')).toBeTruthy()
  // A stale/programmatic event still cannot apply a previously selected template.
  await fireEvent.click(screen.getByRole('button', { name: 'Manual / blank' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByLabelText('Client Secret')).toHaveProperty('value', 'keep-this')
  await apply('Google')
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
  expect(screen.getByLabelText('Client Secret')).toHaveProperty('value', '')
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', '')
})

it('keeps existing-provider editing outside template controls and drops a stale create confirmation on selection', async () => {
  const provider: OIDCProvider = { id: '00000000-0000-4000-8000-000000000701', key: 'company', displayName: 'Company SSO', issuerUrl: 'https://id.example.com', clientId: 'company-client', clientSecretConfigured: true, allowedEmailDomains: ['example.com'], enabled: true, callbackUrl: 'https://links.example.com/api/v1/auth/oidc/company/callback', updatedAt: '2026-10-28T00:00:00Z' }
  mountTemplates({ providers: [provider] })
  await screen.findByRole('button', { name: /Company SSO/ })
  expect(screen.queryByRole('button', { name: 'Apply template' })).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
  await fireEvent.update(screen.getByLabelText('Client Secret'), 'temporary-secret')
  await apply('Google')
  expect(await screen.findByRole('dialog')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: /Company SSO/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Apply template' })).toBeNull()
  expect(screen.getByLabelText('Issuer URL')).toHaveProperty('value', 'https://id.example.com')
  expect(screen.getByLabelText('Client Secret')).toHaveProperty('value', '')
})

it('sends only the existing seven create fields and locks template application while the write is pending', async () => {
  const write = createDeferred<Response>()
  const view = mountTemplates({ create: () => write.promise })
  await beginCreate()
  await apply('Google')
  await fillCredentials()
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  expect(view.writes[0]).toEqual({ key: 'google', displayName: 'Google', issuerUrl: 'https://accounts.google.com', clientId: 'old-client', clientSecret: 'old-secret', allowedEmailDomains: ['old.example'], enabled: false })
  expect(screen.getByRole('button', { name: 'Apply template' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Manual / blank' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Apply template' }))
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', 'google')
  expect(JSON.stringify(client.getMutationCache().getAll().map(item => item.state.variables))).not.toContain('old-secret')
  write.resolve(response(null, 340100))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply template' })).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('Client Secret')).toHaveProperty('value', '')
})

it('renders the same creation aid in Chinese without untranslated keys', async () => {
  mountTemplates({ locale: 'zh-CN' })
  await screen.findByText('暂无 OIDC 提供商')
  await fireEvent.click(screen.getByRole('button', { name: '新增提供商' }))
  expect(screen.getByRole('button', { name: '应用模板' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Google' }))
  await fireEvent.click(screen.getByRole('button', { name: '应用模板' }))
  expect(screen.getByRole('checkbox', { name: '启用' })).toHaveProperty('checked', false)
})

// Removing either accessible relationship loses the warning's context for assistive technology.
it.each([
  { locale: 'en' as const, empty: 'No OIDC providers', add: 'Add provider', apply: 'Apply template', title: 'Replace creation draft?' },
  { locale: 'zh-CN' as const, empty: '暂无 OIDC 提供商', add: '新增提供商', apply: '应用模板', title: '替换创建草稿？' },
])('names and describes the replacement dialog in $locale', async text => {
  mountTemplates({ locale: text.locale })
  await screen.findByText(text.empty)
  await fireEvent.click(screen.getByRole('button', { name: text.add }))
  await fireEvent.update(screen.getByLabelText('Client Secret'), 'keep-secret')
  await fireEvent.click(screen.getByRole('button', { name: 'Google' }))
  await fireEvent.click(screen.getByRole('button', { name: text.apply }))
  const dialog = await screen.findByRole('dialog', { name: text.title })
  const description = document.getElementById(dialog.getAttribute('aria-describedby')!)
  expect(description).not.toBeNull()
  expect(description!.textContent).toContain('Client Secret')
  expect(screen.getByRole('dialog', { name: text.title, description: /Client Secret/ })).toBe(dialog)
})

// Unmounting the confirmation must return keyboard users to the actual Apply button.
it.each(['keep', 'replace', 'dismiss'] as const)('returns focus to the template trigger after %s', async action => {
  const view = mountTemplates()
  await beginCreate()
  await fillCredentials()
  await fireEvent.click(screen.getByRole('button', { name: 'Google' }))
  const trigger = screen.getByRole('button', { name: 'Apply template' })
  trigger.focus()
  await fireEvent.click(trigger)
  const dialog = within(await screen.findByRole('dialog'))
  const button = dialog.getByRole('button', { name: action === 'replace' ? 'Replace draft' : 'Keep draft' })
  button.focus()
  if (action === 'dismiss') {
    const instance = view.instances.find(item => (item.type as { name?: string }).name === 'VDialog' && item.vnode.props?.modelValue === true)!
    const dismiss = instance.vnode.props!['onUpdate:modelValue'] as (open: boolean) => void
    dismiss(false)
  } else await fireEvent.click(button)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(screen.getByLabelText('Client Secret')).toHaveProperty('value', action === 'replace' ? '' : 'old-secret')
})

it('does not return focus to a removed template trigger when creation is cancelled', async () => {
  mountTemplates()
  await beginCreate()
  await fillCredentials()
  const trigger = screen.getByRole('button', { name: 'Apply template' })
  trigger.focus()
  await fireEvent.click(trigger)
  await screen.findByRole('dialog')
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  cancel.focus()
  await fireEvent.click(cancel)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const add = screen.getByRole('button', { name: 'Add provider' })
  add.focus()
  await fireEvent.click(add)
  expect(document.activeElement).toBe(add)
  expect(screen.getByRole('button', { name: 'Apply template' })).not.toBe(trigger)
})

it('rejects already-buffered picker events after a write starts and after creation ends', async () => {
  const write = createDeferred<Response>()
  const view = mountTemplates({ create: () => write.promise })
  await beginCreate()
  await apply('Google')
  const picker = view.instances.find(instance => instance.type === OIDCProviderTemplatePicker)!
  // Capture the actual component event callbacks before the context changes, as a queued event would.
  const lateParentApply = picker.vnode.props!.onApply as (fields: ProviderTemplateFields) => void
  const button = (name: string) => view.instances.find(instance => (instance.type as { name?: string }).name === 'VBtn' && instance.proxy?.$el.textContent?.trim() === name)!
  const lateSelect = button('Manual / blank').vnode.props!.onClick as () => void
  const lateChildApply = button('Apply template').vnode.props!.onClick as () => void
  await fillCredentials()
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  lateSelect()
  lateChildApply()
  lateParentApply({ key: 'unwanted', displayName: 'Unwanted', issuerUrl: 'https://unwanted.example', enabled: true })
  await fireEvent.submit(view.container.querySelector('form')!)
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', 'google')
  expect(view.writes).toHaveLength(1)
  write.resolve(response(null, 340100))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', false))
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  lateParentApply({ key: 'unwanted', displayName: 'Unwanted', issuerUrl: 'https://unwanted.example', enabled: true })
  expect(screen.queryByRole('dialog')).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', '')
})

it('rejects a submitted old draft during confirmation and ignores a late confirmation after dismissal', async () => {
  const view = mountTemplates()
  await beginCreate()
  await fireEvent.update(screen.getByLabelText('Client Secret'), 'keep-secret')
  await apply('Google')
  const dialog = within(await screen.findByRole('dialog'))
  const lateConfirm = dialog.getByRole('button', { name: 'Replace draft' })
  await fireEvent.submit(view.container.querySelector('form')!)
  expect(view.writes).toEqual([])
  const dialogInstance = view.instances.find(instance => (instance.type as { name?: string }).name === 'VDialog' && instance.vnode.props?.modelValue === true)!
  const dismiss = dialogInstance.vnode.props!['onUpdate:modelValue'] as (open: boolean) => void
  dismiss(true)
  expect(screen.getByRole('dialog')).toBeTruthy()
  dismiss(false)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await fireEvent.click(lateConfirm)
  expect(screen.getByLabelText('Client Secret')).toHaveProperty('value', 'keep-secret')
  expect(screen.getByLabelText('Provider key')).toHaveProperty('value', '')
})
