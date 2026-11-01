import { cleanup, render } from '@testing-library/vue'
import { afterEach, describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import InstantDetails from './InstantDetails.vue'
import { messages } from '@/app/i18n'

afterEach(cleanup)

describe('InstantDetails literal presentation', () => {
  it.each([
    '2026-01-01T00:30:00.123456789Z',
    '2026-01-01T08:30:59.987654321+08:00',
    '2026-01-01T00:30:00Z',
    '<img src=x onerror="alert(1)">',
    'not a timestamp',
    '',
  ])('preserves the supplied instant without parsing or rendering HTML: %s', instant => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const view = render(InstantDetails, { props: { instant, label: instant }, global: { plugins: [i18n] } })
    const details = view.container.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary time')?.textContent).toBe(instant)
    expect(details.querySelector('time')?.getAttribute('datetime')).toBe(instant)
    expect(details.querySelector('p')?.textContent).toBe(instant)
    expect(details.querySelector('img, script, a, button')).toBeNull()
  })

  it('localizes the disclosure hint without replacing the original instant or compact label', async () => {
    const instant = '2026-01-01T00:30:00.123456789Z'
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const view = render(InstantDetails, { props: { instant, label: 'Dec 31, 2025, 19:30' }, global: { plugins: [i18n] } })
    expect(view.container.querySelector('summary span')?.textContent).toBe('Exact time')
    i18n.global.locale.value = 'zh-CN'
    await nextTick()
    expect(view.container.querySelector('summary span')?.textContent).toBe('精确时间')
    expect(view.container.querySelector('summary time')?.textContent).toBe('Dec 31, 2025, 19:30')
    expect(view.container.querySelector('p')?.textContent).toBe(instant)
  })
})
