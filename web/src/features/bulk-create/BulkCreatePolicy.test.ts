import { cleanup, fireEvent, render, screen, within } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000008611', username: 'policy-reader', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default'] }

afterEach(() => {
  cleanup()
  clients.splice(0).forEach(client => client.clear())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A stale format/column count at the visible entry point misleads users of a two-column subset.
it.each(['zh-CN', 'en'] as const)('explains sparse CSV fields and defaults in the visible %s dialog policy', async locale => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).endsWith('/auth/me')) return new Response(JSON.stringify({ code: 0, data: { user: actor }, meta: {} }))
    throw new Error('Reading the policy must not create a batch')
  })
  render(BulkCreateDialog, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })], stubs: componentStubs } })
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  const policy = within(screen.getByRole('dialog')).getByText(locale === 'zh-CN' ? /^每行一个 HTTP\(S\) 网址/ : /^One HTTP\(S\) URL per line/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /标准 CSV 按所填字段指定跳转方式/ : /Standard CSV uses the supplied fields for/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /UTC 过期时间、最大访问次数和中间页倒计时/ : /UTC expiration, visit limits and intermediate countdowns/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /省略跳转方式为直接跳转/ : /Omitting the mode uses direct redirects/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /省略倒计时为 5 秒/ : /omitting the countdown uses 5 seconds/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /使用全局默认域名/ : /Uses the global default domain/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /不套用个人或域名默认方式/ : /Personal and domain mode defaults are not applied/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /不是导出清单恢复/ : /not an exported-list restore format/)
  expect(policy.textContent).toMatch(locale === 'zh-CN' ? /最多 20 条/ : /up to 20 distinct/)
  expect(policy.textContent).toMatch(/2048/)
  expect(policy.textContent).toMatch(/Punycode/)
  expect(policy.textContent).not.toMatch(locale === 'zh-CN' ? /前四种|五至八列|六至八列|七至八列|八列可设/ : /first four CSV formats|formats five through eight|six through eight|seven and eight/)
})
