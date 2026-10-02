export interface FactoryResetOperations {
  clearNotificationHistory(): Promise<void>
  clearBrowserProfiles(): Promise<void>
  clearPasswordVault(): Promise<void>
  clearGoogleSyncCredential(): Promise<void>
  clearShellStorage(): void
  /** The Rust-owned mirror of the shell storage, emptied after the shell storage is. */
  clearShellStateMirror(): Promise<void>
  reloadShell(): void
}

/** Destructive reset order: durable stores first, shell reload only after success. */
export async function runFactoryReset(
  operations: FactoryResetOperations,
): Promise<void> {
  // Capture stored IDs before profile clearing removes localStorage, so late
  // downloads/replay responses cannot reinsert them after the shell reload.
  await operations.clearNotificationHistory()
  await operations.clearBrowserProfiles()
  await operations.clearPasswordVault()
  await operations.clearGoogleSyncCredential()
  // Also discard notifications received while the native profiles were clearing.
  await operations.clearNotificationHistory()
  operations.clearShellStorage()
  await operations.clearShellStateMirror()
  operations.reloadShell()
}
