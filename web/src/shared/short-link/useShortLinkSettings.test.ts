import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { ShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'
import { useShortLinkSettings } from './useShortLinkSettings'

const state = vi.hoisted(() => ({
  error: undefined as unknown,
  invalidateQueries: vi.fn(),
  isError: false,
  mutationOptions: undefined as { onSuccess?: (value?: unknown, variables?: UpdateShortLinkInput) => void } | undefined,
  mutate: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/vue-query', () => ({
  useMutation: (options: { onSuccess?: (value?: unknown, variables?: UpdateShortLinkInput) => void }) => {
    state.mutationOptions = options
    return {
      error: ref(state.error),
      isError: ref(state.isError),
      isPending: ref(false),
      mutate: state.mutate,
      reset: state.reset,
    }
  },
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}))

const link: ShortLink = {
  id: 'link-id',
  url: 'https://go.example.com/abc123',
  slug: 'abc123',
  targetUrl: 'https://example.com',
  status: 'active',
  redirectMode: 'direct',
  intermediateDelaySeconds: 5,
  expiresAt: null,
  expired: false,
  createdAt: '2026-08-01T00:00:00Z',
}

describe('useShortLinkSettings', () => {
  beforeEach(() => {
    state.error = undefined
    state.isError = false
    state.mutationOptions = undefined
    state.invalidateQueries.mockReset()
    state.mutate.mockReset()
    state.reset.mockReset()
  })

  it('manages settings and QR dialogs without closing on an open event', () => {
    const settings = useShortLinkSettings({
      mutationFn: vi.fn(),
      queryKey: ['short-link'],
    })

    settings.configure(link)
    expect(state.reset).toHaveBeenCalledTimes(1)
    expect(settings.settingsLink.value).toEqual(link)

    settings.closeSettings(true)
    expect(settings.settingsLink.value).toEqual(link)
    settings.closeSettings(false)
    expect(settings.settingsLink.value).toBeNull()

    settings.showQr(link)
    expect(settings.qrLink.value).toEqual(link)
    settings.closeQr()
    expect(settings.qrLink.value).toBeNull()
  })

  it('submits settings, invalidates the configured query, and exposes errors', () => {
    state.error = new Error('settings failed')
    state.isError = true
    const settings = useShortLinkSettings({
      mutationFn: vi.fn(),
      queryKey: ['admin-short-link'],
    })
    const input: UpdateShortLinkInput = { id: 'link-id', targetUrl: 'https://example.org' }

    settings.configure(link)
    settings.saveSettings(input)
    expect(state.mutate).toHaveBeenCalledWith(input)
    expect(settings.settingsErrorMessage.value).toBe('settings failed')

    state.mutationOptions?.onSuccess?.(undefined, input)
    expect(settings.settingsLink.value).toBeNull()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-short-link'] })
  })

  it('keeps a newer settings dialog open when an older save succeeds', () => {
    const settings = useShortLinkSettings({ mutationFn: vi.fn(), queryKey: ['short-link'] })
    const input: UpdateShortLinkInput = { id: 'link-id', targetUrl: 'https://example.org' }

    settings.configure(link)
    settings.saveSettings(input)
    settings.configure({ ...link, id: 'other-link', slug: 'def456' })

    state.mutationOptions?.onSuccess?.(undefined, input)

    expect(settings.settingsLink.value?.id).toBe('other-link')
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['short-link'] })
  })

  it('uses the translated fallback for non-Error mutation failures', () => {
    state.error = { code: 200103 }
    state.isError = true
    const settings = useShortLinkSettings({ mutationFn: vi.fn(), queryKey: ['short-link'] })

    expect(settings.settingsErrorMessage.value).toBe('links.settingsSaveFailed')
  })
})
