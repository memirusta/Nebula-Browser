import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { tabWebviewLabel } from '../core/browserTab'
import { isTauri } from './runtime'

export interface NebulaDevToolsEvent {
  tabLabel: string
  event: string
  paramsJson: string
  timestampMs: number
}

export async function callTabDevTools<T = unknown>(
  shortcutId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauri) return {} as T
  const raw = await invoke<string>('webview_devtools_call', {
    label: tabWebviewLabel(shortcutId),
    method,
    paramsJson: JSON.stringify(params),
  })
  try {
    return JSON.parse(raw) as T
  } catch {
    return {} as T
  }
}

export async function subscribeTabDevTools(shortcutId: string): Promise<void> {
  if (!isTauri) return
  await invoke('webview_devtools_subscribe', {
    label: tabWebviewLabel(shortcutId),
  })
}

export async function unsubscribeTabDevTools(shortcutId: string): Promise<void> {
  if (!isTauri) return
  await invoke('webview_devtools_unsubscribe', {
    label: tabWebviewLabel(shortcutId),
  })
}

export function listenNebulaDevToolsEvents(
  onEvent: (event: NebulaDevToolsEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<NebulaDevToolsEvent>('nebula-devtools-event', ({ payload }) => onEvent(payload))
}

export async function getInspectorMemoryPressure(): Promise<number | null> {
  if (!isTauri) return null
  try {
    return await invoke<number>('get_system_memory_pressure')
  } catch {
    return null
  }
}

export async function getInspectorAudioState(shortcutId: string): Promise<boolean | null> {
  if (!isTauri) return null
  try {
    return await invoke<boolean>('webview_is_playing_audio', {
      label: tabWebviewLabel(shortcutId),
    })
  } catch {
    return null
  }
}

export async function enableInspectorDomains(shortcutId: string): Promise<void> {
  // Keep F12 attach intentionally tiny. Expensive domains are enabled lazily
  // by the panel that needs them so Inspector UI becomes interactive first.
  for (const method of ['Runtime.enable', 'Performance.enable']) {
    try {
      await callTabDevTools(shortcutId, method)
    } catch {
      // A missing domain must never prevent Inspector from opening.
    }
  }
}

export async function enableInspectorSectionDomains(
  shortcutId: string,
  section: 'elements' | 'storage' | 'network',
): Promise<void> {
  const domains =
    section === 'elements'
      ? ['DOM.enable', 'CSS.enable', 'Overlay.enable']
      : ['Network.enable']

  for (const method of domains) {
    try {
      await callTabDevTools(shortcutId, method)
    } catch {
      // Keep the rest of the panel usable on partial CDP implementations.
    }
  }
}
