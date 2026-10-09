import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import { updateAdminSettings } from '@/entities/system/api'
import AdminSettingsPage from './AdminSettingsPage.vue'

const settings = {
  siteName: 'MoeURL', defaultLanguage: 'zh-CN' as const, defaultTheme: 'system' as const,
  footerText: '', showPoweredBy: true, localLoginEnabled: true, updatedAt: '2026-10-09T00:00:00Z',
}
const state = vi.hoisted(() => ({
  data: undefined as unknown as ReturnType<typeof ref<unknown>>,
  error: undefined as unknown as ReturnType<typeof ref<boolean>>,
  pending: undefined as unknown as ReturnType<typeof ref<boolean>>,
  refetch: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn(), mutate: vi.fn(),
  mutationPending: undefined as unknown as ReturnType<typeof ref<boolean>>,
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/entities/system/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/system/api')>()
  return { ...actual, getAdminSettings: vi.fn(), updateAdminSettings: vi.fn() }
})
vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => ({ setQueryData: state.setQueryData, invalidateQueries: state.invalidateQueries }),
  useQuery: () => ({ data: state.data, isError: state.error, isPending: state.pending, refetch: state.refetch }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: (result: unknown) => void; onError: (error: unknown) => Promise<void> }) => ({
    isPending: state.mutationPending,
    mutate: (input: unknown) => {
      state.mutate(input)
      void options.mutationFn(input).then(options.onSuccess).catch(options.onError)
    },
  }),
}))

