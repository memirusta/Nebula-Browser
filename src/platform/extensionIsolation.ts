import { showAppAlert, showAppConfirmation } from '../core/appDialog'
import { loadLocale } from '../core/locale'
import { shellIsolationCopy } from '../core/shellIsolationCopy'
import { switchShellIsolation } from './shellIsolation'

/**
 * An extension's package is ready but it may only start once Nebula's own screens are
 * separated from it. Ask once, in plain words, then run the switch (verified state,
 * restart); the extension turns on after the restart. Resolves true if the restart was
 * scheduled.
 */
export async function offerIsolationForExtension(): Promise<boolean> {
  const copy = shellIsolationCopy(loadLocale())
  const accepted = await showAppConfirmation(copy.extensionConfirm, copy.title)
  if (!accepted) return false
  try {
    await switchShellIsolation('split')
    return true
  } catch (error) {
    void showAppAlert(
      `${copy.failed}\n\n${error instanceof Error ? error.message : String(error)}`,
      copy.title,
    )
    return false
  }
}
