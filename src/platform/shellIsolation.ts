import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export type ShellIsolationMode = 'single' | 'split'

export interface ShellIsolationStatus {
  mode: ShellIsolationMode
  pending: ShellIsolationMode | null
  /** Why the last switch was undone, until the user has been told. */
  notice: string | null
  hydrating: boolean
  /** The mode comes from the environment (tests); the user cannot change it. */
  forced: boolean
}

export interface ShellIsolationFailure {
  step: string
  message: string
}

export async function shellIsolationStatus(): Promise<ShellIsolationStatus | null> {
  if (!isTauri) return null
  try {
    return await invoke<ShellIsolationStatus>('shell_isolation_status')
  } catch {
    return null
  }
}

/**
 * Moves the shell into `target`. Resolves once the host has verified the state and
 * scheduled the restart (the app goes away right after); rejects with the step that failed.
 */
export async function switchShellIsolation(target: ShellIsolationMode): Promise<void> {
  try {
    await invoke<void>('shell_isolation_switch', { target })
  } catch (error) {
    const failure = error as Partial<ShellIsolationFailure> | string
    throw typeof failure === 'string'
      ? new Error(failure)
      : new Error(failure.message ?? 'The switch could not be started.')
  }
}

export async function acknowledgeShellIsolationNotice(): Promise<void> {
  if (!isTauri) return
  await invoke<void>('shell_isolation_ack_notice').catch(() => undefined)
}

/**
 * After a switch that did not verify the app is back in its previous setup (rolled back by
 * the host). Say so once, in the main window, and clear the notice.
 */
export async function announceShellIsolationNotice(): Promise<void> {
  const label = (
    window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: string } } }
    }
  ).__TAURI_INTERNALS__?.metadata?.currentWebview?.label
  if (label !== 'main') return
  const status = await shellIsolationStatus()
  if (!status?.notice) return
  const [{ showAppAlert }, { loadLocale }, { shellIsolationCopy }] = await Promise.all([
    import('../core/appDialog'),
    import('../core/locale'),
    import('../core/shellIsolationCopy'),
  ])
  const copy = shellIsolationCopy(loadLocale())
  // Acknowledged first: a notice shown on every start until dismissed would be worse than
  // one missed alert.
  await acknowledgeShellIsolationNotice()
  void showAppAlert(copy.notice, copy.title)
}