function mountPage() {
  return render(AdminSettingsPage, { global: { stubs: { ...componentStubs, AdminAuthenticationPage: { template: '<div data-testid="authentication-settings" />' } } } })
}

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    state.data = ref<unknown>()
    state.error = ref(false)
    state.pending = ref(false)
    state.mutationPending = ref(false)
    state.data.value = { ...settings }
    state.error.value = false
    state.pending.value = false
    state.refetch.mockReset()
    state.setQueryData.mockReset()
    state.invalidateQueries.mockReset()
    state.mutate.mockReset()
    vi.mocked(updateAdminSettings).mockReset()
  })

  it('renders general settings and the authentication section', () => {
    mountPage()
    expect(screen.getByTestId('admin-settings-page')).toBeTruthy()
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('MoeURL')
    expect(screen.getByTestId('authentication-settings')).toBeTruthy()
  })

  it('submits a trimmed optimistic update and refreshes public configuration', async () => {
    vi.mocked(updateAdminSettings).mockResolvedValue({
      ...settings,
      siteName: 'New site',
      defaultLanguage: 'en',
      defaultTheme: 'dark',
      footerText: 'Footer',
      showPoweredBy: false,
      localLoginEnabled: false,
      updatedAt: '2026-10-09T01:00:00Z',
    })
    mountPage()
    await fireEvent.update(screen.getByLabelText('settings.siteName'), '  New site  ')
    await fireEvent.update(screen.getByLabelText('settings.footerText'), '  Footer  ')
    await fireEvent.click(screen.getByLabelText('settings.showPoweredBy'))
    await fireEvent.update(screen.getByLabelText('settings.defaultLanguage'), 'en')
    await fireEvent.update(screen.getByLabelText('settings.defaultTheme'), 'dark')
    await fireEvent.click(screen.getByLabelText('settings.localLoginEnabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))

    await waitFor(() => expect(updateAdminSettings).toHaveBeenCalledWith({
      siteName: 'New site',
      defaultLanguage: 'en',
      defaultTheme: 'dark',
      footerText: 'Footer',
      showPoweredBy: false,
      localLoginEnabled: false,
      expectedUpdatedAt: settings.updatedAt,
    }))
    expect(state.setQueryData).toHaveBeenCalledWith(['system', 'public-config'], expect.objectContaining({ siteName: 'New site' }))
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'methods'] })
    expect(screen.getByText('settings.saveSuccess')).toBeTruthy()
  })

  it('renders loading and retryable query failures', async () => {
    state.data.value = undefined
    state.pending.value = true
    const loading = mountPage()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    loading.unmount()

    state.pending.value = false
    state.error.value = true
    state.refetch.mockResolvedValue({ isSuccess: false })
    mountPage()
    expect(screen.getByText('settings.loadFailed')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'settings.retry' }))
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps cached settings and dirty input visible after a failed refetch', async () => {
    mountPage()
    await fireEvent.update(screen.getByLabelText('settings.siteName'), 'Local draft')
    state.error.value = true
    await nextTick()

    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Local draft')
    expect(screen.getByText('settings.loadFailed')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'settings.retry' }))
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })

  it('preserves dirty drafts across background refreshes and accepts clean refreshes', async () => {
    mountPage()
    await fireEvent.update(screen.getByLabelText('settings.siteName'), 'Local draft')
    state.data.value = { ...settings, siteName: 'Background update', updatedAt: '2026-10-09T01:00:00Z' }
    await nextTick()
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Local draft')

    await fireEvent.update(screen.getByLabelText('settings.siteName'), 'MoeURL')
    state.data.value = { ...settings, siteName: 'Accepted update', updatedAt: '2026-10-09T02:00:00Z' }
    await nextTick()
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Accepted update')
  })

  it.each([
    ['blank site name', '', '', settings.updatedAt],
    ['long site name', 'x'.repeat(65), '', settings.updatedAt],
    ['long footer', 'MoeURL', 'x'.repeat(201), settings.updatedAt],
    ['missing revision', 'MoeURL', '', ''],
  ])('rejects %s before mutation', async (_name, siteName, footerText, updatedAt) => {
    state.data.value = { ...settings, updatedAt }
    mountPage()
    await fireEvent.update(screen.getByLabelText('settings.siteName'), siteName)
    await fireEvent.update(screen.getByLabelText('settings.footerText'), footerText)
    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))
    expect(updateAdminSettings).not.toHaveBeenCalled()
    expect(screen.getByText('settings.saveFailed')).toBeTruthy()
  })

  it.each([
    ['provider protection', new ApiClientError(900203, 'provider'), 'settings.noLoginProvider'],
    ['invalid request', new ApiClientError(900201, 'invalid'), 'settings.saveFailed'],
    ['infrastructure error', new Error('offline'), 'settings.saveFailed'],
  ])('maps %s failures', async (_name, error, message) => {
    vi.mocked(updateAdminSettings).mockRejectedValue(error)
    mountPage()
    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
  })

  it('preserves a dirty draft until the user explicitly loads the conflicting server version', async () => {
    vi.mocked(updateAdminSettings).mockRejectedValue(new ApiClientError(900202, 'conflict'))
    state.refetch.mockImplementation(async () => {
      state.data.value = { ...settings, siteName: 'Server site', updatedAt: '2026-10-09T02:00:00Z' }
      return { isSuccess: true, data: state.data.value }
    })
    mountPage()
    await fireEvent.update(screen.getByLabelText('settings.siteName'), 'Local draft')
    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))
    await waitFor(() => expect(screen.getByText('settings.conflict')).toBeTruthy())
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Local draft')

    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))
    await waitFor(() => expect(updateAdminSettings).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: settings.updatedAt })))

    await fireEvent.click(screen.getByRole('button', { name: 'settings.reload' }))
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Server site')
  })

  it('retries conflict refreshes without discarding the draft', async () => {
    const latest = { ...settings, siteName: 'Latest site', updatedAt: '2026-10-09T03:00:00Z' }
    vi.mocked(updateAdminSettings).mockRejectedValue(new ApiClientError(900202, 'conflict'))
    state.refetch
      .mockResolvedValueOnce({ isSuccess: false })
      .mockResolvedValueOnce({ isSuccess: false })
      .mockResolvedValueOnce({ isSuccess: true, data: latest })
    mountPage()
    await fireEvent.update(screen.getByLabelText('settings.siteName'), 'Local draft')
    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))
    await waitFor(() => expect(screen.getByText('settings.conflict')).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: 'settings.reload' }))
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Local draft')
    await fireEvent.click(screen.getByRole('button', { name: 'settings.reload' }))
    expect((screen.getByLabelText('settings.siteName') as HTMLInputElement).value).toBe('Latest site')
  })
})
