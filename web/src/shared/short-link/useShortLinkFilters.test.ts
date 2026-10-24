import { effectScope, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShortLinkFilters } from './useShortLinkFilters'

afterEach(() => vi.useRealTimers())
describe('short-link applied filters', () => {
  it('marks valid drafts pending until both normalized values are applied', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const filters = scope.run(useShortLinkFilters)!
    expect(filters.filtersPending.value).toBe(false)
    filters.searchKeyword.value = ' term '
    filters.tagFilter.value = ' tag '
    await nextTick()
    expect(filters.filtersPending.value).toBe(true)
    await vi.advanceTimersByTimeAsync(499)
    expect(filters.debouncedKeyword.value).toBe('')
    filters.searchKeyword.value = ' newer '
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(filters.debouncedKeyword.value).toBe('newer')
    expect(filters.debouncedTag.value).toBe('tag')
    expect(filters.filtersPending.value).toBe(false)
    scope.stop()
  })
  it('compares Go-normalized values including NEL and leaves invalid drafts to validation', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const filters = scope.run(useShortLinkFilters)!
    filters.searchKeyword.value = 'term'
    filters.tagFilter.value = 'tag'
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    filters.searchKeyword.value = '\u0085 term \u0085'
    filters.tagFilter.value = '\u0085 tag \u0085'
    expect(filters.filtersPending.value).toBe(false)
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(filters.filtersPending.value).toBe(false)
    filters.searchKeyword.value = 'bad\u0000'
    await nextTick()
    expect(filters.keywordInvalid.value).toBe(true)
    expect(filters.filtersPending.value).toBe(false)
    filters.searchKeyword.value = 'term'
    filters.tagFilter.value = 'bad\u0000'
    await nextTick()
    expect(filters.tagInvalid.value).toBe(true)
    expect(filters.filtersPending.value).toBe(false)
    scope.stop()
  })
})
