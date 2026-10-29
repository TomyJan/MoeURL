import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHomeContent, updateHomeContent, adminHomeContentKey, publicHomeContentKey, type HomeContentSettings } from '@/entities/home-content/api'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import HomeContentEditor from './HomeContentEditor.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/entities/home-content/api', async (original) => ({ ...await original<typeof import('@/entities/home-content/api')>(), getHomeContent: vi.fn(), updateHomeContent: vi.fn() }))
const initial = { title: 'Original title', summary: 'Original summary', updatedAt: '2026-10-29T07:00:00.123456Z' }
const saved = { title: 'Saved title', summary: 'Saved summary', updatedAt: '2026-10-29T07:01:00.654321Z' }
let client: QueryClient
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id, group: id ? 'admin' : 'guest', permissions } })
}
function mountEditor() {
  return render(HomeContentEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
}
const title = () => screen.getByLabelText('homeContent.title') as HTMLInputElement
const summary = () => screen.getByLabelText('homeContent.summary') as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'homeContent.save' }) as HTMLButtonElement
const reload = () => screen.getByRole('button', { name: 'homeContent.reload' }) as HTMLButtonElement
async function ready() {
  await waitFor(() => {
    expect(title().value).toBe(initial.title)
    expect(save().disabled).toBe(false)
  })
}

