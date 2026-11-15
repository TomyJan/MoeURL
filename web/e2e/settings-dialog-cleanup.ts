/** Collects each cleanup failure while preserving order and earlier errors. */
export async function collectSettingsCleanupErrors(errors: unknown[], steps: Array<() => unknown | Promise<unknown>>): Promise<void> {
  for (const step of steps) {
    try { await step() } catch (error) { errors.push(error) }
  }
}

/** Preserves the body failure and every cleanup failure without skipping later recovery. */
export async function withSettingsCleanup(body: () => unknown | Promise<unknown>, steps: Array<() => unknown | Promise<unknown>>): Promise<void> {
  const errors: unknown[] = []
  try { await body() } catch (error) { errors.push(error) }
  await collectSettingsCleanupErrors(errors, steps)
  if (errors.length) throw new AggregateError(errors, 'Settings operation or recovery failed')
}
