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
      const text = []
      if (index < 2) {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode
          if (!node.textContent?.trim()) continue
          const visible = { ...bounds }
          for (let parent = node.parentElement; parent; parent = parent.parentElement) {
            // The root clips to the viewport, even when modal scroll locking offsets its box.
            if (parent === document.documentElement) continue
            const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
            const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX)
            const clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY)
            if (clipsX) {
              visible.left = Math.max(visible.left, rect.left + parent.clientLeft)
              visible.right = Math.min(visible.right, rect.left + parent.clientLeft + parent.clientWidth)
            }
            if (clipsY) {
              visible.top = Math.max(visible.top, rect.top + parent.clientTop)
              visible.bottom = Math.min(visible.bottom, rect.top + parent.clientTop + parent.clientHeight)
            }
          }
          const range = document.createRange(); range.selectNodeContents(node)
          text.push({ bounds: visible, rects: Array.from(range.getClientRects(), rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })) })
        }
      }
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, bounds, text, hit: hit !== null && target.contains(hit), hitTag: hit?.tagName, hitTestId: hit?.getAttribute('data-testid') }
    }) }
  })
  // Transition completion is observed through actual hit testing, without changing scroll position.
  try { await expect.poll(async () => (await geometry()).boxes.every(box => box.hit)).toBe(true) } finally {
    const proof = info.outputPath(name + '-geometry.json'); await writeFile(proof, JSON.stringify(await geometry(), null, 2))
    await info.attach(name + '-geometry', { path: proof, contentType: 'application/json' })
    const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' })
    await info.attach(name, { path, contentType: 'image/png' })
  }
  const value = await geometry()
  expect(value.scrollTop).toBe(0)
  for (const box of value.boxes) {
    expect(box.right - box.left).toBeGreaterThan(0); expect(box.bottom - box.top).toBeGreaterThan(0)
    expect(box.left).toBeGreaterThanOrEqual(box.bounds.left - 1); expect(box.right).toBeLessThanOrEqual(box.bounds.right + 1)
    expect(box.top).toBeGreaterThanOrEqual(box.bounds.top - 1); expect(box.bottom).toBeLessThanOrEqual(box.bounds.bottom + 1)
    for (const text of box.text) {
      expect(text.rects.length).toBeGreaterThan(0)
      for (const rect of text.rects) {
        expect(rect.right - rect.left).toBeGreaterThan(0); expect(rect.bottom - rect.top).toBeGreaterThan(0)
        expect(rect.left).toBeGreaterThanOrEqual(text.bounds.left - 1); expect(rect.right).toBeLessThanOrEqual(text.bounds.right + 1)
        expect(rect.top).toBeGreaterThanOrEqual(text.bounds.top - 1); expect(rect.bottom).toBeLessThanOrEqual(text.bounds.bottom + 1)
      }
    }
  }
}
