import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from './runtime'

export type SiteUiRequestType =
  | 'script-dialog'
  | 'permission'
  | 'basic-auth'
  | 'protocol-handler'
  | 'external-uri'
export type SiteDialogKind = 'alert' | 'confirm' | 'prompt' | 'beforeunload' | 'unknown'

export interface SiteUiRequest {
  id: string
  tabLabel: string
  requestType: SiteUiRequestType
  uri: string
  title: string
  message: string
  defaultText: string
  dialogKind?: SiteDialogKind | null
  permissionKind?: string | null
  challenge?: string | null
  isUserInitiated: boolean
}

export interface SiteUiResponse {
  accepted: boolean
  text?: string
  username?: string
  password?: string
  remember?: boolean
}

export interface SiteUiCancelledPayload {
  id: string
  tabLabel: string
}

export interface SiteNewWindowPayload {
  tabLabel: string
  uri: string
  userInitiated: boolean
}

export interface SiteCloseWindowPayload {
  tabLabel: string
}

export interface SitePointerDownPayload {
  tabLabel: string
}

export async function respondToSiteUi(
  requestId: string,
  response: SiteUiResponse,
): Promise<void> {
  if (!isTauri) return
  await invoke('site_ui_respond', {
    requestId,
    response: {
      accepted: response.accepted,
      text: response.text ?? '',
      username: response.username ?? '',
      password: response.password ?? '',
      remember: response.remember ?? false,
    },
  })
}

export function listenSiteUiRequests(
  onRequest: (payload: SiteUiRequest) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteUiRequest>('nebula-site-ui-request', ({ payload }) => onRequest(payload))
}

export function listenSiteUiCancelled(
  onCancelled: (payload: SiteUiCancelledPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteUiCancelledPayload>('nebula-site-ui-cancelled', ({ payload }) =>
    onCancelled(payload),
  )
}

export function listenSiteNewWindows(
  onNewWindow: (payload: SiteNewWindowPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteNewWindowPayload>('nebula-site-new-window', ({ payload }) =>
    onNewWindow(payload),
  )
}

export function listenSiteCloseWindows(
  onCloseWindow: (payload: SiteCloseWindowPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteCloseWindowPayload>('nebula-site-close-window', ({ payload }) =>
    onCloseWindow(payload),
  )
}

export function listenSitePointerDown(
  onPointerDown: (payload: SitePointerDownPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SitePointerDownPayload>('nebula-site-pointer-down', ({ payload }) =>
    onPointerDown(payload),
  )
}