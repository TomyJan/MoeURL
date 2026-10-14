import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import SetupPage from './SetupPage.vue'

/** Renders setup against real schema and API code with an isolated query cache. */
function mountSetup(initialized = false) {
  const fetchMock = vi.fn<(path: string, options?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
    code: 0, message: 'OK', data: { initialized, setupTokenRequired: false }, meta: {},
  })))
  vi.stubGlobal('fetch', fetchMock)
  render(SetupPage, { global: {
    stubs: componentStubs,
    plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages }),
      [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
  } })
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('initialization feedback', () => {
  it('explains a short password without sending it or exposing schema internals', async () => {
    const fetchMock = mountSetup()
    await screen.findByTestId('setup-submit')
    await fireEvent.update(screen.getByLabelText('管理员账号'), 'admin')
    await fireEvent.update(screen.getByLabelText('管理员密码'), 'short')
    await fireEvent.update(screen.getByLabelText('管理员昵称'), 'Admin')
    await fireEvent.click(screen.getByTestId('setup-submit'))
    await waitFor(() => expect(screen.getByText('密码至少需要 8 个字符')).toBeTruthy())
    expect(document.body.textContent).not.toContain('too_small')
    expect(document.body.textContent).not.toContain('Zod')
    expect(fetchMock.mock.calls.every(([path]) => !path.endsWith('/init/setup'))).toBe(true)
  })

  it('offers login and home links after initialization', async () => {
    mountSetup(true)
    await screen.findByTestId('setup-completion')
    expect(screen.getByRole('link', { name: '前往登录' }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/')
  })

  it('localizes required fields and an oversized site name', async () => {
    const fetchMock = mountSetup()
    await screen.findByTestId('setup-submit')
    await fireEvent.update(screen.getByLabelText('管理员密码'), 'long-enough')
    await fireEvent.update(screen.getByLabelText('站点名称'), '站'.repeat(65))
    await fireEvent.click(screen.getByTestId('setup-submit'))
    expect(screen.getAllByText('请填写此项')).toHaveLength(2)
    expect(screen.getByText('站点名称需要 1 至 64 个字符')).toBeTruthy()
    expect(fetchMock.mock.calls.every(([path]) => !path.endsWith('/init/setup'))).toBe(true)
  })
})
