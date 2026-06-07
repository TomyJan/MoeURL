import { describe, expect, it } from 'vitest'

import { queryClient } from './query'

describe('query client', () => {
  it('uses stable default query options', () => {
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      refetchOnWindowFocus: false,
      retry: 1,
    })
  })
})
