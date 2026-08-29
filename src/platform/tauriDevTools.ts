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

const devToolsLifecycleQueues = new Map<string, Promise<void>>()

function queueDevToolsLifecycle(
  shortcutId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = devToolsLifecycleQueues.get(shortcutId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(operation)
  devToolsLifecycleQueues.set(shortcutId, next)
  void next.finally(() => {
    if (devToolsLifecycleQueues.get(shortcutId) === next) {
      devToolsLifecycleQueues.delete(shortcutId)
    }
  }).catch(() => {})
  return next
}

export async function callTabDevTools<T = unknown>(
  shortcutId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!isTauri) return {} as T
  let raw: string
  try {
    raw = await invoke<string>('webview_devtools_call', {
      label: tabWebviewLabel(shortcutId),
      method,
      paramsJson: JSON.stringify(params),
    })
  } catch (error) {
    throw new Error(`${method}: ${String(error)}`)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return {} as T
  }
}

export async function subscribeTabDevTools(shortcutId: string): Promise<void> {
  if (!isTauri) return
  await queueDevToolsLifecycle(shortcutId, async () => {
    await invoke('webview_devtools_subscribe', {
      label: tabWebviewLabel(shortcutId),
    })
  })
}

export async function unsubscribeTabDevTools(shortcutId: string): Promise<void> {
  if (!isTauri) return
  await queueDevToolsLifecycle(shortcutId, async () => {
    // Closing and immediately reopening Inspector used to let these detached
    // cleanup calls race the next subscription/domain setup. Keep the full
    // teardown ordered per tab so a stale close cannot disable a fresh picker.
    await callTabDevTools(shortcutId, 'Overlay.setInspectMode', {
      mode: 'none',
    }).catch(() => {})
    await callTabDevTools(shortcutId, 'Overlay.hideHighlight').catch(() => {})
    await invoke('webview_devtools_unsubscribe', {
      label: tabWebviewLabel(shortcutId),
    })
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
  for (const method of [
    'Runtime.enable',
    'Log.enable',
    'Page.enable',
    'Security.enable',
    'Network.enable',
    'Performance.enable',
  ]) {
    try {
      await callTabDevTools(shortcutId, method)
    } catch {
      // A missing domain must never prevent Inspector from opening.
    }
  }
}

export async function enableInspectorSectionDomains(
  shortcutId: string,
  section: 'elements' | 'storage' | 'network' | 'sources' | 'accessibility',
): Promise<void> {
  const domains =
    section === 'elements'
      ? ['DOM.enable', 'CSS.enable', 'Overlay.enable']
      : section === 'sources'
        ? ['Debugger.enable']
        : section === 'accessibility'
          ? ['Accessibility.enable']
          : ['Network.enable']

  for (const method of domains) {
    try {
      await callTabDevTools(shortcutId, method)
    } catch {
      // Keep the rest of the panel usable on partial CDP implementations.
    }
  }
}
