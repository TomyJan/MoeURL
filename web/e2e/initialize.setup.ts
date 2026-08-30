import { expect, test } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, e2eHost } from './support'

const invalidSetupTokenCode = 900102

test.use({ trace: 'off' })

interface InitStatusPayload {
  code: number
  data: {
    initialized: boolean
    setupTokenRequired: boolean
  }
  message: string
  meta: Record<string, unknown>
}

test('initialization', async ({ page }) => {
  page.setDefaultTimeout(30_000)
  const status = await page.request.get('/api/v1/init/status')
  await expect(status).toBeOK()
  const statusPayload = await status.json() as InitStatusPayload
  expect(statusPayload).toEqual({
    code: 0,
    data: {
      initialized: expect.any(Boolean),
      setupTokenRequired: expect.any(Boolean),
    },
    message: expect.any(String),
    meta: expect.any(Object),
  })

  if (statusPayload.data.initialized) {
    const login = await page.request.post('/api/v1/auth/login', {
      data: { username: e2eAdminUsername, password: e2eAdminPassword },
    })
    await expect(login).toBeOK()
    const loginPayload = await login.json() as { code: number }
    expect(loginPayload.code).toBe(0)
    return
  }

  const setupToken = statusPayload.data.setupTokenRequired
    ? requiredSetupToken()
    : undefined
  if (setupToken) {
    expectTokenAbsentFromResponse(statusPayload, setupToken)
  }

  const setupRequest = {
    adminUsername: e2eAdminUsername,
    adminPassword: e2eAdminPassword,
    adminNickname: 'Admin',
    siteName: 'MoeURL',
    systemDomain: e2eHost,
    shortLinkDomain: e2eHost,
    defaultLanguage: 'zh-CN',
    defaultTheme: 'system',
  }

  if (setupToken) {
    const missingTokenResponse = await page.request.post('/api/v1/init/setup', {
      data: setupRequest,
    })
    await expect(missingTokenResponse).toBeOK()
    const missingTokenPayload = await missingTokenResponse.json() as { code: number }
    expect(missingTokenPayload.code).toBe(invalidSetupTokenCode)
    expectTokenAbsentFromResponse(missingTokenPayload, setupToken)

    const clearlyWrongToken = setupToken === 'clearly-invalid-setup-token'
      ? 'another-clearly-invalid-setup-token'
      : 'clearly-invalid-setup-token'
    const wrongTokenResponse = await page.request.post('/api/v1/init/setup', {
      data: { ...setupRequest, setupToken: clearlyWrongToken },
    })
    await expect(wrongTokenResponse).toBeOK()
    const wrongTokenPayload = await wrongTokenResponse.json() as { code: number }
    expect(wrongTokenPayload.code).toBe(invalidSetupTokenCode)
    expectTokenAbsentFromResponse(wrongTokenPayload, setupToken)
    expectTokenAbsentFromResponse(wrongTokenPayload, clearlyWrongToken)
  }

  await page.goto('/setup')
  const setupWizard = page.getByTestId('setup-wizard')
  await expect(setupWizard).toBeVisible()
  await page.getByTestId('setup-admin-username').locator('input').fill(e2eAdminUsername)
  await page.getByTestId('setup-admin-password').locator('input').fill(e2eAdminPassword)
  await page.getByTestId('setup-admin-nickname').locator('input').fill('Admin')
  await page.getByTestId('setup-site-name').locator('input').fill('MoeURL')
  await page.getByTestId('setup-system-domain').locator('input').fill(e2eHost)
  await page.getByTestId('setup-short-link-domain').locator('input').fill(e2eHost)
  if (setupToken) {
    await page.getByTestId('setup-token').locator('input').evaluate((element, value) => {
      const input = element as HTMLInputElement
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!valueSetter) {
        throw new Error('Unable to set the setup-token input value')
      }
      valueSetter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, setupToken)
  } else {
    await expect(page.getByTestId('setup-token')).toHaveCount(0)
  }

  const setupResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/init/setup') && response.request().method() === 'POST',
  )
  await page.getByTestId('setup-submit').click()
  const setupResponse = await setupResponsePromise
  expect(setupResponse.ok()).toBe(true)
  const setupPayload = await setupResponse.json() as { code: number; data: { initialized: boolean } }
  expect(setupPayload).toMatchObject({ code: 0, data: { initialized: true } })
  if (setupToken) {
    expectTokenAbsentFromResponse(setupPayload, setupToken)
  }
  await expect(page.getByTestId('setup-completion')).toBeVisible()
})

/** Returns the production setup credential without including its value in assertion output. */
function requiredSetupToken(): string {
  const setupToken = process.env.MOEURL_E2E_SETUP_TOKEN?.trim()
  expect(
    Boolean(setupToken),
    'MOEURL_E2E_SETUP_TOKEN is required when init status reports setupTokenRequired=true',
  ).toBe(true)
  return setupToken as string
}

/** Checks response serialization without exposing the credential in assertion output. */
function expectTokenAbsentFromResponse(payload: unknown, setupToken: string) {
  expect(
    JSON.stringify(payload).includes(setupToken),
    'API response serialization must not include the setup token',
  ).toBe(false)
}
