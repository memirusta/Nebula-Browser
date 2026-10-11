import { useEffect, useState } from 'react'
import { showAppAlert, showAppConfirmation } from '../../core/appDialog'
import { shellIsolationCopy } from '../../core/shellIsolationCopy'
import { useLocale } from '../../hooks/useLocale'
import { installedExtensions } from '../../platform/extensionDownload'
import {
  shellIsolationStatus,
  switchShellIsolation,
  type ShellIsolationStatus,
} from '../../platform/shellIsolation'
import styles from './SettingsPanel.module.css'

/**
 * Opt-in: keep Nebula's own screens in a separate environment with no extensions
 * (docs/EXTENSION_OPT_IN_SPLIT.md). Off, the app is one environment as it always was.
 */
export function ShellIsolationSettings() {
  const { locale } = useLocale()
  const copy = shellIsolationCopy(locale)
  const [status, setStatus] = useState<ShellIsolationStatus | null>(null)
  const [extensionsEnabled, setExtensionsEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void shellIsolationStatus().then((value) => {
      if (!cancelled) setStatus(value)
    })
    void installedExtensions()
      .then((items) => {
        if (!cancelled) setExtensionsEnabled(items.some((item) => item.enabled && !item.isolatedProfile))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Not the desktop app, or the mode is forced by the environment: nothing to choose.
  if (!status || status.forced) return null

  const on = status.mode === 'split'
  // Going back is only offered while no extension runs in the browsing profile.
  const blocked = on && extensionsEnabled
  const busyOrPending = busy || status.pending !== null || status.hydrating

  const toggle = async () => {
    const accepted = await showAppConfirmation(
      on ? copy.confirmOff : copy.confirmOn,
      copy.title,
    )
    if (!accepted) return
    setBusy(true)
    try {
      await switchShellIsolation(on ? 'single' : 'split')
      // The host restarts Nebula a moment after this resolves.
    } catch (error) {
      setBusy(false)
      void showAppAlert(
        `${copy.failed}\n\n${error instanceof Error ? error.message : String(error)}`,
        copy.title,
      )
    }
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{copy.title}</div>
        <div className={styles.rowHint}>
          {blocked ? copy.blocked : copy.hint}
        </div>
      </div>
      <span className={on ? styles.statusActive : styles.statusInactive}>
        {on ? copy.on : copy.off}
      </span>
      <button
        type="button"
        className={styles.actionBtn}
        disabled={busyOrPending || blocked}
        onClick={() => void toggle()}
      >
        {on ? copy.disable : copy.enable}
      </button>
    </div>
  )
}
