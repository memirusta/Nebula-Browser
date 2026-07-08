import { BrowserShell } from './components/BrowserShell/BrowserShell'
import { AppUpdatePrompt } from './components/AppUpdatePrompt/AppUpdatePrompt'
import './styles/global.css'

function App() {
  return (
    <>
      <BrowserShell />
      <AppUpdatePrompt />
    </>
  )
}

export default App
