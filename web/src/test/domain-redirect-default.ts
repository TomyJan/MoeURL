import { render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vi } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import { messages } from '@/app/i18n'
import AppToasts from '@/shared/feedback/AppToasts.vue'
import type { ManagedDomain } from '@/entities/domain/api'

export const globalId = '11111111-1111-4111-8111-111111111111'
export const otherId = '22222222-2222-4222-8222-222222222222'
export const enhanced = ['short_link:create', 'domain:use_default', 'domain:use_assigned', 'short_link:use_intermediate', 'short_link:use_confirmation']
export const domainChoices = [{ id: globalId, host: 'global.example', displayName: 'Global', isDefault: true }, { id: otherId, host: 'other.example', displayName: 'Other', isDefault: false }]
export const revision = '2026-10-28T00:00:00.123456Z'
export const nextRevision = '2026-10-28T00:00:01.123456Z'

/** Provides a complete API envelope at the only substituted business boundary. */
export function redirectResponse(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: '', data, meta: {} })) }

/** Uses real parents, Vuetify, i18n and QueryClient; only HTTP is controlled. */
export function mountRedirectDefaults(component: Component, options: { admin?: boolean; permissions?: string[]; domains?: typeof domainChoices; overrides?: Record<string, () => Promise<Response>>; locale?: 'en' | 'zh-CN' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  const state = {
    user: { id: 'A', username: 'alice', nickname: '', group: options.admin ? 'admin' : 'user', permissions: options.permissions ?? (options.admin ? [...enhanced, 'admin:access', 'domain:manage'] : enhanced) },
    domains: options.domains ?? domainChoices,
    managed: (options.domains ?? domainChoices).map((domain) => ({ ...domain, purpose: 'short_link', enabled: true, sortOrder: 0, allowedGroups: ['user', 'admin'], referenced: false, updatedAt: revision })) as ManagedDomain[],
    defaults: [{ domainId: globalId, redirectMode: 'confirmation' }, { domainId: otherId, redirectMode: 'intermediate' }],
    requests: [] as string[], writes: [] as Array<Record<string, unknown>>, writePaths: [] as string[], overrides: { ...options.overrides },
  }
  let clock = 0
  /** Models the server's shared revision without normalizing its microsecond precision. */
  function advance() { return '2026-10-28T00:00:' + String(++clock).padStart(2, '0') + '.123456Z' }
  client.setQueryData(['auth', 'me'], { user: state.user })
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    state.requests.push(path)
    const input = init?.method === 'POST' ? JSON.parse(init.body as string) : undefined
    if (input) { state.writes.push(input); state.writePaths.push(path) }
    if (state.overrides[path]) return state.overrides[path]()
    if (path === '/api/v1/auth/me') return redirectResponse({ user: state.user })
    if (path === '/api/v1/user/domain-preference') return redirectResponse({ preference: { domainId: null, updatedAt: null } })
    if (path === '/api/v1/user/redirect-preference') return redirectResponse({ preference: { redirectMode: null, updatedAt: null } })
    if (path === '/api/v1/domain/group-default') return redirectResponse({ selection: { domainId: null, status: 'not_set' } })
    if (path === '/api/v1/domain/available') return redirectResponse({ items: state.domains })
    if (path === '/api/v1/domain/redirect-defaults') return redirectResponse({ items: state.defaults })
    if (path === '/api/v1/admin/domain/list') return redirectResponse({ items: state.managed })
    if (path.startsWith('/api/v1/admin/domain/redirect-default?')) {
      const id = new URL(path, 'https://app.example').searchParams.get('id')
      const domain = state.managed.find((domain) => domain.id === id)
      return domain ? redirectResponse({ setting: { domainId: id, redirectMode: state.defaults.find((item) => item.domainId === id)?.redirectMode ?? 'direct', updatedAt: domain.updatedAt } }) : redirectResponse(null, 210102)
    }
    if (path === '/api/v1/admin/domain/set-redirect-default') {
      const domain = state.managed.find((domain) => domain.id === input.id)
      if (!domain) return redirectResponse(null, 210102)
      if (domain.updatedAt !== input.expectedUpdatedAt) return redirectResponse(null, 210103)
      state.defaults = state.defaults.map((item) => item.domainId === input.id ? { ...item, redirectMode: input.redirectMode } : item)
      domain.updatedAt = advance()
      return redirectResponse({ setting: { domainId: input.id, redirectMode: input.redirectMode, updatedAt: domain.updatedAt } })
    }
    if (path === '/api/v1/admin/domain/update' || path === '/api/v1/admin/domain/set-order') {
      const domain = state.managed.find((domain) => domain.id === input.id)
      if (!domain) return redirectResponse(null, 210102)
      if (domain.updatedAt !== input.expectedUpdatedAt) return redirectResponse(null, 210103)
      if (path.endsWith('set-order')) domain.sortOrder = input.sortOrder
      else Object.assign(domain, { host: input.host, displayName: input.displayName, enabled: input.enabled, allowedGroups: input.allowedGroups })
      domain.updatedAt = advance()
      return redirectResponse({ domain })
    }
    if (path === '/api/v1/short-link/create') return redirectResponse(null, 200114)
    throw new Error('Unexpected fixture request: ' + path)
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  const root = defineComponent({ setup: () => () => h('div', [h(AppToasts), h(component)]) })
  const view = render(root, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives }), createI18n({ legacy: false, locale: options.locale ?? 'en', fallbackLocale: 'en', messages })], stubs: { ShortLinkQrDialog: true } } })
  return { ...view, client, state }
}
