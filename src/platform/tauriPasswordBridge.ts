import { invoke } from '@tauri-apps/api/core'
import { tabWebviewLabel } from '../core/browserTab'
import {
  buildPasswordBridgeTickScript,
  buildPasswordFillScript,
  buildPasswordPromptDismissScript,
  parsePasswordBridgePoll,
  type BridgePromptConfig,
  type PasswordBridgePollResult,
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
  locale: 'tr' | 'en',
  prompt: BridgePromptConfig | null,
): Promise<PasswordBridgePollResult | null> {
  const raw = await runTabScriptExclusive(
    shortcutId,
    buildPasswordBridgeTickScript(locale, prompt),
  )
  if (!raw) return null
  return parsePasswordBridgePoll(raw)
}

export async function dismissInPagePasswordPrompt(shortcutId: string): Promise<void> {
  await runTabScriptExclusive(shortcutId, buildPasswordPromptDismissScript())
}

export async function fillPasswordOnTab(
  shortcutId: string,
  username: string,
  password: string,
): Promise<boolean> {
  const raw = await runTabScriptExclusive(
    shortcutId,
    buildPasswordFillScript(username, password),
  )
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed === true || parsed === 'true'
  } catch {
    return raw.includes('true')
  }
}
