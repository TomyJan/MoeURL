import { fireEvent, render, screen, within } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { defineComponent, h, type Component } from 'vue'
import { vi } from 'vitest'
import { messages } from '@/app/i18n'
import type { CurrentUser } from '@/entities/auth/api'
import type { UserSummary } from '@/entities/user/api'
import AdminUsersPage from '@/pages/AdminUsersPage.vue'
import AppToasts from '@/shared/feedback/AppToasts.vue'

export const batchManager: CurrentUser = { id: '11111111-1111-4111-8111-111111111111', username: 'manager', nickname: 'Manager', group: 'admin', permissions: ['admin:access'] }
export const batchAlice: UserSummary = { id: '22222222-2222-4222-8222-222222222222', username: 'alice', nickname: 'Alice', group: 'user', status: 'active', builtin: false, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T01:02:03.123456Z' }
export const batchBob: UserSummary = { ...batchAlice, id: '33333333-3333-4333-8333-333333333333', username: 'bob', nickname: 'Bob', updatedAt: '2026-10-28T01:02:04.654321Z' }

/** Returns the complete existing server envelope at the controlled HTTP boundary. */
export function membershipResponse(data: unknown, code = 0, status = 200, meta: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ code, message: code ? 'Request failed' : 'OK', data, meta }), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } })
}

/** Mounts the production user page with real QueryClient, Vuetify and translations; only the HTTP server is controlled. */
export function mountBatchMembership(options: { user?: CurrentUser; users?: UserSummary[]; locale?: 'en' | 'zh-CN'; identityReady?: boolean; overrides?: Record<string, () => Response | Promise<Response>>; component?: Component } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } })
  const state = {
    user: options.user ?? { ...batchManager },
    users: (options.users ?? [batchAlice, batchBob]).map(item => ({ ...item })),
    requests: [] as string[],
    writes: [] as { path: string; input: Record<string, unknown> }[],
    overrides: options.overrides ?? {} as Record<string, () => Response | Promise<Response>>,
  }
  if (options.identityReady !== false) client.setQueryData(['auth', 'me'], { user: state.user })
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    state.requests.push(path)
    const input = init?.method === 'POST' ? JSON.parse(init.body as string) as Record<string, unknown> : undefined
    if (input) state.writes.push({ path, input })
    if (state.overrides[path]) return state.overrides[path]()
    if (path === '/api/v1/auth/me') return membershipResponse({ user: state.user })
    if (path.startsWith('/api/v1/admin/user/list?')) return membershipResponse({ items: state.users }, 0, 200, { page: 1, pageSize: 20, total: state.users.length })
    throw new Error('Unexpected membership fixture request: ' + path)
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  const root = defineComponent({ setup: () => () => h('div', [h(AppToasts), h(options.component ?? AdminUsersPage)]) })
  const view = render(root, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives }), createI18n({ legacy: false, locale: options.locale ?? 'en', fallbackLocale: 'en', messages })] } })
  return { ...view, client, state }
}

/** Opens the real current-list confirmation through its visible administrator controls. */
export async function openBatchMembership() {
  await screen.findByText('alice')
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Change selected groups' }))
  return within(screen.getByRole('dialog'))
}

/** Chooses a destination using Vuetify's actual keyboard interaction, then explicitly confirms. */
export async function confirmBatchMembership(group: 'admin' | 'user' = 'admin') {
  const select = screen.getByRole('combobox', { name: 'Target group' })
  await fireEvent.keyDown(select, { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: group === 'admin' ? 'Administrator' : 'User' }))
  await fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm the group changes' }))
}
