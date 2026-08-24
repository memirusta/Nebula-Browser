import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '../platform/runtime'

export const SENSITIVE_FEATURE_USAGE_EVENT = 'nebula-sensitive-feature-usage'

export interface SensitiveFeatureUsage {
  tabLabel: string
  origin: string
  camera: boolean
  microphone: boolean
  location: boolean
  screen: boolean
}

function isUsagePayload(value: unknown): value is SensitiveFeatureUsage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SensitiveFeatureUsage>
  if (
    typeof candidate.tabLabel !== 'string' ||
    !candidate.tabLabel.startsWith('nebula-tab-') ||
    typeof candidate.origin !== 'string' ||
    typeof candidate.camera !== 'boolean' ||
    typeof candidate.microphone !== 'boolean' ||
    typeof candidate.location !== 'boolean' ||
    typeof candidate.screen !== 'boolean'
  ) {
    return false
  }
  try {
    const origin = new URL(candidate.origin)
    return (
      (origin.protocol === 'https:' || origin.protocol === 'http:') &&
      origin.origin === candidate.origin
    )
  } catch {
    return false
  }
}

export async function listenSensitiveFeatureUsage(
  handler: (usage: SensitiveFeatureUsage) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {}
  return listen<unknown>(SENSITIVE_FEATURE_USAGE_EVENT, (event) => {
    if (isUsagePayload(event.payload)) handler(event.payload)
  })
}
