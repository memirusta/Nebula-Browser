import { BrowserShell } from './components/BrowserShell/BrowserShell'
import { AppUpdatePrompt } from './components/AppUpdatePrompt/AppUpdatePrompt'
import { TitleBar } from './components/TitleBar/TitleBar'
import './styles/global.css'

function App() {
  return (
    <>
      <TitleBar />
      <BrowserShell />
      <AppUpdatePrompt />
    </>
  )
}

export default App
