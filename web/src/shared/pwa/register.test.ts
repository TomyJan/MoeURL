import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from './register'

describe('service worker registration', () => {
  let loadHandler: (() => void) | undefined
  let originalNavigator: Navigator
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    loadHandler = undefined
    originalNavigator = window.navigator
    originalConsoleError = console.error

    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          register: vi.fn().mockRejectedValue(new Error('registration failed')),
        },
      },
    })
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'load') {
        loadHandler = handler as () => void
      }
    })
    console.error = vi.fn()
  })

  afterEach(() => {
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: originalNavigator,
    })
    console.error = originalConsoleError
    vi.restoreAllMocks()
  })

  it('logs registration errors', async () => {
    registerServiceWorker()

    loadHandler?.()
    await Promise.resolve()

    expect(console.error).toHaveBeenCalledWith(
      'Service worker registration failed',
      expect.any(Error),
    )
  })

  it('does nothing when service workers are unavailable', () => {
    Object.defineProperty(window, 'navigator', {
      configurable: true,
      value: {},
    })

    registerServiceWorker()

    expect(window.addEventListener).not.toHaveBeenCalled()
  })
})
