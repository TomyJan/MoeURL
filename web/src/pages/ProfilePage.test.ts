import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import ProfilePage from './ProfilePage.vue'
import { componentStubs } from '@/test/component-stubs'
import { updateProfile } from '@/entities/user/api'
import { ApiClientError } from '@/shared/api/client'

const state = vi.hoisted(() => ({
  queryResult: {
    data: {
      value: {
        user: {
          id: 'user-id',
          username: 'alice',
          nickname: 'Alice',
          group: 'user',
          permissions: ['short_link:read_own'],
        },
      } as
        | {
            user: {
              id: string
              username: string
              nickname: string
              group: string
              permissions: string[]
            }
          }
        | undefined,
    },
    isError: {
      value: false,
    },
    isPending: {
      value: false,
    },
  },
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string, params?: Record<string, unknown>) => {
      if (typeof params?.message === 'string') {
        return `${key}:${params.message}`
      }
      return key
    },
  }),
}))

vi.mock('vuetify', () => ({
  useTheme: () => ({
    global: {
      current: ref({ colors: { primary: '#315f8c' } }),
      name: ref('moeurlLight'),
    },
  }),
}))

vi.mock('@tanstack/vue-query', () => ({
  useQuery: vi.fn(() => state.queryResult),
  useMutation: vi.fn((options?: {
    mutationFn?: (input: { nickname: string }) => Promise<{ user: { id: string; username: string; nickname: string; group: string; permissions: string[] } }>
    onError?: (error: unknown) => void
    onSuccess?: (value: unknown) => void
  }) => {
    const isPending = ref(false)
    const error = ref<unknown>(undefined)
    const variables = ref<unknown>(undefined)
    return {
      error,
      isPending,
      variables,
      mutate: vi.fn(async (input: { nickname: string }) => {
        variables.value = input
        isPending.value = true
        try {
          const result = await options?.mutationFn?.(input)
          options?.onSuccess?.(result)
          return result
        } catch (mutationError) {
          error.value = mutationError
          options?.onError?.(mutationError)
          throw mutationError
        } finally {
          isPending.value = false
        }
      }),
    }
  }),
  useQueryClient: () => state.queryClient,
}))

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(),
}))

vi.mock('@/entities/user/api', () => ({
  updateProfile: vi.fn(async (input: { nickname: string }) => ({
    user: {
      id: 'user-id',
      username: 'alice',
      nickname: input.nickname,
      group: 'user',
      permissions: ['short_link:read_own'],
    },
  })),
}))

function mountProfilePage() {
  return render(ProfilePage, {
    global: {
      stubs: componentStubs,
    },
  })
}

