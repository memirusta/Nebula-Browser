import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar/TitleBar'
import './styles/global.css'

/** Minimal chrome webview: custom title bar only (semi-lunar lives on main shell). */
export function ChromeApp() {
  useEffect(() => {
    document.documentElement.dataset.nebulaChrome = 'true'
    return () => {
      delete document.documentElement.dataset.nebulaChrome
    }
  }, [])

  return <TitleBar />
}
