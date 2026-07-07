import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useAvatarText } from './useAvatarText'

describe('useAvatarText', () => {
  it('derives the uppercase first display character with MoeURL fallback', () => {
    const displayName = ref('alice')
    const avatarText = useAvatarText(displayName)

    expect(avatarText.value).toBe('A')

    displayName.value = ''
    expect(avatarText.value).toBe('M')
  })

  it('trims blank names and preserves multi-code-unit initials', () => {
    const displayName = ref('  😀 Alice')
    const avatarText = useAvatarText(displayName)

    expect(avatarText.value).toBe('😀')

    displayName.value = '   '
    expect(avatarText.value).toBe('M')
  })

  it('falls back for missing display names', () => {
    const displayName = ref<string | null | undefined>(null)
    const avatarText = useAvatarText(displayName)

    expect(avatarText.value).toBe('M')

    displayName.value = undefined
    expect(avatarText.value).toBe('M')
  })
})
