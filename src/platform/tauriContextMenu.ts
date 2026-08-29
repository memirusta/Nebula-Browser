import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from './runtime'

export const NEBULA_PRINT_COMMAND_ID = -10_001
export const NEBULA_INSPECT_COMMAND_ID = -10_002

export type SiteContextMenuItemKind = 'command' | 'check' | 'radio' | 'separator' | 'submenu'

export interface SiteContextMenuItem {
  commandId: number
  label: string
  name: string
  shortcut: string
  kind: SiteContextMenuItemKind
  enabled: boolean
  checked: boolean
  children: SiteContextMenuItem[]
}

export interface SiteContextMenuRequest {
  id: string
  tabLabel: string
  x: number
  y: number
  pageUri: string
  frameUri: string
  linkUri: string
  sourceUri: string
  selectionText: string
  editable: boolean
  items: SiteContextMenuItem[]
}

export interface SiteContextMenuCancelled {
  id: string
  tabLabel: string
}

export async function respondToSiteContextMenu(
  requestId: string,
  commandId: number | null,
): Promise<void> {
  if (!isTauri) return
  await invoke('site_context_menu_respond', {
    requestId,
    commandId,
  })
}

export function listenSiteContextMenus(
  onRequest: (request: SiteContextMenuRequest) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteContextMenuRequest>('nebula-site-context-menu', ({ payload }) =>
    onRequest(payload),
  )
}

export function listenSiteContextMenuCancelled(
  onCancelled: (payload: SiteContextMenuCancelled) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteContextMenuCancelled>('nebula-site-context-menu-cancelled', ({ payload }) =>
    onCancelled(payload),
  )
}
