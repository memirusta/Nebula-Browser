import styles from './BrowserShell.module.css'
import type { BrowserTab } from '../../core/browserTab'

type Props = {
  tabs: BrowserTab[]
  activeTabId: string | null
  visible: boolean
}

export function TabbedBrowserContent({ tabs, activeTabId, visible }: Props) {
  if (!visible || tabs.length === 0) {
    return null
  }

  return (
    <>
      {tabs.map((tab) => (
        <iframe
          key={tab.shortcutId}
          className={styles.browserFrame}
          src={tab.url}
          title={tab.title}
          hidden={tab.shortcutId !== activeTabId}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ))}
    </>
  )
}
