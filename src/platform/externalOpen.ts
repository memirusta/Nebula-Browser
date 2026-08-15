import { invoke } from '@tauri-apps/api/core'
import {
  listen,
  type UnlistenFn,
} from '@tauri-apps/api/event'

const EXTERNAL_URL_PENDING_EVENT =
  'nebula-external-url-pending'

export function takePendingExternalUrls(): Promise<string[]> {
  return invoke<string[]>(
    'take_pending_open_urls',
  )
}

export function listenExternalUrlPending(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(
    EXTERNAL_URL_PENDING_EVENT,
    () => {
      handler()
    },
  )
}