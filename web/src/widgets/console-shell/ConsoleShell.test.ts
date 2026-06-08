import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import ConsoleShell from './ConsoleShell.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  logoutMutate: vi.fn(),
  queryResult: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify/framework', () => ({
  useTheme: () => ({
    global: {
      name: ref('moeurlLight'),
    },
  }),
}))

vi.mock('@/entities/auth/api', () => ({
  logout: vi.fn(),
  me: vi.fn(),
}))

vi.mock('@/entities/short-link/api', () => ({
  createShortLink: vi.fn(),
}))

vi.mock('@tanstack/vue-query', () => ({
  useMutation: vi.fn((options?: { onSuccess?: () => void }) => ({
    data: ref(undefined),
    error: ref(undefined),
    isPending: ref(false),
    mutate: vi.fn(() => {
      state.logoutMutate()
      options?.onSuccess?.()
    }),
  })),
  useQuery: vi.fn(() => state.queryResult),
  useQueryClient: () => ({
    invalidateQueries: state.invalidateQueries,
  }),
}))

function mountShell() {
  return render(ConsoleShell, {
    slots: {
      default: '<section>console content</section>',
    },
    global: {
      stubs: componentStubs,
    },
  })
}

function setCurrentUser(user: {
  username: string
  nickname?: string
  group: string
  permissions: string[]
}) {
  state.queryResult = {
    data: ref({ user }),
  }
}

describe('ConsoleShell', () => {
  beforeEach(() => {
    state.invalidateQueries.mockReset()
    state.logoutMutate.mockReset()
    setCurrentUser({
      username: 'alice',
      nickname: 'Alice',
      group: 'user',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own'],
    })
  })

  it('renders desktop navigation and account inside the sidebar for regular users', () => {
    const { container } = mountShell()

    expect(container.querySelector('.console-shell__workspace')).toBeTruthy()
    expect(screen.getByText('console content')).toBeTruthy()
    expect(screen.getByTestId('console-sidebar-home')).toBeTruthy()
    expect(screen.getByText('console.nav.workspace')).toBeTruthy()
    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.queryByText('nav.admin')).toBeNull()
    expect(screen.queryByText('nav.users')).toBeNull()
    expect(screen.queryByText('page.createUser')).toBeNull()
    expect(within(screen.getByTestId('console-account')).getByText('Alice')).toBeTruthy()
    expect(screen.getAllByRole('group', { name: 'app preferences' }).length).toBeGreaterThan(0)
  })

  it('shows administrator navigation as grouped two-level sections without create-user nav', () => {
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.getAllByText('nav.admin').length).toBeGreaterThan(0)
    expect(screen.getByText('console.nav.userManagement')).toBeTruthy()
    expect(screen.getByText('nav.users')).toBeTruthy()
    expect(screen.queryByText('page.createUser')).toBeNull()
    expect(screen.queryByText('console.stats')).toBeNull()
    expect(screen.queryByText('console.settings')).toBeNull()
  })

  it('opens short link creation dialog from the console action', async () => {
    mountShell()

    await fireEvent.click(screen.getAllByText('console.newShortLink')[0])

    expect(screen.getByTestId('console-create-transition')).toBeTruthy()
    expect(screen.getByText('console.createShortLink')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.submit')).toBeTruthy()
  })

  it('opens mobile navigation from the hamburger button', async () => {
    mountShell()

    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()

    await fireEvent.click(screen.getByLabelText('console.openMenu'))

    expect(screen.getByTestId('console-mobile-nav')).toBeTruthy()
    expect(screen.getByTestId('console-drawer-transition')).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-nav')).getByRole('group', { name: 'app preferences' })).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-nav')).getByText('console.backHome')).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-nav')).getByText('nav.links')).toBeTruthy()
  })

  it('logs out from the sidebar account area', async () => {
    mountShell()

    await fireEvent.click(within(screen.getByTestId('console-account')).getByText('nav.logout'))

    expect(state.logoutMutate).toHaveBeenCalled()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
  })
})
