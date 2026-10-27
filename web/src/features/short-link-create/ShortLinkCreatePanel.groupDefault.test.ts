import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const globalId = '11111111-1111-4111-8111-111111111111'
const groupId = '22222222-2222-4222-8222-222222222222'
let client: QueryClient
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

it('creates on the group default through the real selector, QueryClient and HTTP boundary', async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const user = { id: 'A', username: 'alice', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'domain:use_assigned'] }
  client.setQueryData(['auth', 'me'], { user })
  const bodies: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    let data: unknown
    if (url === '/api/v1/auth/me') data = { user }
    else if (url === '/api/v1/user/domain-preference') data = { preference: { domainId: null, updatedAt: null } }
    else if (url === '/api/v1/domain/group-default') data = { selection: { domainId: groupId, status: 'available' } }
    else if (url === '/api/v1/domain/available') data = { items: [
      { id: globalId, host: 'global.example', displayName: 'Global', isDefault: true },
      { id: groupId, host: 'group.example', displayName: 'Group', isDefault: false },
    ] }
    else if (url === '/api/v1/short-link/create') { bodies.push(JSON.parse(init.body as string)); return new Response(JSON.stringify({ code: 200114, message: '', data: null, meta: {} })) }
    else throw new Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  render(ShortLinkCreatePanel, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives })], stubs: { ShortLinkQrDialog: true } } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'shortLinkCreate.submit' })).toHaveProperty('disabled', false))
  await fireEvent.update(screen.getByRole('textbox', { name: 'shortLinkCreate.targetLabel' }), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.submit' }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs', domainId: groupId }])
})
