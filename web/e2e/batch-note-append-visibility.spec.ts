import { expect, test } from '@playwright/test'
import { captureAppendDiscard } from './batch-note-append-support'

// A visible paragraph box and a successful centre hit must not conceal clipped text.
for (const clipping of ['warning-width', 'request-height', 'nested-container', 'ellipsis'] as const) {
  test('discard geometry rejects internally clipped text: ' + clipping, async ({ page }, info) => {
    const requestId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await page.setContent(`
      <style>
        .batch-append-body { width: 280px; padding: 8px; }
        p { overflow-wrap: anywhere; }
        button { margin: 8px; }
      </style>
      <div data-testid="batch-note-append-dialog">
        <div class="batch-append-body">
          <div data-testid="batch-note-append-discard-warning"><span>The server may already have saved your changes. Discarding cannot undo them.</span></div>
          <p>Request identifier: ${requestId}</p>
        </div>
        <button data-testid="batch-note-append-keep">Keep</button>
        <button data-testid="batch-note-append-discard">Discard</button>
      </div>`)
    await page.getByTestId('batch-note-append-keep').focus()
    await page.evaluate(clipping => {
      const warning = document.querySelector<HTMLElement>('[data-testid="batch-note-append-discard-warning"]')!
      const paragraph = document.querySelector('p')!
      if (clipping === 'request-height') Object.assign(paragraph.style, { height: '8px', overflow: 'hidden' })
      else if (clipping === 'nested-container') Object.assign(warning.firstElementChild!.style, { display: 'block', width: '80px', height: '18px', overflow: 'hidden' })
      else Object.assign(warning.style, { width: '80px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: clipping === 'ellipsis' ? 'ellipsis' : 'clip' })
    }, clipping)
    await expect(captureAppendDiscard(page, info, clipping, requestId)).rejects.toThrow()
  })
}

for (const layout of ['locked-root', 'unrelated-overflow'] as const) {
  test('discard geometry accepts fully visible text: ' + layout, async ({ page }, info) => {
    const requestId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await page.setContent(`
      <style>
        html { ${layout === 'locked-root' ? 'position: fixed; top: -700px; width: 100%; overflow-y: scroll;' : ''} }
        [data-testid="batch-note-append-dialog"] { position: fixed; inset: 10px; }
        .batch-append-body { width: 280px; height: 240px; overflow: auto; }
        p { overflow-wrap: anywhere; }
        .unrelated { margin-top: 400px; }
      </style>
      <div data-testid="batch-note-append-dialog">
        <div class="batch-append-body">
          <div data-testid="batch-note-append-discard-warning">The server may already have saved your changes.</div>
          <p>Request identifier: ${requestId}</p>
          ${layout === 'unrelated-overflow' ? '<div class="unrelated">Unrelated overflowing content</div>' : ''}
        </div>
        <button data-testid="batch-note-append-keep">Keep</button>
        <button data-testid="batch-note-append-discard">Discard</button>
      </div>`)
    await page.getByTestId('batch-note-append-keep').focus()
    await captureAppendDiscard(page, info, layout, requestId)
  })
}
