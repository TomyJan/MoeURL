import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { setImmediate } from 'node:timers'
import AnalyticsPage from './AnalyticsPage.vue'
import ConsoleShell from '@/widgets/console-shell/ConsoleShell.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'en-US' }, t: (key: string) => key }) }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: { value: { colors: { primary: 'blue', 'on-surface-variant': 'black', outline: 'gray' } } } } }) }))
vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: class {}, LineElement: class {}, PointElement: class {}, LinearScale: class {}, CategoryScale: class {}, Tooltip: class {} }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const clients: QueryClient[] = []
const id = '00000000-0000-0000-0000-000000000001'
const read = ['short_link:read_own', 'short_link:read_visits']
const grants = [...read, 'short_link:export_visits']
/** Supplies the complete current-user wire shape. */
function auth(permissions = grants) { return { user: { id: 'A', username: 'A', nickname: '', group: 'user', permissions } } }
/** Uses real API decoding for all requests made by the real page and shell. */
function json(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: 'OK', data })) }

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('analytics authorization recovery through the console router', () => {
  it.each(['readable', 'denied', 'failed', 'newer-empty', 'newer-read-then-empty', 'navigated-away'])(
    'keeps revoked grants hidden while resolving %s authorization without losing or restoring an abandoned route', async outcome => {
      const refresh = createDeferred<Response>()
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
      clients.push(client)
      client.setQueryData(['auth', 'me'], auth())
      let reads = 0
      let downloads = 0
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { downloads++ })
      vi.stubGlobal('fetch', async (path: string) => {
        if (path.endsWith('/auth/me')) { reads++; return refresh.promise }
        if (path.includes('/visits/export?')) return json(null, 120001)
        const range = { startDate: '2026-10-20', endDate: '2026-10-26', timeZone: 'UTC' }
        if (path.includes('/visits?')) return json({ range, pageSize: 25, hasMore: false, nextCursor: '', items: [{ id, occurredAt: '2026-10-26T00:00:00Z', referrerHost: 'readable.example', deviceType: null, browserFamily: null, osFamily: null, countryCode: null }] })
        return json({ shortLink: { id, url: 'https://go.example/abc', slug: 'abc', targetUrl: 'https://example.com', title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-10-01T00:00:00Z' }, range, stats: { rangeVisitCount: 1, visitCount: 1, todayVisitCount: 1, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] } })
      })
      const path = `/link/${id}/analytics`
      const router = createRouter({ history: createMemoryHistory(), routes: [
        { path: '/', component: { template: '<p>Public home</p>' } },
        { path: '/other', component: { template: '<p>Other page</p>' } },
        { path: '/link', component: ConsoleShell, meta: { requiresConsole: true }, children: [{ path: ':shortLinkId/analytics', component: AnalyticsPage }] },
      ] })
      await router.push(path)
      await router.isReady()
      render(RouterView, { global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, RouterView: false, ConsoleSidebar: true, ConsoleTopbar: true, ShortLinkCreatePanel: true } } })
      await screen.findByText('readable.example')
      await fireEvent.click(screen.getByTestId('visit-export'))
      await waitFor(() => expect(reads).toBe(1))
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(client.getQueryData(['auth', 'me'])).toEqual(auth([]))
      expect(screen.queryByTestId('visit-records')).toBeNull()
      expect(router.currentRoute.value.path).toBe(path)
      expect(screen.getByText('insights.noAccess')).toBeTruthy()
      if (outcome === 'newer-empty') client.setQueryData(['auth', 'me'], auth([]))
      if (outcome === 'newer-read-then-empty') {
        client.setQueryData(['auth', 'me'], auth(read))
        client.setQueryData(['auth', 'me'], auth([]))
      }
      if (outcome === 'navigated-away') await router.push('/other')
      if (outcome === 'failed') refresh.reject(new Error('offline'))
      else refresh.resolve(json(auth(outcome === 'denied' ? [] : read)))
      await new Promise<void>(resolve => setImmediate(resolve))
      if (outcome === 'readable') {
        await screen.findByText('readable.example')
        expect(router.currentRoute.value.path).toBe(path)
        expect(screen.getByTestId('analytics-summary')).toBeTruthy()
      } else if (outcome === 'navigated-away') {
        expect(router.currentRoute.value.path).toBe('/other')
        expect(screen.getByText('Other page')).toBeTruthy()
      } else await screen.findByText('Public home')
      expect(client.getQueryData(['auth', 'me'])).toEqual(auth(['readable', 'navigated-away'].includes(outcome) ? read : []))
      expect(screen.queryByTestId('visit-export')).toBeNull()
      expect(downloads).toBe(0)
    },
  )
})
