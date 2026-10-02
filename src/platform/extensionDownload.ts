import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'
import { checkedExtensionDownload, type CheckedExtensionDownload } from '../core/extensionCheckedDownload'

export type ExtensionDownloadResult = CheckedExtensionDownload

export async function downloadExtension(id: string): Promise<ExtensionDownloadResult> {
  if (!isTauri) throw new Error('Extension downloads require the desktop app')
  return checkedExtensionDownload(await invoke<unknown>('extension_download_checked', { id }))
}

export interface ExtensionStatus { installed: boolean; enabled: boolean }

export async function extensionRuntimeVersion(): Promise<string> {
  if (!isTauri) throw new Error('Runtime version requires the desktop app')
  return invoke<string>('extension_runtime_version')
}

export async function manageExtension(id: string, action: 'status' | 'install' | 'remove' | 'enable' | 'disable', expectedSha256?: string): Promise<ExtensionStatus> {
  if (!isTauri) throw new Error('Extension management requires the desktop app')
  // A new command name prevents an older SponsorBlock-only runtime from
  // ignoring the ID and applying another card's action to SponsorBlock.
  return invoke<ExtensionStatus>('extension_package_manage', { id, action, expectedSha256 })
}

export interface InstalledExtension {
  id: string
  enabled: boolean
  version: string
  iconDataUrl: string | null
  hasPopup: boolean
  hasOptions: boolean
  hasSidePanel: boolean
  primaryView: 'popup' | 'side-panel' | null
  runsInProfile: boolean
  requiresNativeApp: boolean
  needsActionHost: boolean
  needsSidePanel: boolean
  isolatedProfile: boolean
  metadataAvailable: boolean
}

export async function installedExtensions(): Promise<InstalledExtension[]> {
  if (!isTauri) return []
  return invoke<InstalledExtension[]>('extension_host_list')
}

export async function openExtension(id: string, kind: 'popup' | 'options' | 'side-panel'): Promise<void> {
  if (!isTauri) throw new Error('Extension controls require the desktop app')
  return invoke<void>('extension_host_open', { id, kind })
}

export interface ExtensionClickResult {
  dispatched: boolean
  /** The extension had an onClicked listener. Without one, and without a popup, a click does nothing. */
  hasListener: boolean
  /** setPanelBehavior({ openPanelOnActionClick: true }): the browser opens the panel, no listener runs. */
  openPanelOnActionClick: boolean
  tabId: number | null
  tabUrl: string | null
  sidePanelRequested: boolean
  sidePanelPath: string | null
  error: string | null
}

/**
 * Emulate a click on the extension's toolbar icon. WebView2 has no toolbar, so
 * it never raises `chrome.action.onClicked`; the host does, in the worker.
 */
export async function clickExtension(id: string): Promise<ExtensionClickResult> {
  if (!isTauri) throw new Error('Extension controls require the desktop app')
  return invoke<ExtensionClickResult>('extension_host_click', { id })
}

export async function browseWithExtensions(url: string): Promise<void> {
  if (!isTauri) throw new Error('Extension trials require the desktop app')
  return invoke<void>('extension_host_browse', { url })
}
