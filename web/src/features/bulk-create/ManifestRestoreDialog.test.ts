import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateDialog from './BulkCreateDialog.vue'
import ManifestRestoreDialog from './ManifestRestoreDialog.vue'

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
function setup(locale: 'zh-CN' | 'en', queuedEvents = false) {
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
    stubs: queuedEvents ? {
      ...componentStubs,
      // Deliver already queued component events even after native controls become disabled.
      VBtn: { props: ['disabled', 'loading'], emits: ['click'], template: '<button :disabled="disabled || loading" @click="$emit(\'click\')" @queuedclick="$emit(\'click\')"><slot /></button>' },
      VDialog: { props: ['modelValue', 'persistent'], emits: ['update:modelValue'], template: '<div v-if="modelValue" role="dialog" :data-persistent="persistent" @queuedclose="$emit(\'update:modelValue\', false)"><slot /></div>' },
    } : componentStubs,
  } })
  return { ...view, posts }
}

async function openRestore(view: ReturnType<typeof setup>, text: string, ordinaryDraft = '') {
  await fireEvent.click(screen.getByTestId('bulk-create-open'))
  if (ordinaryDraft) await fireEvent.update(screen.getByRole('textbox'), ordinaryDraft)
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
  it('hides the restore entry when the default domain is already available', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    clients.push(client)
    client.setQueryData(['auth', 'me'], { user: actor })
    render(ManifestRestoreDialog, { props: { hideWhenDefault: true }, global: {
      plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: componentStubs,
    } })
    expect(screen.queryByTestId('manifest-restore-open')).toBeNull()
  })

  it('retains a pending and unknown restore when ordinary preview or parent close is attempted', async () => {
    const view = setup('en', true)
    let failRequest!: (reason: Error) => void
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      requests.push(String(init?.body))
      return new Promise<Response>((_resolve, reject) => { failRequest = reject })
    }))
    await openRestore(view, csv(), 'https://ordinary.example')
    await waitFor(() => expect(screen.getByTestId('manifest-restore-preview')).toBeTruthy())
    await fireEvent.click(screen.getByTestId('manifest-restore-acknowledge'))
    await fireEvent.click(screen.getByTestId('manifest-restore-confirm'))
    await waitFor(() => expect(requests).toHaveLength(1))
    const preview = screen.getByTestId('bulk-create-preview')
    const close = screen.getByTestId('bulk-create-close')
    expect(preview.hasAttribute('disabled')).toBe(true)
    expect(close.hasAttribute('disabled')).toBe(true)
    await fireEvent(preview, new Event('queuedclick'))
    await fireEvent(close, new Event('queuedclick'))
    await fireEvent(screen.getByRole('dialog'), new Event('queuedclose'))
    await fireEvent(screen.getByTestId('bulk-create-open'), new Event('queuedclick'))
    await fireEvent.change(screen.getByTestId('bulk-create-standard-file'), { target: { files: [new File(['https://replacement.example'], 'other.csv')] } })
    await fireEvent.click(preview)
    await fireEvent.click(close)
    expect(screen.getByTestId('manifest-restore-dialog')).toBeTruthy()
    expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
    failRequest(new Error('response lost'))
    await waitFor(() => expect(screen.getByTestId('manifest-restore-unknown')).toBeTruthy())
    const key = screen.getByTestId('manifest-restore-request-id').textContent
    expect(screen.getByRole('dialog').getAttribute('data-persistent')).toBe('true')
    await fireEvent(preview, new Event('queuedclick'))
    await fireEvent(close, new Event('queuedclick'))
    await fireEvent.click(preview)
    await fireEvent.click(close)
    expect(screen.getByTestId('manifest-restore-request-id').textContent).toBe(key)
    expect(screen.queryByTestId('bulk-create-preview-list')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(String(init?.body))
      const input = JSON.parse(String(init?.body)) as { requestId: string }
      return new Response(JSON.stringify({ code: 0, message: '', data: { requestId: input.requestId, createdCount: 1 }, meta: {} }))
    }))
    await fireEvent.click(screen.getByTestId('manifest-restore-retry'))
    await waitFor(() => expect(screen.getByTestId('manifest-restore-success')).toBeTruthy())
    expect(requests).toEqual([requests[0], requests[0]])
    await fireEvent.click(screen.getByTestId('manifest-restore-close'))
    await fireEvent.click(preview)
    expect(screen.getByTestId('bulk-create-preview-list').textContent).toContain('https://ordinary.example')
  })

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
    expect(screen.getByTestId('manifest-restore-success').textContent).toBe(locale === 'zh-CN' ? '已创建 1 条新短链。' : 'Created 1 new short links.')
    expect(screen.queryByTestId('manifest-restore-error')).toBeNull()
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
