import { errors, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** Dismisses moving notifications through keyboard activation and observable removal. */
export async function dismissNotifications(page: Page) {
  const buttons = page.getByRole('button', { name: /^(关闭提示|Dismiss notification)$/ })
  let count = await buttons.count()
  while (count > 0) {
    try {
      await buttons.first().press('Enter')
    } catch (error) {
      // Auto-expiry can remove the last button after count but before keyboard activation.
      if (!(error instanceof errors.TimeoutError) || await buttons.count() !== 0) throw error
    }
    await expect.poll(() => buttons.count()).toBeLessThan(count)
    count = await buttons.count()
  }
}
