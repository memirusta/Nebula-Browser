import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export type TransitionLogStatus = 'start' | 'ok' | 'error' | 'info'

const frontendSessionId = `${Date.now()}-${crypto.randomUUID()}`
const transitionLoggingEnabled =
  import.meta.env.DEV || import.meta.env.VITE_NEBULA_TRANSITION_LOG === '1'

function sanitizedLogDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (typeof value !== 'string' || !key.toLowerCase().endsWith('url')) return [key, value]
      try {
        const parsed = new URL(value)
        return [key, parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : value]
      } catch {
        return [key, '[invalid-url]']
      }
    }),
  )
}

export function transitionErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    }
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return { errorValue: JSON.parse(JSON.stringify(error)) }
    } catch {
      return { errorValue: String(error) }
    }
  }
  return { errorValue: String(error) }
}

export async function writeTransitionLog(
  stage: string,
  status: TransitionLogStatus,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!isTauri || !transitionLoggingEnabled) return
  try {
    await invoke('write_transition_log', {
      entry: {
        frontendTimestamp: new Date().toISOString(),
        frontendSessionId,
        stage,
        status,
        ...sanitizedLogDetails(details),
      },
    })
  } catch (error) {
    // Diagnostics must never become another transition failure point.
    if (import.meta.env.DEV) {
      console.warn('[nebula] failed to persist native-tab transition log', error)
    }
  }
}

export async function traceTransitionCall<T>(
  traceId: string,
  stage: string,
  details: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now()
  await writeTransitionLog(stage, 'start', { traceId, ...details })
  try {
    const result = await operation()
    await writeTransitionLog(stage, 'ok', {
      traceId,
      ...details,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    })
    return result
  } catch (error) {
    await writeTransitionLog(stage, 'error', {
      traceId,
      ...details,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ...transitionErrorDetails(error),
    })
    throw error
  }
}
