import { isTauri } from './runtime'
import {
  hideBrowseTabById,
  showBrowseTabById,
  syncTauriBrowserBounds,
} from './tauriBrowser'
import {
  collapseChromeFromQuickMenu,
  expandChromeForQuickMenu,
} from './tauriChromeWebview'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'

let quickMenuOpen = false
let quickMenuTabId: string | null = null

export function isChromeQuickMenuOpen(): boolean {
  return quickMenuOpen
}

export async function enterChromeQuickMenu(activeTabId: string | null): Promise<boolean> {
  if (!isTauri || quickMenuOpen) return false

  setBrowsingChromeExpected(true)
  if (activeTabId) {
    await hideBrowseTabById(activeTabId)
  }

  const expanded = await expandChromeForQuickMenu()
  if (!expanded) {
    if (activeTabId) {
      await showBrowseTabById(activeTabId)
    }
    return false
  }

  quickMenuOpen = true
  quickMenuTabId = activeTabId
  cancelScheduledStack()
  await stackBrowsingChromeAboveBrowser(activeTabId)
  return true
}

export async function exitChromeQuickMenu(): Promise<void> {
  if (!isTauri || !quickMenuOpen) return

  const tabId = quickMenuTabId
  quickMenuOpen = false
  quickMenuTabId = null

  await collapseChromeFromQuickMenu()

  if (tabId) {
    await showBrowseTabById(tabId)
  }
  await syncTauriBrowserBounds()

  cancelScheduledStack()
  await stackBrowsingChromeAboveBrowser(tabId)
}
