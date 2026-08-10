import type { PasswordInput } from '@/entities/short-link/model'

type PasswordMutationInput = {
  password?: PasswordInput
}

/** Runs a short-link request with password material kept outside retained mutation variables. */
export function runShortLinkMutation<Input extends PasswordMutationInput, Result>(
  mutationFn: (input: Input) => Promise<Result>,
  input: Omit<Input, 'password'>,
  password?: PasswordInput,
): Promise<Result> {
  const request = (password ? { ...input, password } : input) as Input
  try {
    return mutationFn(request)
  } finally {
    if (request.password?.mode === 'set') {
      delete request.password
    }
  }
}
