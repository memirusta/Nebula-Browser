import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { shortcutIdForTabWebviewLabel, tabWebviewLabel } from '../core/browserTab'
import {
  buildPasswordBridgeTickScript,
  buildPasswordBridgePollScript,
  buildPasswordFillScript,
  PASSWORD_BRIDGE_NEEDS_BOOTSTRAP,
  parsePasswordBridgePoll,
  type PasswordBridgePollResult,
  type PasswordFillTarget,
} from '../core/passwordBridgeScript'
import { isTauri } from './runtime'

const tabScriptChains = new Map<string, Promise<string | null>>()

function runTabScriptExclusive(shortcutId: string, script: string): Promise<string | null> {
  if (!isTauri) return Promise.resolve(null)

  const previous = tabScriptChains.get(shortcutId) ?? Promise.resolve(null)
  const next = previous
    .catch(() => null)
    .then(async () => {
      try {
        return await invoke<string>('webview_execute_script', {
          label: tabWebviewLabel(shortcutId),
          script,
        })
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[nebula] webview_execute_script failed', error)
        }
        return null
      }
    })

  tabScriptChains.set(shortcutId, next)
  void next.finally(() => {
    if (tabScriptChains.get(shortcutId) === next) {
      tabScriptChains.delete(shortcutId)
    }
  })

  return next
}

export async function tickPasswordBridge(
  shortcutId: string,
): Promise<PasswordBridgePollResult | null> {
  let raw = await runTabScriptExclusive(
    shortcutId,
    buildPasswordBridgePollScript(),
  )
  if (raw?.includes(PASSWORD_BRIDGE_NEEDS_BOOTSTRAP)) {
    raw = await runTabScriptExclusive(
      shortcutId,
      buildPasswordBridgeTickScript(),
    )
  }
  if (!raw) return null
  return parsePasswordBridgePoll(raw)
}

export type PasswordFillResult = 'username' | 'password' | 'both'

export async function fillPasswordOnTab(
  shortcutId: string,
  username: string,
  password: string,
  target: PasswordFillTarget = 'both',
): Promise<PasswordFillResult | null> {
  const raw = await runTabScriptExclusive(
    shortcutId,
    buildPasswordFillScript(username, password, target),
  )
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === 'username' || parsed === 'password' || parsed === 'both') return parsed
    return null
  } catch {
    if (raw.includes('username')) return 'username'
    if (raw.includes('password')) return 'password'
    if (raw.includes('both')) return 'both'
    return null
  }
}

export interface PasswordStepEvent {
  kind: 'identity' | 'submit'
  shortcutId: string
  origin: string
  url: string
  username: string
  password: string
}

interface NativePasswordStepPayload {
  kind?: string
  tabLabel?: string
  origin?: string
  url?: string
  username?: string
  password?: string
}

export async function listenForPasswordStepEvents(
  handler: (event: PasswordStepEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {}

  return listen<NativePasswordStepPayload>('nebula-password-step', (event) => {
    const payload = event.payload
    if (payload.kind !== 'identity' && payload.kind !== 'submit') return
    if (!payload.tabLabel || !payload.origin || !payload.url) return

    const shortcutId = shortcutIdForTabWebviewLabel(payload.tabLabel)
    if (!shortcutId) return

    handler({
      kind: payload.kind,
      shortcutId,
      origin: payload.origin,
      url: payload.url,
      username: payload.username ?? '',
      password: payload.password ?? '',
    })
  })
}
