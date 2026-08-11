import type { PasswordInput } from '@/entities/short-link/model'

type PasswordMutationInput = {
  password?: PasswordInput
}

/** Runs a short-link request with password material kept outside retained mutation variables. */
export async function runShortLinkMutation<Input extends PasswordMutationInput, Result>(
  mutationFn: (input: Input) => Promise<Result>,
  input: Omit<Input, 'password'>,
  password?: PasswordInput,
  passwordRequested = password !== undefined,
): Promise<Result> {
  const request = { ...input } as Input
  if (passwordRequested && !password) {
    throw new Error('password input was cleared before mutation execution')
  }
  if (password) {
    request.password = password
  }
  try {
    return await mutationFn(request)
  } finally {
    if (request.password?.mode === 'set') {
      delete request.password
    }
  }
}
