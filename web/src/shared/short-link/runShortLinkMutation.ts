import type { PasswordInput } from '@/entities/short-link/model'

type PasswordMutationInput = {
  password?: PasswordInput
}

/** Runs a mutation and removes raw password material from retained mutation variables. */
export async function runShortLinkMutation<Input extends PasswordMutationInput, Result>(
  mutationFn: (input: Input) => Promise<Result>,
  input: Input,
): Promise<Result> {
  try {
    return await mutationFn(input)
  } finally {
    if (input.password?.mode === 'set') {
      delete input.password
    }
  }
}
