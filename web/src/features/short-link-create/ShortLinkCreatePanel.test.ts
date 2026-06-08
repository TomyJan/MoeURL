import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  queryResult: {},
  mutationResult: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(),
}))

vi.mock('@/entities/short-link/api', () => ({
  createShortLink: vi.fn(),
}))

vi.mock('@tanstack/vue-query', () => ({
  useMutation: vi.fn((options?: { onSuccess?: (value: unknown) => void }) => {
    const base = state.mutationResult as {
      data?: ReturnType<typeof ref>
      error?: ReturnType<typeof ref>
      isPending?: ReturnType<typeof ref>
      mutate?: (input: unknown) => void
    }
    const providedMutate = base.mutate
    return {
      data: base.data ?? ref(undefined),
      error: base.error ?? ref(undefined),
      isPending: base.isPending ?? ref(false),
      mutate: vi.fn((input: unknown) => {
        providedMutate?.(input)
        options?.onSuccess?.({
          shortLink: { url: 'https://go.example.com/abc123' },
        })
      }),
    }
  }),
  useQuery: vi.fn(() => state.queryResult),
  useQueryClient: () => ({
    invalidateQueries: state.invalidateQueries,
  }),
}))

function mountPanel(props: Record<string, unknown> = {}) {
  return render(ShortLinkCreatePanel, {
    props,
    global: {
      stubs: componentStubs,
    },
  })
}

function setQueryResult(permissions: string[]) {
  state.queryResult = {
    data: ref({
      user: {
        permissions,
      },
    }),
  }
}

function setMutationResult(value: Partial<{
  data: ReturnType<typeof ref>
  error: ReturnType<typeof ref>
  isPending: ReturnType<typeof ref>
  mutate: ReturnType<typeof vi.fn>
}> = {}) {
  state.mutationResult = {
    data: value.data ?? ref(undefined),
    error: value.error ?? ref(undefined),
    isPending: value.isPending ?? ref(false),
    ...(value.mutate ? { mutate: value.mutate } : {}),
  }
}

describe('ShortLinkCreatePanel', () => {
  beforeEach(() => {
    state.invalidateQueries.mockReset()
    setQueryResult([])
    setMutationResult()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
  })

  it('keeps the form visible while blocking users without create permission', async () => {
    const mutate = vi.fn()
    setMutationResult({ mutate })

    const { container } = mountPanel()

    expect(container.querySelector('.short-link-create-panel__shell')).toBeTruthy()
    expect(container.querySelector('.short-link-create-panel__field-row')).toBeTruthy()
    const targetInput = screen.getByLabelText('shortLinkCreate.targetLabel') as HTMLInputElement
    expect(targetInput.disabled).toBe(true)
    expect(targetInput.placeholder).toBe('shortLinkCreate.targetPlaceholder')
    expect(screen.queryByText(/^https$/i)).toBeNull()
    expect(screen.getByText('shortLinkCreate.permissionRequired')).toBeTruthy()

    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).not.toHaveBeenCalled()
  })

  it('creates a short link and exposes copy and reset actions', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ mutate })

    mountPanel({ mode: 'full' })

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['short-link'] })
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-short-link'] })
    expect(screen.getByTestId('short-link-create-result')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.successTitle')).toBeTruthy()
    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()

    await fireEvent.click(screen.getByText('shortLinkCreate.copy'))
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')

    await fireEvent.click(screen.getByText('shortLinkCreate.reset'))
    expect(screen.queryByText('https://go.example.com/abc123')).toBeNull()
  })

  it('shows API errors and fallback errors', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ error: ref(new Error('invalid target')) })

    const { unmount } = mountPanel()
    expect(screen.getByText('invalid target')).toBeTruthy()
    unmount()

    setMutationResult({ error: ref({}) })
    mountPanel()
    expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
  })
})
