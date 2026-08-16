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
import { prewarmBrowseWebview, prewarmUblockProfile } from './platform/tauriBrowser'
import { writeTransitionLog } from './platform/tauriTransitionLog'

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
  void prewarmUblockProfile()
    .then(() => prewarmBrowseWebview())
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
