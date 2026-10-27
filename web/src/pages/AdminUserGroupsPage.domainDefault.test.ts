import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import AdminUserGroupsPage from './AdminUserGroupsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
const domainId = '22222222-2222-4222-8222-222222222222'
const version = '2026-10-27T00:00:00.123456789Z'
let client: QueryClient
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

it('saves a target group default using the original full revision through the real page', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const user = { id: 'A', username: 'admin', nickname: '', group: 'admin', permissions: ['admin:access', 'domain:manage'] }
  client.setQueryData(['auth', 'me'], { user })
  const bodies: unknown[] = []
  const settings: Record<string, string | null> = { guest: null, user: null, admin: null }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    let data: unknown
    if (url === '/api/v1/auth/me') data = { user }
    else if (url === '/api/v1/admin/user-group/list') data = {
      groups: ['guest', 'user', 'admin'].map((key) => ({ key, name: key, description: '', builtin: true, editable: key !== 'guest', permissions: [], updatedAt: version })),
      permissions: [], presets: ['restricted', 'basic', 'standard'].map((key) => ({ key, applicableGroups: ['user', 'admin'], permissions: [] })),
    }
    else if (url.startsWith('/api/v1/admin/user-group/domain-default?') || url === '/api/v1/admin/user-group/set-domain-default') {
      const input = url.endsWith('/set-domain-default') ? JSON.parse(init.body as string) : { groupKey: new URL(url, 'https://app.example').searchParams.get('groupKey') }
      if (url.endsWith('/set-domain-default')) { bodies.push(input); settings[input.groupKey] = input.domainId }
      data = { setting: { groupKey: input.groupKey, domainId: settings[input.groupKey], updatedAt: version, editable: input.groupKey !== 'guest' }, candidates: input.groupKey === 'guest' ? [] : [{ id: domainId, host: 'group.example', displayName: 'Group', isDefault: false }] }
    } else throw new Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  render(AdminUserGroupsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives })] } })
  await fireEvent.click(await screen.findByRole('tab', { name: 'user' }))
  const select = await screen.findByRole('combobox', { name: 'groupDefault.domain' })
  await fireEvent.keyDown(select, { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: 'Group (group.example)' }))
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await waitFor(() => expect(bodies).toEqual([{ groupKey: 'user', domainId, expectedUpdatedAt: version }]))
})
