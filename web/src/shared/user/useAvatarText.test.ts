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
})
