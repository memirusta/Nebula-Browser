export interface FactoryResetOperations {
  clearBrowserProfiles(): Promise<void>
  clearPasswordVault(): Promise<void>
  clearShellStorage(): void
  reloadShell(): void
}

/** Destructive reset order: durable stores first, shell reload only after success. */
export async function runFactoryReset(
  operations: FactoryResetOperations,
): Promise<void> {
  await operations.clearBrowserProfiles()
  await operations.clearPasswordVault()
  operations.clearShellStorage()
  operations.reloadShell()
}
