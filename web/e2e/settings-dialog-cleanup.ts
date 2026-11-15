/** Collects each cleanup failure while preserving order and earlier errors. */
export async function collectSettingsCleanupErrors(errors: unknown[], steps: Array<() => unknown | Promise<unknown>>): Promise<void> {
  for (const step of steps) {
    try { await step() } catch (error) { errors.push(error) }
  }
}
