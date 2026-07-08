import { computed, type ComputedRef, type Ref } from 'vue'

interface MutationTargetSource<TVariables> {
  isPending: Ref<boolean>
  variables: Ref<TVariables | undefined>
}

export function useMutationTargetId<TVariables>(
  mutation: MutationTargetSource<TVariables>,
  extractId: (variables: TVariables | undefined) => string | undefined,
): ComputedRef<string> {
  return computed(() => {
    if (!mutation.isPending.value) {
      return ''
    }
    return extractId(mutation.variables.value) ?? ''
  })
}
