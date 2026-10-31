import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { dismissNotifications } from './notification-dismissal'

test.use({ actionTimeout: 250 })

test('notification cleanup accepts an already empty notification area', async ({ page }) => {
  await page.setContent('<main>No notifications</main>')
  await dismissNotifications(page)
  await expect(page.getByRole('main')).toHaveText('No notifications')
})

test('notification cleanup activates each live close button with the keyboard', async ({ page }) => {
  await page.setContent('<button aria-label="Dismiss notification">First</button><button aria-label="关闭提示">Second</button>')
  await page.evaluate(() => {
    document.body.dataset.dismissals = '0'
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') document.body.dataset.dismissals = String(Number(document.body.dataset.dismissals) + 1)
      })
      button.addEventListener('click', () => button.remove())
    })
  })
  await dismissNotifications(page)
  await expect(page.getByRole('button')).toHaveCount(0)
  expect(await page.locator('body').getAttribute('data-dismissals')).toBe('2')
})

test('notification cleanup accepts expiry after observing a live button', async ({ page }) => {
  await page.setContent('<button aria-label="Dismiss notification">Expiring</button>')
  const observedPage = expireAfterObservation(page)
  await dismissNotifications(observedPage)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('notification cleanup does not accept a notification that remains after keyboard activation', async ({ page }) => {
  await page.setContent('<button aria-label="Dismiss notification" disabled>Unavailable</button>')
  await expect(dismissNotifications(page)).rejects.toThrow()
  await expect(page.getByRole('button')).toHaveCount(1)
})

/** Places real DOM expiry exactly after a real count response, without sleeps or fake locator outcomes. */
function expireAfterObservation(page: Page): Page {
  let expired = false
  return new Proxy(page, {
    get(target, property) {
      if (property === 'getByRole') return (...args: Parameters<Page['getByRole']>) => {
        const locator = target.getByRole(...args)
        return new Proxy(locator, {
          get(realLocator, member) {
            if (member === 'count') return async () => {
              const count = await realLocator.count()
              if (!expired && count > 0) {
                expired = true
                await realLocator.first().evaluate((button) => button.remove())
              }
              return count
            }
            const value = Reflect.get(realLocator, member)
            return typeof value === 'function' ? value.bind(realLocator) : value
          },
        })
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
