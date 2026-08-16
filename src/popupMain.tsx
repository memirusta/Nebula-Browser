import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PopupChromeApp } from './PopupChromeApp'

document.documentElement.dataset.nebulaTauri = 'true'
document.documentElement.dataset.nebulaPopupChrome = 'true'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupChromeApp />
  </StrictMode>,
)
