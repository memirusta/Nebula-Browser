import { useEffect } from 'react'
import { emit } from '@tauri-apps/api/event'
import { TitleBar } from './components/TitleBar/TitleBar'
import { matchBrowserShortcut, shouldIgnoreShellShortcut } from './core/browserShortcuts'
import './styles/global.css'

/** Minimal chrome webview: custom title bar only (semi-lunar lives on main shell). */
export function ChromeApp() {
  useEffect(() => {
    document.documentElement.dataset.nebulaChrome = 'true'
    return () => {
      delete document.documentElement.dataset.nebulaChrome
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShellShortcut(event)) return
      const action = matchBrowserShortcut(event)
      if (!action) return
      event.preventDefault()
      void emit('nebula-browser-shortcut', action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <TitleBar />
}
