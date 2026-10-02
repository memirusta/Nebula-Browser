// First on purpose: mirrors localStorage writes, so it must hook before anything writes.
import './platform/shellStateMirror'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isChromeShell } from './core/nebulaBridge'
import { DEFAULT_SHORTCUTS } from './core/constants'
import { resetHomeMenuStorageOnce } from './core/homeMenuStorage'
import { applyNebulaCssVars, loadNebulaSettings } from './core/nebulaSettings'
import { migrateToEmptySemiLunarDockOnce } from './hooks/useShortcutPreferences'
import { applyDocumentLocale } from './core/locale'
import { LocaleProvider } from './hooks/useLocale'
import { isTauri } from './platform/runtime'
import { syncTauriViewMode } from './platform/tauriBrowsingMode'
import {
  prewarmUblockProfile,
  scheduleInitialBrowseWebviewPrewarm,
  initWindowRestoreRepair,
} from './platform/tauriBrowser'
import { writeTransitionLog } from './platform/tauriTransitionLog'
import { announceShellIsolationNotice } from './platform/shellIsolation'

const chromeShell = isChromeShell()

applyNebulaCssVars(loadNebulaSettings())
applyDocumentLocale()
resetHomeMenuStorageOnce()
migrateToEmptySemiLunarDockOnce(DEFAULT_SHORTCUTS)

if (isTauri) {
  document.documentElement.dataset.nebulaTauri = 'true'
}
if (chromeShell) {
  // Must be set before React mounts so the transparent chrome WebView never
  // paints the opaque Home fallback color for its first compositor frame.
  document.documentElement.dataset.nebulaChrome = 'true'
}
if (isTauri && !chromeShell) {
  syncTauriViewMode('home', null)
  // Window restore must be observed even when profile prewarm or WebView
  // creation stalls. Neither operation is a prerequisite for this listener.
  try {
    initWindowRestoreRepair()
  } catch (error) {
    void writeTransitionLog('browser.restore-listener.init', 'error', {
      errorName: error instanceof Error ? error.name : 'Unknown',
    })
  }
  void announceShellIsolationNotice().catch(() => undefined)
  void prewarmUblockProfile()
    .then(() => scheduleInitialBrowseWebviewPrewarm())
    .catch(() => undefined)
}

async function renderRoot() {
  const Root = chromeShell
    ? (await import('./ChromeApp.tsx')).ChromeApp
    : (await import('./App.tsx')).default

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LocaleProvider>
        <Root />
      </LocaleProvider>
    </StrictMode>,
  )

  if (isTauri && !chromeShell) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void writeTransitionLog(
          'performance.frontend-ready',
          'ok',
          {
            durationMs:
              Math.round(performance.now() * 10) / 10,
            timeOrigin:
              Math.round(performance.timeOrigin),
          },
        )
      })
    })
  }
}

void renderRoot()