describe('HomeContentEditor', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    vi.mocked(getHomeContent).mockReset().mockResolvedValue({ ...initial })
    vi.mocked(updateHomeContent).mockReset().mockResolvedValue({ ...saved })
    auth()
  })
  afterEach(() => { cleanup(); client.clear() })

  it('submits a complete independent revision, updates only its own cache and invalidates public copy', async () => {
    client.setQueryData(['admin', 'system', 'settings'], { marker: 'old settings' })
    client.setQueryData(['system', 'public-config'], { marker: 'old public' })
    client.setQueryData(publicHomeContentKey, { title: 'old', summary: '' })
    mountEditor(); await ready()
    await fireEvent.update(title(), ' New title ')
    await fireEvent.update(summary(), ' New summary ')
    await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('homeContent.saved')).toBeTruthy())
    expect(updateHomeContent).toHaveBeenCalledExactlyOnceWith({ title: 'New title', summary: 'New summary', expectedUpdatedAt: initial.updatedAt })
    expect(title().value).toBe(saved.title)
    expect(client.getQueryData(['admin', 'system', 'settings'])).toEqual({ marker: 'old settings' })
    expect(client.getQueryData(['system', 'public-config'])).toEqual({ marker: 'old public' })
    expect(client.getQueryState(publicHomeContentKey)?.isInvalidated).toBe(true)
    expect(client.getQueriesData({ queryKey: adminHomeContentKey }).some(([, data]) => (data as HomeContentSettings)?.updatedAt === saved.updatedAt)).toBe(true)
  })
  it('keeps draft on conflict until an explicit reload and never automatically retries a write', async () => {
    vi.mocked(updateHomeContent).mockRejectedValue(new ApiClientError(900205, 'Conflict'))
    mountEditor(); await ready()
    await fireEvent.update(title(), 'My draft')
    await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('homeContent.conflict')).toBeTruthy())
    expect(title().value).toBe('My draft')
    expect(getHomeContent).toHaveBeenCalledTimes(1)
    expect(updateHomeContent).toHaveBeenCalledTimes(1)
    vi.mocked(getHomeContent).mockResolvedValue(saved)
    await fireEvent.click(reload())
    await waitFor(() => expect(title().value).toBe(saved.title))
    expect(screen.queryByText('homeContent.conflict')).toBeNull()
    vi.mocked(updateHomeContent).mockResolvedValue(saved)
    await fireEvent.click(save())
    await waitFor(() => expect(updateHomeContent).toHaveBeenLastCalledWith({ title: saved.title, summary: saved.summary, expectedUpdatedAt: saved.updatedAt }))
  })
  it.each(['title', 'summary'] as const)('clears a prior saved confirmation when %s is edited and preserves the saved revision', async (field) => {
    mountEditor(); await ready()
    await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('homeContent.saved')).toBeTruthy())
    const input = field === 'title' ? title() : summary()
    await fireEvent.update(input, 'A new unsaved draft')
    expect(input.value).toBe('A new unsaved draft')
    expect(screen.queryByText('homeContent.saved')).toBeNull()
    await fireEvent.click(save())
    await waitFor(() => expect(updateHomeContent).toHaveBeenLastCalledWith({
      title: field === 'title' ? 'A new unsaved draft' : saved.title,
      summary: field === 'summary' ? 'A new unsaved draft' : saved.summary,
      expectedUpdatedAt: saved.updatedAt,
    }))
  })
  it('retains a conflict diagnosis when the rejected draft is edited', async () => {
    vi.mocked(updateHomeContent).mockRejectedValue(new ApiClientError(900205, 'Conflict'))
    mountEditor(); await ready()
    await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('homeContent.conflict')).toBeTruthy())
    await fireEvent.update(title(), 'Revised conflicting draft')
    expect(screen.getByText('homeContent.conflict')).toBeTruthy()
    expect(title().value).toBe('Revised conflicting draft')
    expect(updateHomeContent).toHaveBeenCalledTimes(1)
  })
  it('counts emoji as one codepoint and allows independent empty defaults without UTF16 truncation', async () => {
    mountEditor(); await ready()
    await fireEvent.update(title(), '🌲'.repeat(80))
    await fireEvent.update(summary(), '🌲'.repeat(200))
    expect(screen.getByText('80 / 80')).toBeTruthy()
    expect(screen.getByText('200 / 200')).toBeTruthy()
    await fireEvent.click(save())
    await waitFor(() => expect(updateHomeContent).toHaveBeenCalledWith({ title: '🌲'.repeat(80), summary: '🌲'.repeat(200), expectedUpdatedAt: initial.updatedAt }))
    await waitFor(() => expect(save().disabled).toBe(false))
    await fireEvent.update(title(), ' '); await fireEvent.update(summary(), '')
    await fireEvent.click(save())
    await waitFor(() => expect(updateHomeContent).toHaveBeenLastCalledWith({ title: '', summary: '', expectedUpdatedAt: saved.updatedAt }))
  })
  it.each([['x'.repeat(81), ''], ['', '🌲'.repeat(201)], ['\tTitle', ''], ['', 'Summary\u0085']])('rejects invalid draft before transport %#', async (nextTitle, nextSummary) => {
    mountEditor(); await ready()
    await fireEvent.update(title(), nextTitle); await fireEvent.update(summary(), nextSummary)
    await fireEvent.click(save())
    expect(screen.getByText('homeContent.invalid')).toBeTruthy()
    expect(updateHomeContent).not.toHaveBeenCalled()
  })
  it('disables duplicate saves and reloads during a pending write and permits retry after failure', async () => {
    const pending = createDeferred<HomeContentSettings>()
    vi.mocked(updateHomeContent).mockReturnValueOnce(pending.promise)
    mountEditor(); await ready()
    await fireEvent.click(save())
    expect(save().disabled).toBe(true); expect(reload().disabled).toBe(true); expect(title().disabled).toBe(true)
    await fireEvent.submit(save().closest('form')!)
    expect(updateHomeContent).toHaveBeenCalledTimes(1)
    pending.reject(new Error('offline'))
    await waitFor(() => expect(screen.getByText('homeContent.saveFailed')).toBeTruthy())
    expect(title().value).toBe(initial.title); expect(save().disabled).toBe(false)
    await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('homeContent.saved')).toBeTruthy())
  })
  it('shows a retryable initial load failure and never sends an unversioned write', async () => {
    vi.mocked(getHomeContent).mockRejectedValueOnce(new Error('offline'))
    mountEditor()
    await waitFor(() => expect(screen.getByText('homeContent.loadFailed')).toBeTruthy())
    expect(save().disabled).toBe(true)
    await fireEvent.submit(save().closest('form')!)
    expect(updateHomeContent).not.toHaveBeenCalled()
    await fireEvent.click(reload()); await ready()
  })
  it('does not overwrite edits made while an explicit reload is pending', async () => {
    mountEditor(); await ready()
    const pending = createDeferred<HomeContentSettings>()
    vi.mocked(getHomeContent).mockReturnValueOnce(pending.promise)
    await fireEvent.click(reload())
    await fireEvent.update(title(), 'Newer edit')
    pending.resolve(saved)
    await waitFor(() => expect(reload().disabled).toBe(false))
    expect(title().value).toBe('Newer edit')
    await fireEvent.click(save())
    await waitFor(() => expect(updateHomeContent).toHaveBeenCalledWith({ title: 'Newer edit', summary: initial.summary, expectedUpdatedAt: initial.updatedAt }))
  })
  it.each([{ permissions: [] }, { permissions: ['admin:access'] }, { permissions: ['system:manage'] }])('requires both permissions before any read or write %#', async ({ permissions }) => {
    auth('admin-a', permissions)
    mountEditor(); await nextTick()
    expect(screen.queryByLabelText('homeContent.title')).toBeNull()
    expect(getHomeContent).not.toHaveBeenCalled()
    auth(); await ready()
  })
  it('waits for a confirmed identity before loading any management document', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'] })
    mountEditor(); await nextTick()
    expect(screen.queryByLabelText('homeContent.title')).toBeNull()
    expect(getHomeContent).not.toHaveBeenCalled()
    auth(); await ready()
  })
  it.each(['resolve', 'reject'] as const)('ignores previous identity load %s and finally during the new identity load', async (outcome) => {
    const old = createDeferred<HomeContentSettings>(), current = createDeferred<HomeContentSettings>()
    vi.mocked(getHomeContent).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mountEditor()
    auth('admin-b'); await nextTick()
    if (outcome === 'resolve') old.resolve({ ...saved, title: 'Private old identity' })
    else old.reject(new Error('old failure'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(title().value).toBe(''); expect(reload().disabled).toBe(true)
    expect(screen.queryByText('homeContent.loadFailed')).toBeNull()
    current.resolve(initial); await ready()
    expect(client.getQueriesData({ queryKey: adminHomeContentKey }).some(([, value]) => (value as HomeContentSettings)?.title === 'Private old identity')).toBe(false)
  })
  it.each(['resolve', 'reject', 'conflict'] as const)('ignores old save %s and finally after same-account logout/login with a new pending save', async (outcome) => {
    const old = createDeferred<HomeContentSettings>(), current = createDeferred<HomeContentSettings>()
    vi.mocked(updateHomeContent).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    client.setQueryData(publicHomeContentKey, { title: 'Public', summary: '' })
    mountEditor(); await ready(); await fireEvent.click(save())
    auth('', []); auth(); await ready()
    await fireEvent.update(title(), 'Current draft'); await fireEvent.click(save())
    if (outcome === 'resolve') old.resolve(saved)
    else old.reject(outcome === 'conflict' ? new ApiClientError(900205, 'old conflict') : new Error('old failure'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(save().disabled).toBe(true); expect(title().value).toBe('Current draft')
    expect(screen.queryByText('homeContent.saved')).toBeNull()
    expect(screen.queryByText('homeContent.saveFailed')).toBeNull()
    expect(screen.queryByText('homeContent.conflict')).toBeNull()
    expect(client.getQueryState(publicHomeContentKey)?.isInvalidated).toBe(false)
    current.resolve({ ...saved, title: 'Current saved' })
    await waitFor(() => expect(title().value).toBe('Current saved'))
  })
  it.each(['load', 'save'] as const)('clears all private state on permission revocation and rejects an old %s after restoration', async (operation) => {
    const pending = createDeferred<HomeContentSettings>()
    if (operation === 'load') vi.mocked(getHomeContent).mockReturnValueOnce(pending.promise)
    else vi.mocked(updateHomeContent).mockReturnValueOnce(pending.promise)
    mountEditor()
    if (operation === 'save') { await ready(); await fireEvent.update(title(), 'Secret draft'); await fireEvent.click(save()) }
    auth('admin-a', ['admin:access']); await nextTick()
    expect(screen.queryByLabelText('homeContent.title')).toBeNull()
    auth(); await ready()
    pending.resolve({ ...saved, title: 'Stale secret' })
    await pending.promise; await nextTick()
    expect(title().value).toBe(initial.title)
    expect(screen.queryByText('homeContent.saved')).toBeNull()
  })
  it.each(['load', 'save'] as const)('does not apply a pending %s after unmount', async (operation) => {
    const pending = createDeferred<HomeContentSettings>()
    if (operation === 'load') vi.mocked(getHomeContent).mockReturnValueOnce(pending.promise)
    else vi.mocked(updateHomeContent).mockReturnValueOnce(pending.promise)
    client.setQueryData(publicHomeContentKey, { title: 'Public', summary: '' })
    const view = mountEditor()
    if (operation === 'save') { await ready(); await fireEvent.click(save()) }
    view.unmount(); pending.resolve(saved)
    await pending.promise; await nextTick()
    expect(client.getQueryState(publicHomeContentKey)?.isInvalidated).toBe(false)
    expect(client.getQueriesData({ queryKey: adminHomeContentKey })).toEqual([])
  })
})
