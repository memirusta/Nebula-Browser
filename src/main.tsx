import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ChromeApp } from './ChromeApp.tsx'
import { isChromeShell } from './core/nebulaBridge'
import { DEFAULT_SHORTCUTS } from './core/constants'
import { resetHomeMenuStorageOnce } from './core/homeMenuStorage'
import { applyNebulaCssVars, loadNebulaSettings } from './core/nebulaSettings'
import { migrateToEmptySemiLunarDockOnce } from './hooks/useShortcutPreferences'
import { isTauri } from './platform/runtime'
import { syncTauriViewMode } from './platform/tauriBrowsingMode'

applyNebulaCssVars(loadNebulaSettings())
resetHomeMenuStorageOnce()
migrateToEmptySemiLunarDockOnce(DEFAULT_SHORTCUTS)

if (isTauri) {
  document.documentElement.dataset.nebulaTauri = 'true'
}
if (isTauri && !isChromeShell()) {
  syncTauriViewMode('home', null)
}

const Root = isChromeShell() ? ChromeApp : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
