import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import ConsoleShell from './ConsoleShell.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  logoutMutate: vi.fn(),
  routerPush: vi.fn(),
  queryResult: {},
  routePath: undefined as unknown as { value: string },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify', () => ({
  useTheme: () => ({
    global: {
      name: ref('moeurlLight'),
    },
  }),
}))

vi.mock('vue-router', async () => {
  const { componentStubs } = await import('@/test/component-stubs')
  const { ref } = await import('vue')
  state.routePath = ref('/link')
  return {
    RouterLink: componentStubs.RouterLink,
    RouterView: { template: '<div data-testid="router-view" />' },
    useRoute: () => ({
      get fullPath() {
        return state.routePath.value
      },
      get path() {
        return state.routePath.value
      },
    }),
    useRouter: () => ({
      push: state.routerPush,
    }),
  }
})

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
    isError: ref(false),
    isPending: ref(false),
  }
}

describe('ConsoleShell', () => {
  beforeEach(() => {
    document.body.style.overflow = ''
    state.invalidateQueries.mockReset()
    state.logoutMutate.mockReset()
    state.routerPush.mockReset()
    state.routePath.value = '/link'
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
    const sidebarUtilities = screen.getByTestId('console-sidebar-utilities')
    expect(within(sidebarUtilities).getByTestId('console-sidebar-home')).toBeTruthy()
    expect(within(sidebarUtilities).getByRole('group', { name: 'preferences.groupLabel' })).toBeTruthy()
    expect(screen.queryByText('short links')).toBeNull()
    expect(screen.getByText('console.nav.workspace')).toBeTruthy()
    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.queryByText('nav.admin')).toBeNull()
    expect(screen.queryByText('nav.users')).toBeNull()
    expect(screen.queryByText('page.createUser')).toBeNull()
    expect(within(screen.getByTestId('console-account')).getByText('Alice')).toBeTruthy()
    expect(screen.getAllByRole('group', { name: 'preferences.groupLabel' }).length).toBeGreaterThan(0)
  })

  it('shows administrator navigation as grouped two-level sections without create-user nav', async () => {
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.getByText('nav.overview')).toBeTruthy()
    expect(screen.getAllByText('nav.admin').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'console.nav.userManagement' }).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('console-nav-primary-item').length).toBeGreaterThan(4)
    expect(screen.getAllByTestId('console-nav-parent-item').length).toBeGreaterThan(0)
    expect(screen.queryByText('nav.users')).toBeNull()
    expect(screen.getAllByTestId('console-nav-planned-badge').length).toBe(3)
    await fireEvent.click(screen.getAllByRole('button', { name: 'console.nav.userManagement' })[0])
    expect(screen.getByText('nav.users')).toBeTruthy()
    expect(screen.getByText('nav.userGroups')).toBeTruthy()
    expect(screen.getAllByTestId('console-nav-child-item').length).toBeGreaterThan(1)
    expect(screen.getAllByTestId('console-nav-planned-badge').length).toBe(4)
    expect(screen.queryByText('page.createUser')).toBeNull()
    expect(screen.getByText('nav.analytics')).toBeTruthy()
    expect(screen.getByText('nav.settings')).toBeTruthy()
  })

  it('expands the matching two-level navigation group for child routes', () => {
    state.routePath.value = '/admin/user/group'
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    expect(screen.getByText('nav.userGroups')).toBeTruthy()
  })

  it('opens short link creation dialog from the console action', async () => {
    mountShell()

    await fireEvent.click(screen.getAllByText('console.newShortLink')[0])

    expect(screen.getByTestId('console-create-transition')).toBeTruthy()
    expect(screen.getByText('console.createShortLink')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.submit')).toBeTruthy()
  })

  it('closes overlays from backdrop click and Escape while locking background scroll', async () => {
    mountShell()

    await fireEvent.click(screen.getAllByText('console.newShortLink')[0])
    expect(screen.getByTestId('console-create-transition')).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')

    await fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByTestId('console-create-transition')).toBeNull()
    expect(document.body.style.overflow).toBe('')

    await fireEvent.click(screen.getByLabelText('console.openMenu'))
    expect(screen.getByTestId('console-mobile-nav')).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')

    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('opens mobile navigation from the hamburger button', async () => {
    mountShell()

    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()
    expect(within(screen.getByLabelText('console.openMenu')).getByTestId('console-icon-menu')).toBeTruthy()

    await fireEvent.click(screen.getByLabelText('console.openMenu'))

    expect(screen.getByTestId('console-mobile-nav')).toBeTruthy()
    expect(screen.getByTestId('console-drawer-transition')).toBeTruthy()
    const mobileUtilities = within(screen.getByTestId('console-mobile-nav')).getByTestId('console-mobile-utilities')
    expect(within(mobileUtilities).getByTestId('console-mobile-home')).toBeTruthy()
    expect(within(mobileUtilities).getByRole('group', { name: 'preferences.groupLabel' })).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-nav')).getByText('nav.links')).toBeTruthy()
  })

  it('opens the mobile account menu and logs out from the topbar avatar', async () => {
    mountShell()

    await fireEvent.click(screen.getByLabelText('console.openAccountMenu'))

    expect(screen.getByTestId('console-mobile-account-menu')).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-account-menu')).getByText('Alice')).toBeTruthy()

    await fireEvent.click(within(screen.getByTestId('console-mobile-account-menu')).getByText('nav.logout'))

    expect(state.logoutMutate).toHaveBeenCalled()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
    expect(state.routerPush).toHaveBeenCalledWith('/login')
  })

  it('closes the mobile account menu on outside click and Escape', async () => {
    mountShell()

    await fireEvent.click(screen.getByLabelText('console.openAccountMenu'))
    expect(screen.getByTestId('console-mobile-account-menu')).toBeTruthy()

    await fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('console-mobile-account-menu')).toBeNull()

    await fireEvent.click(screen.getByLabelText('console.openAccountMenu'))
    expect(screen.getByTestId('console-mobile-account-menu')).toBeTruthy()

    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('console-mobile-account-menu')).toBeNull()
  })

  it('closes mobile navigation after choosing a route item', async () => {
    mountShell()

    await fireEvent.click(screen.getByLabelText('console.openMenu'))
    await fireEvent.click(within(screen.getByTestId('console-mobile-nav')).getByText('nav.links'))

    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()
  })

  it('logs out from the sidebar account area', async () => {
    mountShell()

    await fireEvent.click(within(screen.getByTestId('console-account')).getByText('nav.logout'))

    expect(state.logoutMutate).toHaveBeenCalled()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
    expect(state.routerPush).toHaveBeenCalledWith('/login')
  })

  it('redirects to login when the current user query fails in the shell', () => {
    state.routePath.value = '/admin/user?tab=profile'
    state.queryResult = {
      data: ref(undefined),
      isError: ref(true),
      isPending: ref(false),
    }

    mountShell()

    expect(state.routerPush).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/admin/user?tab=profile' },
    })
  })

  it('redirects to login when the current user query resolves to guest', () => {
    state.routePath.value = '/link?status=active'
    setCurrentUser({
      username: 'guest',
      nickname: 'Guest',
      group: 'guest',
      permissions: [],
    })

    mountShell()

    expect(state.routerPush).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/link?status=active' },
    })
  })

  it('keeps parent expansion visually separate from active child navigation', () => {
    state.routePath.value = '/admin/user'
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    const parent = screen.getAllByRole('button', { name: 'console.nav.userManagement' })[0]
    const childPanelId = parent.getAttribute('aria-controls')
    expect(parent.getAttribute('aria-expanded')).toBe('true')
    expect(childPanelId).toBeTruthy()
    expect(document.getElementById(childPanelId ?? '')).toBeTruthy()
    expect(parent.classList.contains('console-nav-list__item--parent')).toBe(true)
    expect(within(parent).getByText('console.nav.userManagement')).toBeTruthy()
    expect(screen.getByText('nav.users')).toBeTruthy()
    expect(screen.getByText('nav.userGroups')).toBeTruthy()
    expect(screen.getAllByTestId('console-nav-planned-badge').length).toBeGreaterThan(0)
  })

  it('rebuilds expanded navigation groups from the current route instead of accumulating old matches', async () => {
    state.routePath.value = '/admin/user'
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    const expandedParent = screen.getAllByRole('button', { name: 'console.nav.userManagement' })[0]
    expect(expandedParent.getAttribute('aria-expanded')).toBe('true')

    state.routePath.value = '/admin/link'
    await nextTick()

    const collapsedParent = screen.getAllByRole('button', { name: 'console.nav.userManagement' })[0]
    expect(collapsedParent.getAttribute('aria-expanded')).toBe('false')
  })
})
