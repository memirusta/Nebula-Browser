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

applyNebulaCssVars(loadNebulaSettings())
applyDocumentLocale()
resetHomeMenuStorageOnce()
migrateToEmptySemiLunarDockOnce(DEFAULT_SHORTCUTS)

if (isTauri) {
  document.documentElement.dataset.nebulaTauri = 'true'
}
if (isTauri && !isChromeShell()) {
  syncTauriViewMode('home', null)
}

async function renderRoot() {
  const Root = isChromeShell()
    ? (await import('./ChromeApp.tsx')).ChromeApp
    : (await import('./App.tsx')).default

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LocaleProvider>
        <Root />
      </LocaleProvider>
    </StrictMode>,
  )
}

void renderRoot()
