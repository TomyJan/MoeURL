import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { updateShortLink, updateAdminShortLink } from '@/entities/short-link/api'
import type { ShortLink } from '@/entities/short-link/model'
import ShortLinkCreatePanel from '@/features/short-link-create/ShortLinkCreatePanel.vue'
import ShortLinkSettingsDialog from '@/features/short-link-settings/ShortLinkSettingsDialog.vue'
import { useShortLinkSettings } from '@/shared/short-link/useShortLinkSettings'
import { componentStubs } from '@/test/component-stubs'

const envelope = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: 'private backend detail', data, meta: {} }))
const domainId = '11111111-1111-4111-8111-111111116110'
const actor = { id: domainId, username: 'policy-user', nickname: '', group: 'admin', permissions: ['short_link:create', 'domain:use_default', 'short_link:update_own', 'short_link:update_all'] }
const link: ShortLink = { id: domainId, slug: 'policy61', url: 'https://go.example/policy61', targetUrl: 'https://original.example', title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-11-11T00:00:00Z' }
let client: QueryClient
let requests: Array<{ path: string; body: unknown }>
beforeEach(() => {
  requests = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(['auth', 'me'], { user: actor })
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    requests.push({ path, body: init.body && JSON.parse(String(init.body)) })
    if (init.method === 'POST') return envelope(null, 200121)
    if (path === '/api/v1/auth/me') return envelope({ user: actor })
    if (path === '/api/v1/domain/available') return envelope({ items: [{ id: domainId, host: 'go.example', displayName: 'Main', isDefault: true }] })
    if (path === '/api/v1/domain/group-default') return envelope({ selection: { domainId: null, status: 'not_set' } })
    if (path === '/api/v1/user/domain-preference') return envelope({ preference: { domainId: null, updatedAt: null } })
    throw new Error('Unexpected transport: ' + path)
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })
function mount(component: ReturnType<typeof defineComponent> | typeof ShortLinkCreatePanel, locale: 'en' | 'zh-CN') {
  return render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })], stubs: componentStubs } })
}
const reason = (locale: 'en' | 'zh-CN') => locale === 'en' ? /site restricts this target host/ : /目标主机被站点规则限制/
it.each(['en', 'zh-CN'] as const)('keeps single-create input and explains the %s restriction without refreshing permissions', async locale => {
  mount(ShortLinkCreatePanel, locale)
  const input = await screen.findByRole('textbox', { name: locale === 'en' ? messages.en.shortLinkCreate.targetLabel : messages['zh-CN'].shortLinkCreate.targetLabel })
  await fireEvent.update(input, 'https://blocked.example/new')
  const submit = screen.getByRole('button', { name: locale === 'en' ? messages.en.shortLinkCreate.submit : messages['zh-CN'].shortLinkCreate.submit })
  await waitFor(() => expect(submit).toHaveProperty('disabled', false)); await fireEvent.click(submit)
  expect(await screen.findByText(reason(locale))).toBeTruthy()
  expect(input).toHaveProperty('value', 'https://blocked.example/new')
  expect(requests.filter(request => request.path === '/api/v1/short-link/create')).toEqual([{ path: '/api/v1/short-link/create', body: { targetUrl: 'https://blocked.example/new' } }])
  expect(requests.filter(request => request.path === '/api/v1/auth/me')).toHaveLength(0)
})
it.each(['en', 'zh-CN'].flatMap(locale => ['own', 'admin'].map(context => ({ locale: locale as 'en' | 'zh-CN', context }))))('keeps the $locale $context settings draft after an explicit restricted save', async ({ locale, context }) => {
  const own = context === 'own'
  const page = defineComponent({ setup() {
    const state = useShortLinkSettings({ mutationFn: own ? updateShortLink : updateAdminShortLink, queryKey: [own ? 'short-link' : 'admin-short-link'] })
    state.configure(link)
    return () => h(ShortLinkSettingsDialog, { link, open: !!state.settingsLink.value, pending: state.settingsMutation.isPending.value, errorMessage: state.settingsErrorMessage.value, onSave: state.saveSettings })
  } })
  mount(page, locale)
  const input = screen.getByRole('textbox', { name: locale === 'en' ? messages.en.shortLinkSettings.targetUrl : messages['zh-CN'].shortLinkSettings.targetUrl })
  await fireEvent.update(input, 'https://blocked.example/changed')
  await fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? messages.en.shortLinkSettings.save : messages['zh-CN'].shortLinkSettings.save }))
  expect(await screen.findByText(reason(locale))).toBeTruthy()
  expect(input).toHaveProperty('value', 'https://blocked.example/changed')
  expect(requests).toEqual([{ path: own ? '/api/v1/short-link/update' : '/api/v1/admin/short-link/update', body: { id: domainId, targetUrl: 'https://blocked.example/changed' } }])
})
