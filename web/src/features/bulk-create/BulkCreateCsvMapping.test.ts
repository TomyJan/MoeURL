import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import BulkCreateCsvMapping from './BulkCreateCsvMapping.vue'
import BulkCreateDialog from './BulkCreateDialog.vue'

const clients: QueryClient[] = []
const words = [
  { locale: 'zh-CN', url: '网址列', title: '标题列（可不导入）', tags: '标签列（可不导入）', ignored: '仅导入明确选择的字段；未选列会被忽略，不会上传。这不是历史数据恢复。' },
  { locale: 'en', url: 'URL column', title: 'Title column (optional)', tags: 'Tags column (optional)', ignored: 'Only explicitly selected fields are imported. Unselected columns are ignored and never uploaded. This does not restore historical data.' },
]
const csvCell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
const mappingValueSelectStub = defineComponent({
  props: ['label', 'modelValue', 'items'],
  emits: ['update:modelValue', 'item:added'],
  setup(props, { emit }) { return () => h('select', { 'aria-label': props.label, 'data-model-value': props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value), onKeydown: (event: KeyboardEvent) => {
    const first = (props.items as { title: string; value: string }[] | undefined)?.[0]
    const noChoiceKey = props.label === 'URL column' ? 'c' : 'd'
    if (event.key.toLowerCase() === noChoiceKey && props.modelValue === '' && first) emit('item:added', first)
  } }, [
    ...((props.items ?? []) as { title: string; value: string }[]).map(item => h('option', { value: item.value }, item.title)),
  ]) },
})
function mount(locale: string, metadata = true, customSlug = false, extraPermissions: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: '00000000-0000-0000-0000-000000008303', username: 'mapping-ui', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', ...(metadata ? ['short_link:set_metadata'] : []), ...(customSlug ? ['short_link:custom_slug'] : []), ...extraPermissions] } })
  const writes: { path: string; input: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    const input = JSON.parse(init!.body as string) as { requestId: string; items?: unknown[]; targetUrls?: string[] }
    writes.push({ path: String(url), input })
    return new Response(JSON.stringify({ code: 0, message: '', data: { requestId: input.requestId, createdCount: (input.items ?? input.targetUrls)!.length }, meta: {} }))
  }))
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const view = render(BulkCreateDialog, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { view, writes }
}
async function select(container: Element, text: string) {
  const file = new File([text], 'local-only.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  const input = container.querySelector<HTMLInputElement>('[data-testid=bulk-create-mapping-file]') ?? container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true }); await fireEvent.change(input)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  return input
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('explicit bilingual mapped CSV controls', () => {
  it('clears the previous matching feedback when headers change without remounting', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    const view = render(BulkCreateCsvMapping, {
      props: { headers: ['url'], target: null, title: null, tags: null, customSlug: null, redirectMode: null, expiration: null, visitLimit: null, countdown: null, titleAllowed: true, tagsAllowed: true, advancedAllowed: true },
      global: { plugins: [i18n], stubs: componentStubs },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect(screen.getByRole('status').textContent).toContain('Filled 1 choices.')
    await view.rerender({ headers: ['an unrecognized header'] })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each([
    { locale: 'en', button: 'Match empty choices by header', matched: 'Filled 2 choices. Check all choices, including More fields, then apply selected columns.', none: 'No additional unambiguous matches. Choose the remaining columns manually.' },
    { locale: 'zh-CN', button: '按表头匹配空选项', matched: '已填充 2 个选项。请检查全部选项（包括更多字段），再应用所选列。', none: '没有可填充的唯一匹配，请手动选择其余列。' },
  ])('reports matching and clears feedback when another file is selected in $locale', async ({ locale, button, matched, none }) => {
    const { view, writes } = mount(locale); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'url,title,Private\nhttps://example.com/one,One,hidden-one')
    await fireEvent.click(screen.getByRole('button', { name: button }))
    expect(screen.getByRole('status').textContent).toBe(matched)
    await fireEvent.click(screen.getByRole('button', { name: button }))
    expect(screen.getByRole('status').textContent).toBe(none)
    await select(view.container, 'Private,Address\nhidden-two,https://example.com/two')
    expect(screen.queryByRole('status')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: button }))
    expect(screen.getByRole('status').textContent).toBe(none)
    expect(view.container.textContent).not.toContain('hidden-two'); expect(writes).toEqual([])
  })

  it('preserves a hand-picked URL and leaves denied and ambiguous choices empty', async () => {
    const { view, writes } = mount('en', false); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'url,target_url,title,tags,slug,Address\nhttps://example.com/a,https://example.com/b,Title,[],code,https://example.com/manual')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect((screen.getByRole('combobox', { name: 'URL column' }) as HTMLSelectElement).value).toBe('')
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '5')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    for (const [label, value] of [['URL column', '5'], ['Title column (optional)', ''], ['Tags column (optional)', ''], ['Custom short code column (optional)', '']]) {
      expect((screen.getByRole('combobox', { name: label }) as HTMLSelectElement).value).toBe(value)
    }
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual'); expect(writes).toEqual([])
  })

  it('matches all eight permitted fields through the unchanged countdown request', async () => {
    const { view, writes } = mount('en', true, true, ['short_link:use_intermediate', 'short_link:set_expiration', 'short_link:set_max_visits'])
    await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'url,标题,标签,短码,跳转方式,过期时间,最大访问次数,倒计时\nhttps://example.com/all,All,[],alias89,intermediate,2030-01-02T03:04:05Z,8,3')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect(screen.getByRole('status').textContent).toContain('Filled 8 choices.')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-countdowns', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/all', title: 'All', tags: [], customSlug: 'alias89', redirectMode: 'intermediate', expiresAt: '2030-01-02T03:04:05Z', maxVisits: '8', intermediateDelaySeconds: '3' }] } }])
  })

  it('matches header aliases only on request and submits only the checked safe columns', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/kept-draft')
    await select(view.container, 'Private, URL ,标题\nnever-send-this,https://example.com/matched,Safe title')
    const url = screen.getByRole('combobox', { name: 'URL column' }) as HTMLSelectElement
    const title = screen.getByRole('combobox', { name: 'Title column (optional)' }) as HTMLSelectElement
    expect(url.value).toBe(''); expect(title.value).toBe('')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect(url.value).toBe('1'); expect(title.value).toBe('2')
    expect(view.container.textContent).not.toContain('never-send-this'); expect(writes).toEqual([])
    expect((screen.getByTestId('bulk-create-preview') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-cancel'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/kept-draft')
    await select(view.container, 'Private, URL ,标题\nnever-send-this,https://example.com/matched,Safe title')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.textContent).toContain('Safe title')
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-titles', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/matched', title: 'Safe title' }] } }])
  })

  it('keeps explicit no-import choices empty when matching is requested again', async () => {
    const { view, writes } = mount('en', true, true); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    const target = 'https://example.com/keep-only-target'
    await select(view.container, 'url,title,tags,slug\n' + target + ',Do not import,' + csvCell(JSON.stringify(['docs'])) + ',safe89')
    const url = screen.getByRole('combobox', { name: 'URL column' }) as HTMLSelectElement
    const title = screen.getByRole('combobox', { name: 'Title column (optional)' }) as HTMLSelectElement
    const tags = screen.getByRole('combobox', { name: 'Tags column (optional)' }) as HTMLSelectElement
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect([url.value, title.value, tags.value]).toEqual(['0', '1', '2'])
    await fireEvent.click(screen.getByText('More fields (optional)'))
    const slug = screen.getByRole('combobox', { name: 'Custom short code column (optional)' }) as HTMLSelectElement
    expect(slug.value).toBe('3')
    await fireEvent.update(title, ''); await fireEvent.update(tags, ''); await fireEvent.update(slug, '')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect([url.value, title.value, tags.value, slug.value]).toEqual(['0', '', '', ''])
    expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.querySelector('textarea')!.value).toBe(target)
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create', input: { requestId: expect.any(String), targetUrls: [target] } }])
  })

  it('retires explicit no-import choices when a new file is selected', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'url,title\nhttps://example.com/old,Old')
    await fireEvent.update(screen.getByRole('combobox', { name: 'Title column (optional)' }), '')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect((screen.getByRole('combobox', { name: 'Title column (optional)' }) as HTMLSelectElement).value).toBe('')
    await select(view.container, 'url,title\nhttps://example.com/new,New')
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))
    expect((screen.getByRole('combobox', { name: 'Title column (optional)' }) as HTMLSelectElement).value).toBe('1')
    expect(screen.getByRole('status').textContent).toContain('Filled 2 choices.')
    expect(writes).toEqual([])
  })

  it('renders the currently selected advanced columns as the chosen values', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    render(BulkCreateCsvMapping, {
      props: { headers: ['Address', 'Code', 'Mode', 'Deadline', 'Cap', 'Countdown', 'Title', 'Labels'], target: 0, title: 6, tags: 7, customSlug: 1, redirectMode: 2, expiration: 3, visitLimit: 4, countdown: 5, titleAllowed: true, tagsAllowed: true, advancedAllowed: true },
      global: { plugins: [i18n], stubs: componentStubs },
    })
    for (const [label, value] of [
      ['URL column', '0'], ['Title column (optional)', '6'], ['Tags column (optional)', '7'],
      ['Custom short code column (optional)', '1'], ['Redirect mode column (optional)', '2'],
      ['Expiration column (optional)', '3'], ['Maximum visits column (optional)', '4'],
      ['Intermediate countdown column (optional)', '5'],
    ]) expect((screen.getByRole('combobox', { name: label }) as HTMLSelectElement).value).toBe(value)
  })

  it('renders every advanced mapping as explicitly unselected by default', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    render(BulkCreateCsvMapping, {
      props: { headers: ['Address', 'Code'], target: 0, title: null, tags: null, customSlug: null, redirectMode: null, expiration: null, visitLimit: null, countdown: null, titleAllowed: true, tagsAllowed: true, advancedAllowed: true },
      global: { plugins: [i18n], stubs: { ...componentStubs, VSelect: mappingValueSelectStub } },
    })
    for (const label of [
      'Custom short code column (optional)', 'Redirect mode column (optional)', 'Expiration column (optional)',
      'Maximum visits column (optional)', 'Intermediate countdown column (optional)',
    ]) expect(screen.getByRole('combobox', { name: label }).getAttribute('data-model-value')).toBe('')
  })

  it('emits selected indices and clears for each optional advanced mapping', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    const updates = Object.fromEntries(['customSlug', 'redirectMode', 'expiration', 'visitLimit', 'countdown'].map(key => [key, vi.fn()]))
    render(defineComponent({ setup: () => () => h(BulkCreateCsvMapping, {
      headers: ['Address', 'Optional'], target: 0, title: null, tags: null, customSlug: null, redirectMode: null,
      expiration: null, visitLimit: null, countdown: null, titleAllowed: true, tagsAllowed: true, advancedAllowed: true,
      ...Object.fromEntries(Object.entries(updates).map(([key, listener]) => [`onUpdate:${key}`, listener])),
    }) }), { global: { plugins: [i18n], stubs: { ...componentStubs, VSelect: mappingValueSelectStub } } })
    await fireEvent.click(screen.getByText('More fields (optional)'))
    const controls = [
      ['Custom short code column (optional)', 'customSlug'], ['Redirect mode column (optional)', 'redirectMode'],
      ['Expiration column (optional)', 'expiration'], ['Maximum visits column (optional)', 'visitLimit'],
      ['Intermediate countdown column (optional)', 'countdown'],
    ] as const
    for (const [label, key] of controls) {
      const control = screen.getByRole('combobox', { name: label })
      await fireEvent.update(control, '1')
      await fireEvent.update(control, '')
      expect(updates[key]).toHaveBeenNthCalledWith(1, 1)
      expect(updates[key]).toHaveBeenNthCalledWith(2, null)
    }
  })

  it('keeps same-value keyboard no-import selections excluded from later matches', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    const view = render(BulkCreateCsvMapping, { props: {
      headers: ['url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at', 'max_visits', 'intermediate_delay_seconds'], target: null, title: null, tags: null, customSlug: null, redirectMode: null,
      expiration: null, visitLimit: null, countdown: null, titleAllowed: true, tagsAllowed: true, advancedAllowed: true,
    }, global: { plugins: [i18n], stubs: { ...componentStubs, VSelect: mappingValueSelectStub } } })

    for (const label of ['Title column (optional)', 'Tags column (optional)']) {
      await fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'd' })
    }
    await fireEvent.click(screen.getByText('More fields (optional)'))
    for (const label of [
      'Custom short code column (optional)', 'Redirect mode column (optional)', 'Expiration column (optional)',
      'Maximum visits column (optional)', 'Intermediate countdown column (optional)',
    ]) await fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'd' })
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))

    expect(screen.getByRole('status').textContent).toContain('Filled 1 choices.')
    expect(view.emitted()['update:title']).toBeUndefined()
  })

  it('keeps a keyboard-cleared required URL distinct from an untouched empty choice', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
    const view = render(BulkCreateCsvMapping, { props: {
      headers: ['url'], target: null, title: null, tags: null, customSlug: null, redirectMode: null,
      expiration: null, visitLimit: null, countdown: null, titleAllowed: true, tagsAllowed: true, advancedAllowed: true,
    }, global: { plugins: [i18n], stubs: { ...componentStubs, VSelect: mappingValueSelectStub } } })

    await fireEvent.keyDown(screen.getByRole('combobox', { name: 'URL column' }), { key: 'c' })
    await fireEvent.click(screen.getByRole('button', { name: 'Match empty choices by header' }))

    expect(screen.getByRole('status').textContent).toContain('No additional unambiguous matches.')
    expect(view.emitted()['update:target']).toBeUndefined()
  })

  // A dropped authority guard or an accidental titles projection would change the actual HTTP payload.
  it('disables title mapping without metadata and creates the selected URLs through the original targets protocol', async () => {
    const { view, writes } = mount('en', false); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'Secret,Address,Name\nprivate,https://example.com/url-only,Ignored title')
    expect((screen.getByRole('combobox', { name: 'Title column (optional)' }) as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Tags column (optional)' }) as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('This account can import URLs only because it lacks metadata permission.')).toBeTruthy()
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/url-only')
    expect(view.container.textContent).not.toContain('Ignored title'); expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create', input: { requestId: expect.any(String), targetUrls: ['https://example.com/url-only'] } }])
  })

  it('maps all advanced fields through the existing countdown API', async () => {
    const { view, writes } = mount('en', true, true, ['short_link:use_intermediate', 'short_link:set_expiration', 'short_link:set_max_visits']); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'Address,Short code,Mode,Deadline,Cap,Delay,Title,Labels\nhttps://example.com/mapped,docs7,intermediate,2030-01-02T03:04:05Z,9,3,Quarterly update,"[""docs"",""engineering""]"')
    await waitFor(() => expect(screen.getByTestId('bulk-create-csv-mapping')).toBeTruthy())
    await fireEvent.click(screen.getByText('More fields (optional)'))
    for (const [label, column] of [
      ['URL column', '0'], ['Title column (optional)', '6'], ['Tags column (optional)', '7'],
      ['Custom short code column (optional)', '1'], ['Redirect mode column (optional)', '2'],
      ['Expiration column (optional)', '3'], ['Maximum visits column (optional)', '4'],
      ['Intermediate countdown column (optional)', '5'],
    ]) {
      const control = screen.getByRole('combobox', { name: label })
      await fireEvent.update(control, column); expect((control as HTMLSelectElement).value).toBe(column)
    }
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.textContent).toContain('docs7'); expect(view.container.textContent).toContain('Quarterly update')
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-countdowns', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/mapped', title: 'Quarterly update', tags: ['docs', 'engineering'], customSlug: 'docs7', redirectMode: 'intermediate', expiresAt: '2030-01-02T03:04:05Z', maxVisits: '9', intermediateDelaySeconds: '3' }] } }])
  })

  it.each([
    { locale: 'en', title: 'More fields (optional)', labels: ['Custom short code column (optional)', 'Redirect mode column (optional)', 'Expiration column (optional)', 'Maximum visits column (optional)', 'Intermediate countdown column (optional)'] },
    { locale: 'zh-CN', title: '更多字段（可选）', labels: ['自定义短码列（可不导入）', '跳转方式列（可不导入）', '过期时间列（可不导入）', '最大访问次数列（可不导入）', '中间页倒计时列（可不导入）'] },
  ])('shows all advanced choices but disables them without structural permission in $locale', async ({ locale, title, labels }) => {
    const { view } = mount(locale); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'URL,Code\nhttps://example.com/a,unused')
    await fireEvent.click(screen.getByText(title))
    for (const label of labels) expect((screen.getByRole('combobox', { name: label }) as HTMLSelectElement).disabled).toBe(true)
  })

  it('requires JSON tags, preserves the prior draft on refusal and writes only explicit fields', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/manual')
    await select(view.container, 'Address,Category,Private\nhttps://example.com/first,[1],private-secret')
    expect(screen.getByText('Use a JSON array containing only strings, for example ["docs","engineering"]. [] means no tags; an empty cell is invalid.')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Tags column (optional)' }) as HTMLSelectElement).disabled).toBe(false)
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '0')
    await fireEvent.update(screen.getByRole('combobox', { name: 'Tags column (optional)' }), '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy(); expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    expect(view.container.textContent).not.toContain('private-secret'); expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-cancel'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, 'Address,Category,Private\nhttps://example.com/tagged,' + csvCell(JSON.stringify(['docs', '工程'])) + ',private-secret')
    await fireEvent.update(screen.getByRole('combobox', { name: 'URL column' }), '0')
    await fireEvent.update(screen.getByRole('combobox', { name: 'Tags column (optional)' }), '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.textContent).toContain('工程'); expect(view.container.textContent).not.toContain('private-secret')
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-metadata', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/tagged', title: '', tags: ['docs', '工程'] }] } }])
  })

  // Unescaped markup, missing control replacement or UTF-16 slicing must break these user-visible labels.
  it('numbers empty and duplicate headers and shows only bounded plain-text header labels', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, ',Same,Same,<img src=x onerror=secret>,Control\u0000,"' + '😀'.repeat(61) + '"\n,one,two,private,hidden,https://example.com')
    const options = [...(screen.getByRole('combobox', { name: 'URL column' }) as HTMLSelectElement).options].map(option => option.textContent)
    expect(options).toEqual(['Choose the URL column', 'Column 1: Unnamed header', 'Column 2: Same', 'Column 3: Same', 'Column 4: <img src=x onerror=secret>', 'Column 5: Control�', 'Column 6: ' + '😀'.repeat(60) + '…'])
    expect(view.container.querySelector('img')).toBeNull(); expect(view.container.querySelector('[title]')).toBeNull()
    expect(view.container.textContent).not.toContain('private'); expect(view.container.textContent).not.toContain('hidden'); expect(writes).toEqual([])
  })

  it('clears optional title and tags without importing either or bypassing the required URL choice', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await select(view.container, 'Address,Name\nhttps://example.com/cleared,Should not import')
    const url = screen.getByRole('combobox', { name: 'URL column' }), title = screen.getByRole('combobox', { name: 'Title column (optional)' }), tags = screen.getByRole('combobox', { name: 'Tags column (optional)' })
    await fireEvent.update(url, '0'); await fireEvent.update(title, '1'); await fireEvent.update(tags, '1'); await fireEvent.update(url, '')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy(); expect(writes).toEqual([])
    await fireEvent.update(url, '0'); await fireEvent.update(title, ''); await fireEvent.update(tags, '');
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/cleared')
    expect(screen.queryByTestId('bulk-create-imported-list')).toBeNull()
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create', input: { requestId: expect.any(String), targetUrls: ['https://example.com/cleared'] } }])
  })

  it('keeps the manual draft after empty file selection and safe structural rejection without a standard-header diagnosis', async () => {
    const { view, writes } = mount('en'); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/manual')
    await fireEvent.change(screen.getByTestId('bulk-create-mapping-file'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, 'A,B\nhttps://secret.invalid')
    expect(screen.getByTestId('bulk-create-csv-issue').textContent).toBe('CSV record 2 has a different field count from the header.')
    expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('secret')
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, 'A,B,C,D,E,F,G,H,I\n1,2,3,4,5,6,7,8,9')
    expect(screen.queryByTestId('bulk-create-csv-issue')).toBeNull()
    expect(screen.getByTestId('bulk-create-error').textContent).not.toContain('standard column')
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual'); expect(writes).toEqual([])
  })

  it.each(words)('preserves a draft on cancel, requires valid choices and sends selected URL, title and JSON tags in $locale', async text => {
    const { view, writes } = mount(text.locale); await fireEvent.click(screen.getByTestId('bulk-create-open'))
    await fireEvent.update(view.container.querySelector('textarea')!, 'https://example.com/manual')
    const csv = '<img src=x onerror=secret>,Address,Name,Categories\nprivate,https://example.com/chosen,Chosen title,' + csvCell(JSON.stringify(['工程', 'docs']))
    const input = await select(view.container, csv)
    expect(screen.queryByTestId('bulk-create-error')).toBeNull()
    expect(input.value).toBe(''); expect(screen.getByText(text.ignored)).toBeTruthy()
    expect(view.container.querySelector('img')).toBeNull()
    expect((screen.getByTestId('bulk-create-preview') as HTMLButtonElement).disabled).toBe(true)
    expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-cancel'))
    expect(view.container.querySelector('textarea')!.value).toBe('https://example.com/manual')
    await select(view.container, csv)
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    const url = screen.getByRole('combobox', { name: text.url }), title = screen.getByRole('combobox', { name: text.title })
    const tags = screen.getByRole('combobox', { name: text.tags })
    await fireEvent.update(url, '1'); await fireEvent.update(title, '1')
    await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    await fireEvent.update(title, '2'); await fireEvent.update(tags, '2'); await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.getByTestId('bulk-create-error')).toBeTruthy(); expect(document.activeElement).toBe(screen.getByTestId('bulk-create-error-feedback'))
    await fireEvent.update(tags, '3'); await fireEvent.click(screen.getByTestId('bulk-create-mapping-apply'))
    expect(screen.queryByTestId('bulk-create-csv-mapping')).toBeNull()
    expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('Chosen title')
    expect(screen.getByTestId('bulk-create-imported-list').textContent).toContain('工程')
    expect(view.container.textContent).not.toContain('private'); expect(writes).toEqual([])
    await fireEvent.click(screen.getByTestId('bulk-create-preview')); await fireEvent.click(screen.getByTestId('bulk-create-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes).toEqual([{ path: '/api/v1/short-link/batch-create-with-metadata', input: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/chosen', title: 'Chosen title', tags: ['工程', 'docs'] }] } }])
  })
})
