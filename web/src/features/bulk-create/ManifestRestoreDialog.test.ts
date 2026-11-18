import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const actor = {
  id: '00000000-0000-0000-0000-000000009101', username: 'restore-ui', nickname: '', group: 'user',
  permissions: ['short_link:read_own', 'short_link:create', 'short_link:custom_slug', 'short_link:set_metadata', 'domain:use_default'],
}
const csv = (passwordEnabled = 'false') => [
  'id,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username',
  `a1111111-1111-4111-8111-111111119101,https://go.example/res101,res101,https://target.example/path,Safe title,"[""docs""]",active,direct,5,,${passwordEnabled},,3,2026-10-01T00:00:00Z,2026-10-02T00:00:00Z,a1111111-1111-4111-8111-111111119102,old-owner`,
].join('\r\n')

const clients: QueryClient[] = []
function setup(locale: 'zh-CN' | 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const posts: Array<{ url: string; body: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ code: 0, message: '', data: { user: actor }, meta: {} }))
    const body = String(init?.body ?? '')
    posts.push({ url, body })
    const input = JSON.parse(body) as { requestId: string; items: unknown[] }
    return new Response(JSON.stringify({ code: 0, message: '', data: { requestId: input.requestId, createdCount: input.items.length }, meta: {} }))
  }))
  const view = render(BulkCreateDialog, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })],
    stubs: componentStubs,
  } })
  return { ...view, posts }
}

async function openRestore(view: ReturnType<typeof setup>, text: string) {
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  await fireEvent.click(screen.getByTestId('manifest-restore-open'))
  const file = new File([text], 'management-export.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  const input = screen.getByTestId('manifest-restore-file')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await fireEvent(input, new Event('change', { bubbles: true }))
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach(client => client.clear())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('manifest restore panel', () => {
  it.each(['zh-CN', 'en'] as const)('keeps the existing CSV import separate and requires an explicit local-preview confirmation in %s', async locale => {
    const view = setup(locale)
    await openRestore(view, csv())
    await waitFor(() => expect(screen.getByTestId('manifest-restore-preview')).toBeTruthy())
    const dialog = screen.getByTestId('manifest-restore-dialog')
    expect(dialog.textContent).toContain(locale === 'zh-CN' ? '当前账号' : 'current account')
    expect(dialog.textContent).toMatch(locale === 'zh-CN' ? /访问用量.*0/ : /visit use starts at zero/i)
    expect(dialog.textContent).toMatch(locale === 'zh-CN' ? /密码.*无法恢复/ : /passwords?.*cannot be restored/i)
    expect(dialog.textContent).toMatch(locale === 'zh-CN' ? /公式.*前缀.*保留/ : /prevent spreadsheet formulas.*preserved literally.*not unescaped/i)
    expect(dialog.textContent).toContain('1')
    expect(dialog.textContent).toContain('https://go.example')
    expect(screen.getByTestId('manifest-restore-confirm').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('manifest-restore-action-row').className).toContain('manifest-restore-actions')
    expect(screen.getByTestId('bulk-create-standard-file')).toBeTruthy()
    expect(screen.getByTestId('bulk-create-mapping-file')).toBeTruthy()
    expect(view.posts).toEqual([])

    await fireEvent.click(screen.getByTestId('manifest-restore-acknowledge'))
    await fireEvent.click(screen.getByTestId('manifest-restore-confirm'))
    await waitFor(() => expect(view.posts).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('manifest-restore-success')).toBeTruthy())
    expect(view.posts[0]?.url).toBe('/api/v1/short-link/manifest/restore')
    const submitted = JSON.parse(view.posts[0]!.body) as { requestId: string; items: Array<Record<string, unknown>> }
    expect(submitted.items).toEqual([{
      domainOrigin: 'https://go.example', slug: 'res101', targetUrl: 'https://target.example/path', title: 'Safe title', tags: ['docs'],
      status: 'active', redirectMode: 'direct', intermediateDelaySeconds: '5', expiresAt: '', maxVisits: '',
    }])
    expect(view.container.textContent).not.toContain('old-owner')
    expect(view.container.textContent).toContain(locale === 'zh-CN' ? '已创建' : 'Created')
  })

  it('rejects password-enabled rows without exposing row contents or sending a request', async () => {
    const view = setup('en')
    await openRestore(view, csv('true'))
    await waitFor(() => expect(screen.getByTestId('manifest-restore-error')).toBeTruthy())
    expect(screen.getByTestId('manifest-restore-error').textContent).toMatch(/row 2.*password/i)
    expect(screen.getByTestId('manifest-restore-dialog').textContent).not.toContain('https://target.example/path')
    expect(screen.queryByTestId('manifest-restore-confirm')).toBeNull()
    expect(view.posts).toEqual([])
  })

  it('renders safe structural issues without exposing the source row', async () => {
    const view = setup('en')
    await openRestore(view, `${csv()}\r`)
    await waitFor(() => expect(screen.getByTestId('manifest-restore-issue')).toBeTruthy())
    expect(screen.getByTestId('manifest-restore-issue').textContent).toContain('CSV quoting')
    expect(screen.getByTestId('manifest-restore-dialog').textContent).not.toContain('https://target.example/path')
    expect(view.posts).toEqual([])
  })

  it('requires an explicit discard for an unknown request outcome', async () => {
    const view = setup('en')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private transport detail') }))
    await openRestore(view, csv())
    await fireEvent.click(screen.getByTestId('manifest-restore-acknowledge'))
    await fireEvent.click(screen.getByTestId('manifest-restore-confirm'))
    await waitFor(() => expect(screen.getByTestId('manifest-restore-unknown')).toBeTruthy())
    expect(screen.getByTestId('manifest-restore-request-id').textContent).toMatch(/^[0-9a-f-]{36}$/)
    await fireEvent.click(screen.getByTestId('manifest-restore-discard'))
    expect(screen.queryByTestId('manifest-restore-dialog')).toBeNull()
  })
})
