import { computed, effectScope, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useCursorHistory } from './useCursorHistory'

describe('bounded cursor history', () => {
  it('rejects empty continuation, refuses to go before page one and resets on the applied context', () => {
    const scope = effectScope()
    const context = ref('link-A')
    const pages = scope.run(() => useCursorHistory(computed(() => context.value)))!
    pages.previous()
    pages.next('')
    expect(pages.cursor.value).toBe('')
    expect(pages.canPrevious.value).toBe(false)
    pages.next('cursor-2')
    pages.next('cursor-3')
    pages.previous()
    expect(pages.cursor.value).toBe('cursor-2')
    context.value = 'link-B'
    expect(pages.cursor.value).toBe('')
    expect(pages.canPrevious.value).toBe(false)
    scope.stop()
  })
})
