import { expect, test } from '@playwright/test'

type ApiResponse<T> = {
  code: number
  data: T
  message: string
  meta: Record<string, unknown>
}

test('v0.0.1 initialization login short link and disabled redirect flow', async ({ page }) => {
  const status = await page.request.get('/api/v1/init/status')
  await expect(status).toBeOK()
  expect(await status.json()).toMatchObject({
    code: 0,
    data: { initialized: false },
  })

  await page.goto('/setup')
  await page.getByLabel('Admin username').fill('admin')
  await page.getByLabel('Admin password').fill('admin-password')
  await page.getByLabel('Admin nickname').fill('Admin')
  await page.getByLabel('Site name').fill('MoeURL')
  await page.getByLabel('System domain').fill('127.0.0.1:8080')
  await page.getByLabel('Short link domain').fill('127.0.0.1:8080')
  await page.getByRole('button', { name: '初始化' }).click()
  await expect(page.getByText('Initialized')).toBeVisible()

  await page.goto('/login')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByText('Invalid username or password')).toBeVisible()
  await page.getByLabel('Password').fill('')
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Password').fill('admin-password')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page.getByText('Admin')).toBeVisible()

  await page.goto('/')
  await page.getByLabel('https://example.com').fill('https://example.com/e2e-target')
  await page.getByRole('button', { name: '创建短链' }).click()
  const createdLink = page.getByRole('link', { name: /127\.0\.0\.1:8080\/[a-z0-9]{6}/ })
  await expect(createdLink).toBeVisible()
  const createdUrl = await createdLink.getAttribute('href')
  expect(createdUrl).toMatch(/^https?:\/\/127\.0\.0\.1:8080\/[a-z0-9]{6}$/)
  await expect(page.getByRole('button', { name: '复制短链' })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开短链' })).toHaveAttribute('href', createdUrl ?? '')
  await expect(page.getByRole('button', { name: '继续创建' })).toBeVisible()

  const slug = new URL(createdUrl ?? '').pathname.slice(1)

  const redirect = await page.goto(`/${slug}`, { waitUntil: 'commit' })
  expect(redirect?.status()).toBe(404)
  expect(page.url()).toBe('https://example.com/e2e-target')

  const list = await page.request.get('/api/v1/short-link/list?page=1&pageSize=20')
  await expect(list).toBeOK()
  const listBody = (await list.json()) as ApiResponse<{
    items: { id: string; slug: string; url: string }[]
  }>
  const created = listBody.data.items.find((item) => item.slug === slug)
  expect(created).toBeTruthy()

  const update = await page.request.post('/api/v1/short-link/update', {
    data: { id: created?.id, status: 'disabled' },
  })
  await expect(update).toBeOK()
  expect(await update.json()).toMatchObject({
    code: 0,
    data: { shortLink: { status: 'disabled' } },
  })

  await page.goto('/links')
  await expect(page.getByRole('link', { name: createdUrl ?? '' })).toBeVisible()
  await expect(page.getByRole('button', { name: '复制' })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开' })).toHaveAttribute('href', createdUrl ?? '')

  const blocked = await page.request.get(`/${slug}`)
  await expect(blocked).toBeOK()
  expect(await blocked.text()).toContain('Short link disabled')

  await page.goto('/')
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByText('guest')).toBeVisible()

  await expect(page.getByText('请登录后创建短链')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建短链' })).toBeDisabled()
})
