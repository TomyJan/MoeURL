import { describe, expect, it } from 'vitest'

import errorCodes from '@/test/fixtures/user-group-error-codes.json'

import { INVALID_REQUEST_CODE, USER_GROUP_PERMISSION_CONFLICT_CODE } from './error-codes'

describe('shared API error codes', () => {
  it('matches the backend user-group error-code contract', () => {
    expect(INVALID_REQUEST_CODE).toBe(errorCodes.invalidRequest)
    expect(USER_GROUP_PERMISSION_CONFLICT_CODE).toBe(errorCodes.permissionConflict)
  })
})
