import { writeFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

/** Rejects warnings or decisions clipped outside the first screen, including scroll containers. */
export async function captureAppendDiscard(page: Page, info: TestInfo, name: string, requestId: string) {
  const dialog = page.getByTestId('batch-note-append-dialog')
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByTestId('batch-note-append-keep')).toBeFocused()
  await expect(dialog.locator('.batch-append-body > p')).toContainText(requestId)
  const geometry = () => dialog.evaluate(element => {
    const body = element.querySelector('.batch-append-body')!, clip = body.getBoundingClientRect()
    const targets = [body.querySelector('[data-testid="batch-note-append-discard-warning"]')!, body.querySelector('p')!,
      element.querySelector('[data-testid="batch-note-append-keep"]')!, element.querySelector('[data-testid="batch-note-append-discard"]')!]
    return { width: innerWidth, height: innerHeight, scrollTop: body.scrollTop, boxes: targets.map((target, index) => {
      const r = target.getBoundingClientRect(), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      const bounds = index < 2 ? { left: Math.max(0, clip.left), right: Math.min(innerWidth, clip.right), top: Math.max(0, clip.top), bottom: Math.min(innerHeight, clip.bottom) }
        : { left: 0, right: innerWidth, top: 0, bottom: innerHeight }
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, bounds, hit: hit !== null && target.contains(hit) }
    }) }
  })
  // Transition completion is observed through actual hit testing, without changing scroll position.
  await expect.poll(async () => (await geometry()).boxes.every(box => box.hit)).toBe(true)
  const value = await geometry()
  expect(value.scrollTop).toBe(0)
  for (const box of value.boxes) {
    expect(box.right - box.left).toBeGreaterThan(0); expect(box.bottom - box.top).toBeGreaterThan(0)
    expect(box.left).toBeGreaterThanOrEqual(box.bounds.left - 1); expect(box.right).toBeLessThanOrEqual(box.bounds.right + 1)
    expect(box.top).toBeGreaterThanOrEqual(box.bounds.top - 1); expect(box.bottom).toBeLessThanOrEqual(box.bounds.bottom + 1)
  }
  const proof = info.outputPath(name + '-geometry.json'); await writeFile(proof, JSON.stringify(value, null, 2))
  await info.attach(name + '-geometry', { path: proof, contentType: 'application/json' })
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
