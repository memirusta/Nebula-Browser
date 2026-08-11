const PROTOCOL_HANDLER_KEY = 'nebula-protocol-handlers-v1'

export interface ProtocolHandlerDecision {
  scheme: string
  handlerUrl: string
  origin: string
  title: string
  allowed: boolean
}

type ProtocolHandlerStore = Record<string, ProtocolHandlerDecision>

function normalizeScheme(value: string): string {
  return value.trim().toLowerCase().replace(/:$/, '')
}

function loadStore(): ProtocolHandlerStore {
  try {
    const raw = localStorage.getItem(PROTOCOL_HANDLER_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const store: ProtocolHandlerStore = {}
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Partial<ProtocolHandlerDecision>
      if (
        typeof item.scheme !== 'string' ||
        typeof item.handlerUrl !== 'string' ||
        typeof item.origin !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.allowed !== 'boolean'
      ) {
        continue
      }

      const scheme = normalizeScheme(item.scheme)
      if (!scheme || !item.handlerUrl.includes('%s')) continue
      store[scheme] = {
        scheme,
        handlerUrl: item.handlerUrl,
        origin: item.origin,
        title: item.title,
        allowed: item.allowed,
      }
    }

    return store
  } catch {
    return {}
  }
}

function saveStore(store: ProtocolHandlerStore): void {
  try {
    localStorage.setItem(PROTOCOL_HANDLER_KEY, JSON.stringify(store))
  } catch {
    // Profile storage may be unavailable in hardened/private contexts.
  }
}

export function matchingProtocolHandlerDecision(
  scheme: string,
  handlerUrl: string,
  origin: string,
): ProtocolHandlerDecision | null {
  const normalized = normalizeScheme(scheme)
  const item = loadStore()[normalized]
  if (!item) return null
  if (item.handlerUrl !== handlerUrl || item.origin !== origin) return null
  return item
}

export function saveProtocolHandlerDecision(
  scheme: string,
  handlerUrl: string,
  origin: string,
  title: string,
  allowed: boolean,
): void {
  const normalized = normalizeScheme(scheme)
  if (!normalized || !handlerUrl.includes('%s')) return

  const store = loadStore()
  store[normalized] = {
    scheme: normalized,
    handlerUrl,
    origin,
    title,
    allowed,
  }
  saveStore(store)
}

export function resolveProtocolHandler(targetUri: string): string | null {
  let scheme = ''
  try {
    scheme = normalizeScheme(new URL(targetUri).protocol)
  } catch {
    const separator = targetUri.indexOf(':')
    if (separator <= 0) return null
    scheme = normalizeScheme(targetUri.slice(0, separator))
  }

  const item = loadStore()[scheme]
  if (!item?.allowed || !item.handlerUrl.includes('%s')) return null

  return item.handlerUrl.replace(/%s/g, encodeURIComponent(targetUri))
}