describe('ProfilePage', () => {
  beforeEach(() => {
    state.queryResult.data.value = {
      user: {
        id: 'user-id',
        username: 'alice',
        nickname: 'Alice',
        group: 'user',
        permissions: ['short_link:read_own'],
      },
    }
    state.queryResult.isError.value = false
    state.queryResult.isPending.value = false
    state.queryClient.invalidateQueries.mockReset()
    state.queryClient.setQueryData.mockReset()
    vi.mocked(updateProfile).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the current account, preferences, and quick links', () => {
    mountProfilePage()

    expect(screen.getByTestId('profile-page')).toBeTruthy()
    expect(screen.getByText('page.profile')).toBeTruthy()
    expect(screen.getByText('profile.accountTitle')).toBeTruthy()
    expect(screen.getByText('profile.preferencesTitle')).toBeTruthy()
    expect(screen.getByText('profile.quickLinksTitle')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'preferences.groupLabel' })).toBeTruthy()
    expect(screen.getByDisplayValue('Alice')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('user')).toBeTruthy()
    expect(screen.getByText('profile.backToConsole').closest('button')?.getAttribute('data-to')).toBe('/console')
    expect(screen.getByText('page.overview').closest('button')?.getAttribute('data-to')).toBe('/console')
    expect(screen.getByText('page.links').closest('button')?.getAttribute('data-to')).toBe('/link')
    expect(screen.getByText('page.analytics').closest('button')?.getAttribute('data-to')).toBe('/analytics')
  })

  it('falls back to the username when nickname is blank', () => {
    state.queryResult.data.value = {
      user: {
        id: 'user-id',
        username: 'alice',
        nickname: '',
        group: 'user',
        permissions: ['short_link:read_own'],
      },
    }

    mountProfilePage()

    expect(screen.getAllByText('alice')).toHaveLength(2)
    expect(screen.getByText('A')).toBeTruthy()
  })

  it('falls back to guest when the account name fields are empty', () => {
    state.queryResult.data.value = {
      user: {
        id: 'user-id',
        username: '',
        nickname: '',
        group: 'user',
        permissions: ['short_link:read_own'],
      },
    }

    mountProfilePage()

    expect(screen.getByText('guest')).toBeTruthy()
    expect(screen.getByText('G')).toBeTruthy()
  })

  it('shows a loading state while the current user query is pending', () => {
    state.queryResult.data.value = undefined
    state.queryResult.isPending.value = true

    mountProfilePage()

    expect(screen.getByTestId('profile-page-loading')).toBeTruthy()
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0)
  })

  it('rejects blank nicknames before sending an update', async () => {
    mountProfilePage()

    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), '   ')
    await fireEvent.click(screen.getByRole('button', { name: 'profile.saveNickname' }))

    expect(vi.mocked(updateProfile)).not.toHaveBeenCalled()
    expect(screen.getByText('profile.nicknameRequired')).toBeTruthy()
  })

  it('submits a trimmed nickname and refreshes the auth cache', async () => {
    mountProfilePage()

    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), '  Alice Renamed  ')
    await fireEvent.click(screen.getByRole('button', { name: 'profile.saveNickname' }))

    expect(vi.mocked(updateProfile)).toHaveBeenCalledWith({ nickname: 'Alice Renamed' })
    expect(state.queryClient.setQueryData).toHaveBeenCalledWith(
      ['auth', 'me'],
      expect.objectContaining({
        user: expect.objectContaining({
          nickname: 'Alice Renamed',
        }),
      }),
    )
    expect(state.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
    expect(screen.getByText('profile.saveSuccess')).toBeTruthy()
    expect(screen.getByDisplayValue('Alice Renamed')).toBeTruthy()
  })

  it('shows a save failure when the profile update request rejects', async () => {
    vi.mocked(updateProfile).mockRejectedValueOnce(new Error('network down'))
    mountProfilePage()

    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), 'Alice Renamed')
    await fireEvent.click(screen.getByRole('button', { name: 'profile.saveNickname' }))

    await waitFor(() => {
      expect(screen.getByText('profile.saveFailed')).toBeTruthy()
    })
    expect(state.queryClient.setQueryData).not.toHaveBeenCalled()
  })

  it('shows a retryable backend reason when the save request fails with invalid input', async () => {
    vi.mocked(updateProfile).mockRejectedValueOnce(new ApiClientError(100001, 'Invalid request'))
    mountProfilePage()

    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), 'Alice Renamed')
    await fireEvent.click(screen.getByRole('button', { name: 'profile.saveNickname' }))

    await waitFor(() => {
      expect(screen.getByText('profile.saveFailedWithReason:Invalid request')).toBeTruthy()
    })
  })

  it('falls back to the generic save failure when the backend error has no message', async () => {
    vi.mocked(updateProfile).mockRejectedValueOnce(new ApiClientError(100001, ''))
    mountProfilePage()

    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), 'Alice Renamed')
    await fireEvent.click(screen.getByRole('button', { name: 'profile.saveNickname' }))

    await waitFor(() => {
      expect(screen.getByText('profile.saveFailed')).toBeTruthy()
    })
  })

  it('shows a non-retryable message when the backend rejects an immutable account', async () => {
    vi.mocked(updateProfile).mockRejectedValueOnce(new ApiClientError(300102, 'Builtin user cannot be modified'))
    mountProfilePage()

    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), 'Alice Renamed')
    await fireEvent.click(screen.getByRole('button', { name: 'profile.saveNickname' }))

    await waitFor(() => {
      expect(screen.getByText('profile.saveUnavailable')).toBeTruthy()
    })
  })
})
