import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { tabWebviewLabel } from '../../core/browserTab'
import { SHORTCUT_POSITIONS_KEY } from '../../core/shortcutLayout'
import { removeLocalStorage } from '../../core/storageSync'
import { SHORTCUT_FOLDERS_KEY } from '../../hooks/useShortcutFolders'
import {
  clearBrowseData,
  reloadBrowseTab,
} from '../../platform/tauriBrowser'
import {
  callTabDevTools,
  enableInspectorDomains,
  enableInspectorSectionDomains,
  getInspectorAudioState,
  getInspectorMemoryPressure,
  listenNebulaDevToolsEvents,
  type NebulaDevToolsEvent,
} from '../../platform/tauriDevTools'
import { isTauri } from '../../platform/runtime'
import styles from './DeveloperTools.module.css'

type DeveloperToolsSection =
  | 'overview'
  | 'elements'
  | 'console'
  | 'network'
  | 'performance'
  | 'storage'
  | 'site'
  | 'events'

type SourceViewMode = 'home' | 'browsing' | 'overlay'

type JsonRecord = Record<string, unknown>

interface DeveloperToolsProps {
  activeTabId: string | null
  activeUrl: string | null
  openTabIds: string[]
  sourceViewMode: SourceViewMode
  onClose: () => void
}

interface CdpDomNode {
  nodeId: number
  backendNodeId?: number
  nodeType: number
  nodeName: string
  nodeValue?: string
  localName?: string
  attributes?: string[]
  children?: CdpDomNode[]
  childNodeCount?: number
}

interface ConsoleEntry {
  id: string
  time: number
  level: string
  text: string
  source: string
  url?: string
}

interface NetworkEntry {
  requestId: string
  url: string
  method: string
  type?: string
  status?: number
  statusText?: string
  mimeType?: string
  protocol?: string
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  encodedDataLength?: number
  failed?: boolean
  errorText?: string
  fromDiskCache?: boolean
}

interface PerformanceMetric {
  name: string
  value: number
}

interface PageStorageSnapshot {
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}

interface CookieMetadata {
  name: string
  domain: string
  path: string
  expires?: number
  size?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
  session?: boolean
}

interface PageInfo {
  title?: string
  origin?: string
  readyState?: string
  visibilityState?: string
  language?: string
  charset?: string
  referrer?: string
  cookieEnabled?: boolean
  online?: boolean
  historyLength?: number
  devicePixelRatio?: number
  viewport?: {
    width?: number
    height?: number
  }
  permissions?: Record<string, string>
}

interface SelectedNodeInfo {
  node: CdpDomNode
  outerHtml: string
  computedStyles: Array<{
    name: string
    value: string
  }>
}

const MAX_CONSOLE = 300
const MAX_NETWORK = 400
const MAX_EVENTS = 300

const HIGHLIGHT_CONFIG = {
  showInfo: true,
  contentColor: { r: 92, g: 139, b: 255, a: 0.18 },
  paddingColor: { r: 90, g: 208, b: 255, a: 0.12 },
  borderColor: { r: 130, g: 170, b: 255, a: 0.9 },
  marginColor: { r: 255, g: 190, b: 92, a: 0.12 },
}

function safeJson(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {}
  } catch {
    return {}
  }
}

function nestedRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function remoteObjectText(value: unknown): string {
  const object = nestedRecord(value)
  if ('value' in object) {
    if (typeof object.value === 'string') return object.value
    try {
      return JSON.stringify(object.value)
    } catch {
      return String(object.value)
    }
  }
  if (typeof object.unserializableValue === 'string') return object.unserializableValue
  if (typeof object.description === 'string') return object.description
  if (typeof object.className === 'string') return object.className
  return String(object.type ?? 'undefined')
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function formatMetric(metric: PerformanceMetric): string {
  const sizeNames = new Set([
    'JSHeapUsedSize',
    'JSHeapTotalSize',
    'ArrayBufferContents',
  ])
  if (sizeNames.has(metric.name)) return formatBytes(metric.value)
  if (metric.name.endsWith('Duration')) return `${(metric.value * 1000).toFixed(1)} ms`
  if (Number.isInteger(metric.value)) return String(metric.value)
  return metric.value.toFixed(metric.value < 10 ? 3 : 1)
}

function attributesText(attributes: string[] | undefined): string {
  if (!attributes?.length) return ''
  const pairs: string[] = []
  for (let index = 0; index < attributes.length; index += 2) {
    const name = attributes[index]
    const value = attributes[index + 1] ?? ''
    pairs.push(`${name}="${value}"`)
  }
  return pairs.join(' ')
}

function visibleDomChildren(node: CdpDomNode): CdpDomNode[] {
  return (node.children ?? []).filter((child) => {
    if (child.nodeType === 1 || child.nodeType === 9 || child.nodeType === 10) return true
    return child.nodeType === 3 && Boolean(child.nodeValue?.trim())
  })
}

function DomTreeNode({
  node,
  depth,
  selectedNodeId,
  onSelect,
}: {
  node: CdpDomNode
  depth: number
  selectedNodeId: number | null
  onSelect: (node: CdpDomNode) => void
}) {
  const children = visibleDomChildren(node)
  const isText = node.nodeType === 3
  const tag = isText ? '#text' : node.nodeName.toLowerCase()
  const attrs = attributesText(node.attributes)
  const label = isText
    ? `“${(node.nodeValue ?? '').trim().slice(0, 90)}”`
    : `<${tag}${attrs ? ` ${attrs}` : ''}>`

  return (
    <div className={styles.domNode}>
      <button
        type="button"
        className={node.nodeId === selectedNodeId ? styles.domNodeSelected : styles.domNodeButton}
        style={{ paddingLeft: `${10 + depth * 13}px` }}
        onClick={() => onSelect(node)}
        title={label}
      >
        <span className={isText ? styles.domTextNode : styles.domTag}>{label}</span>
      </button>
      {children.map((child) => (
        <DomTreeNode
          key={`${child.nodeId}-${child.backendNodeId ?? 0}`}
          node={child}
          depth={depth + 1}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function prettyStorageValue(value: string | null): string {
  if (value === null) return '— empty —'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function upsertNetwork(
  entries: NetworkEntry[],
  requestId: string,
  patch: Partial<NetworkEntry>,
): NetworkEntry[] {
  const index = entries.findIndex((entry) => entry.requestId === requestId)
  if (index < 0) {
    return [{ requestId, url: '', method: 'GET', ...patch }, ...entries].slice(0, MAX_NETWORK)
  }
  const next = entries.slice()
  next[index] = { ...next[index], ...patch }
  return next
}

export function DeveloperTools({
  activeTabId,
  activeUrl,
  openTabIds,
  sourceViewMode,
  onClose,
}: DeveloperToolsProps) {
  const [section, setSection] = useState<DeveloperToolsSection>('overview')
  const [status, setStatus] = useState<string | null>(null)
  const [, setStorageRevision] = useState(0)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([])
  const [rawEvents, setRawEvents] = useState<NebulaDevToolsEvent[]>([])
  const [securityState, setSecurityState] = useState('unknown')
  const [memoryPressure, setMemoryPressure] = useState<number | null>(null)
  const [playingAudio, setPlayingAudio] = useState<boolean | null>(null)
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetric[]>([])
  const [heapUsed, setHeapUsed] = useState<number | null>(null)
  const [heapTotal, setHeapTotal] = useState<number | null>(null)
  const [domRoot, setDomRoot] = useState<CdpDomNode | null>(null)
  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null)
  const [styleFilter, setStyleFilter] = useState('')
  const [consoleFilter, setConsoleFilter] = useState('')
  const [networkFilter, setNetworkFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [consoleCommand, setConsoleCommand] = useState('')
  const [pageStorage, setPageStorage] = useState<PageStorageSnapshot | null>(null)
  const [cookies, setCookies] = useState<CookieMetadata[]>([])
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [loadingDom, setLoadingDom] = useState(false)
  const [inspectorReady, setInspectorReady] = useState(false)
  const consoleInputRef = useRef<HTMLInputElement>(null)

  const activeLabel = useMemo(
    () => (activeTabId ? tabWebviewLabel(activeTabId) : null),
    [activeTabId],
  )

  const addConsoleEntry = useCallback((entry: Omit<ConsoleEntry, 'id'>) => {
    setConsoleEntries((items) => [
      { ...entry, id: crypto.randomUUID() },
      ...items,
    ].slice(0, MAX_CONSOLE))
  }, [])

  const handleDevToolsEvent = useCallback((event: NebulaDevToolsEvent) => {
    setRawEvents((events) => [event, ...events].slice(0, MAX_EVENTS))
    const params = safeJson(event.paramsJson)

    if (event.event === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(params.args) ? params.args : []
      addConsoleEntry({
        time: event.timestampMs,
        level: typeof params.type === 'string' ? params.type : 'log',
        text: args.map(remoteObjectText).join(' '),
        source: 'console',
      })
      return
    }

    if (event.event === 'Runtime.exceptionThrown') {
      const details = nestedRecord(params.exceptionDetails)
      const exception = nestedRecord(details.exception)
      addConsoleEntry({
        time: event.timestampMs,
        level: 'error',
        text:
          (typeof exception.description === 'string' && exception.description) ||
          (typeof details.text === 'string' && details.text) ||
          'Uncaught exception',
        source: 'runtime',
        url: typeof details.url === 'string' ? details.url : undefined,
      })
      return
    }

    if (event.event === 'Log.entryAdded') {
      const entry = nestedRecord(params.entry)
      addConsoleEntry({
        time: event.timestampMs,
        level: typeof entry.level === 'string' ? entry.level : 'info',
        text: typeof entry.text === 'string' ? entry.text : 'Log entry',
        source: typeof entry.source === 'string' ? entry.source : 'log',
        url: typeof entry.url === 'string' ? entry.url : undefined,
      })
      return
    }

    const requestId = typeof params.requestId === 'string' ? params.requestId : ''
    if (event.event === 'Network.requestWillBeSent' && requestId) {
      const request = nestedRecord(params.request)
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          url: typeof request.url === 'string' ? request.url : '',
          method: typeof request.method === 'string' ? request.method : 'GET',
          type: typeof params.type === 'string' ? params.type : undefined,
          startedAt: typeof params.timestamp === 'number' ? params.timestamp : undefined,
          failed: false,
        }),
      )
      return
    }

    if (event.event === 'Network.responseReceived' && requestId) {
      const response = nestedRecord(params.response)
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          status: typeof response.status === 'number' ? response.status : undefined,
          statusText: typeof response.statusText === 'string' ? response.statusText : undefined,
          mimeType: typeof response.mimeType === 'string' ? response.mimeType : undefined,
          protocol: typeof response.protocol === 'string' ? response.protocol : undefined,
          fromDiskCache: response.fromDiskCache === true,
          type: typeof params.type === 'string' ? params.type : undefined,
        }),
      )
      return
    }

    if (event.event === 'Network.loadingFinished' && requestId) {
      const finishedAt = typeof params.timestamp === 'number' ? params.timestamp : undefined
      setNetworkEntries((items) => {
        const current = items.find((item) => item.requestId === requestId)
        const durationMs =
          current?.startedAt !== undefined && finishedAt !== undefined
            ? Math.max(0, (finishedAt - current.startedAt) * 1000)
            : undefined
        return upsertNetwork(items, requestId, {
          finishedAt,
          durationMs,
          encodedDataLength:
            typeof params.encodedDataLength === 'number' ? params.encodedDataLength : undefined,
        })
      })
      return
    }

    if (event.event === 'Network.loadingFailed' && requestId) {
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          failed: true,
          errorText: typeof params.errorText === 'string' ? params.errorText : 'Request failed',
          finishedAt: typeof params.timestamp === 'number' ? params.timestamp : undefined,
        }),
      )
      return
    }

    if (event.event === 'Security.securityStateChanged') {
      if (typeof params.securityState === 'string') setSecurityState(params.securityState)
    }
  }, [addConsoleEntry])

  const refreshOverview = useCallback(async () => {
    if (!activeTabId) return
    const [pressure, audio] = await Promise.all([
      getInspectorMemoryPressure(),
      getInspectorAudioState(activeTabId),
    ])
    setMemoryPressure(pressure)
    setPlayingAudio(audio)
  }, [activeTabId])

  const refreshPerformance = useCallback(async () => {
    if (!activeTabId) return
    try {
      const [performance, heap] = await Promise.all([
        callTabDevTools<{ metrics?: PerformanceMetric[] }>(activeTabId, 'Performance.getMetrics'),
        callTabDevTools<{ usedSize?: number; totalSize?: number }>(activeTabId, 'Runtime.getHeapUsage'),
      ])
      setPerformanceMetrics(Array.isArray(performance.metrics) ? performance.metrics : [])
      setHeapUsed(typeof heap.usedSize === 'number' ? heap.usedSize : null)
      setHeapTotal(typeof heap.totalSize === 'number' ? heap.totalSize : null)
    } catch (error) {
      setStatus(`Performance refresh failed: ${String(error)}`)
    }
  }, [activeTabId])

  const refreshDom = useCallback(async () => {
    if (!activeTabId) return
    setLoadingDom(true)
    try {
      const result = await callTabDevTools<{ root?: CdpDomNode }>(activeTabId, 'DOM.getDocument', {
        depth: 5,
        pierce: true,
      })
      setDomRoot(result.root ?? null)
      setStatus('DOM snapshot refreshed.')
    } catch (error) {
      setStatus(`DOM refresh failed: ${String(error)}`)
    } finally {
      setLoadingDom(false)
    }
  }, [activeTabId])

  const selectDomNode = useCallback(async (node: CdpDomNode) => {
    if (!activeTabId) return
    try {
      const [html, computed] = await Promise.all([
        callTabDevTools<{ outerHTML?: string }>(activeTabId, 'DOM.getOuterHTML', {
          nodeId: node.nodeId,
        }),
        callTabDevTools<{ computedStyle?: Array<{ name: string; value: string }> }>(
          activeTabId,
          'CSS.getComputedStyleForNode',
          { nodeId: node.nodeId },
        ),
        callTabDevTools(activeTabId, 'Overlay.highlightNode', {
          highlightConfig: HIGHLIGHT_CONFIG,
          nodeId: node.nodeId,
        }),
      ])
      setSelectedNode({
        node,
        outerHtml: html.outerHTML ?? '',
        computedStyles: Array.isArray(computed.computedStyle) ? computed.computedStyle : [],
      })
    } catch (error) {
      setStatus(`Node inspect failed: ${String(error)}`)
    }
  }, [activeTabId])

  const refreshPageStorage = useCallback(async () => {
    if (!activeTabId) return
    const expression = `(() => JSON.stringify({
      localStorage: Object.fromEntries(Array.from({length: localStorage.length}, (_, i) => { const k = localStorage.key(i); return k === null ? ['', ''] : [k, localStorage.getItem(k) ?? '']; }).filter(([k]) => k)),
      sessionStorage: Object.fromEntries(Array.from({length: sessionStorage.length}, (_, i) => { const k = sessionStorage.key(i); return k === null ? ['', ''] : [k, sessionStorage.getItem(k) ?? '']; }).filter(([k]) => k))
    }))()`
    try {
      const runtime = await callTabDevTools<{ result?: { value?: string } }>(
        activeTabId,
        'Runtime.evaluate',
        {
          expression,
          returnByValue: true,
        },
      )
      const raw = runtime.result?.value
      if (typeof raw === 'string') {
        try {
          setPageStorage(JSON.parse(raw) as PageStorageSnapshot)
        } catch {
          setPageStorage(null)
        }
      } else {
        setPageStorage(null)
      }
    } catch (error) {
      setPageStorage(null)
      setStatus(`Site storage refresh failed: ${String(error)}`)
    }

    // Cookie inspection is useful metadata, but it must never prevent the
    // page's local/session storage snapshot from being shown. Some WebView2
    // builds can reject or delay Network.getAllCookies independently.
    try {
      const cookieResult = await callTabDevTools<{ cookies?: CookieMetadata[] }>(
        activeTabId,
        'Network.getAllCookies',
      )
      setCookies(Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [])
    } catch {
      setCookies([])
    }
  }, [activeTabId])

  const refreshPageInfo = useCallback(async () => {
    if (!activeTabId) return
    const expression = `(async () => {
      const permissionNames = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read'];
      const permissions = {};
      for (const name of permissionNames) {
        try { permissions[name] = (await navigator.permissions.query({name})).state; }
        catch { permissions[name] = 'unsupported'; }
      }
      return JSON.stringify({
        title: document.title,
        origin: location.origin,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        language: navigator.language,
        charset: document.characterSet,
        referrer: document.referrer,
        cookieEnabled: navigator.cookieEnabled,
        online: navigator.onLine,
        historyLength: history.length,
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
        permissions
      });
    })()`
    try {
      const result = await callTabDevTools<{ result?: { value?: string } }>(
        activeTabId,
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
      )
      if (typeof result.result?.value === 'string') {
        setPageInfo(JSON.parse(result.result.value) as PageInfo)
      }
    } catch (error) {
      setStatus(`Site info refresh failed: ${String(error)}`)
    }
  }, [activeTabId])

  useEffect(() => {
    if (!activeTabId || !activeLabel || !isTauri) return

    let disposed = false
    let unlisten: (() => void) | undefined
    setInspectorReady(false)

    void (async () => {
      try {
        // Attach in a deterministic order. Live CDP event receivers are
        // intentionally disabled for this stability pass; direct CDP calls
        // still power Overview, Elements, Console evaluate, Performance,
        // Storage and Site. Once F12 is proven stable we can re-enable live
        // Console/Network events behind a safer dedicated bridge.
        unlisten = await listenNebulaDevToolsEvents((event) => {
          if (event.tabLabel === activeLabel) handleDevToolsEvent(event)
        })
        await enableInspectorDomains(activeTabId)
        if (disposed) return
        setInspectorReady(true)
        setStatus('Inspector attached (live events temporarily disabled).')
      } catch (error) {
        if (!disposed) setStatus(`Inspector attach failed: ${String(error)}`)
      }
    })()

    return () => {
      disposed = true
      setInspectorReady(false)
      unlisten?.()
      void callTabDevTools(activeTabId, 'Overlay.hideHighlight').catch(() => {})
    }
  }, [activeLabel, activeTabId, handleDevToolsEvent])

  useEffect(() => {
    if (!activeTabId || !inspectorReady) return
    let disposed = false
    void (async () => {
      await refreshOverview()
      if (disposed) return
      await refreshPerformance()
      if (disposed) return
      await refreshPageInfo()
    })()
    return () => {
      disposed = true
    }
  }, [activeTabId, inspectorReady, refreshOverview, refreshPageInfo, refreshPerformance])

  useEffect(() => {
    if (!inspectorReady || !activeTabId) return

    let disposed = false
    void (async () => {
      if (section === 'elements') {
        await enableInspectorSectionDomains(activeTabId, 'elements')
        if (!disposed && !domRoot) await refreshDom()
        return
      }
      if (section === 'performance') {
        await refreshPerformance()
        return
      }
      if (section === 'storage') {
        await enableInspectorSectionDomains(activeTabId, 'storage')
        if (!disposed) await refreshPageStorage()
        return
      }
      if (section === 'network') {
        await enableInspectorSectionDomains(activeTabId, 'network')
        return
      }
      if (section === 'site') await refreshPageInfo()
    })()

    return () => {
      disposed = true
    }
  }, [
    activeTabId,
    domRoot,
    inspectorReady,
    refreshDom,
    refreshPageInfo,
    refreshPageStorage,
    refreshPerformance,
    section,
  ])

  const nebulaStorageEntries = (() => {
    const entries: Array<{ key: string; value: string | null }> = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith('nebula-')) continue
      entries.push({ key, value: localStorage.getItem(key) })
    }
    return entries.sort((a, b) => a.key.localeCompare(b.key))
  })()

  const refreshStorage = () => setStorageRevision((revision) => revision + 1)
  const clearStorageKey = (key: string) => {
    removeLocalStorage(key)
    refreshStorage()
    window.setTimeout(refreshStorage, 100)
  }

  const runBrowserAction = async (label: string, action: () => Promise<void>) => {
    try {
      setStatus(`${label}...`)
      await action()
      setStatus(`${label} complete.`)
    } catch (error) {
      setStatus(`${label} failed: ${String(error)}`)
    }
  }

  const runConsoleCommand = async () => {
    const expression = consoleCommand.trim()
    if (!activeTabId || !expression) return
    addConsoleEntry({ time: Date.now(), level: 'command', text: `› ${expression}`, source: 'input' })
    setConsoleCommand('')
    try {
      const result = await callTabDevTools<{
        result?: JsonRecord
        exceptionDetails?: JsonRecord
      }>(activeTabId, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        generatePreview: true,
      })
      if (result.exceptionDetails) {
        const details = nestedRecord(result.exceptionDetails)
        const exception = nestedRecord(details.exception)
        addConsoleEntry({
          time: Date.now(),
          level: 'error',
          text:
            (typeof exception.description === 'string' && exception.description) ||
            (typeof details.text === 'string' && details.text) ||
            'Evaluation failed',
          source: 'evaluation',
        })
      } else {
        addConsoleEntry({
          time: Date.now(),
          level: 'result',
          text: remoteObjectText(result.result),
          source: 'evaluation',
        })
      }
    } catch (error) {
      addConsoleEntry({ time: Date.now(), level: 'error', text: String(error), source: 'evaluation' })
    }
  }

  const clearCurrentOriginStorage = async () => {
    if (!activeTabId || !activeUrl) return
    try {
      const origin = new URL(activeUrl).origin
      await callTabDevTools(activeTabId, 'Storage.clearDataForOrigin', {
        origin,
        storageTypes: 'all',
      })
      await refreshPageStorage()
      setStatus(`Cleared site storage for ${origin}.`)
    } catch (error) {
      setStatus(`Clear site storage failed: ${String(error)}`)
    }
  }

  const filteredConsole = useMemo(() => {
    const needle = consoleFilter.trim().toLowerCase()
    return needle
      ? consoleEntries.filter((entry) => `${entry.level} ${entry.source} ${entry.text}`.toLowerCase().includes(needle))
      : consoleEntries
  }, [consoleEntries, consoleFilter])

  const filteredNetwork = useMemo(() => {
    const needle = networkFilter.trim().toLowerCase()
    return needle
      ? networkEntries.filter((entry) => `${entry.method} ${entry.status ?? ''} ${entry.type ?? ''} ${entry.url}`.toLowerCase().includes(needle))
      : networkEntries
  }, [networkEntries, networkFilter])

  const filteredEvents = useMemo(() => {
    const needle = eventFilter.trim().toLowerCase()
    return needle
      ? rawEvents.filter((entry) => `${entry.event} ${entry.paramsJson}`.toLowerCase().includes(needle))
      : rawEvents
  }, [eventFilter, rawEvents])

  const filteredStyles = useMemo(() => {
    const needle = styleFilter.trim().toLowerCase()
    if (!selectedNode) return []
    return needle
      ? selectedNode.computedStyles.filter((item) => `${item.name}:${item.value}`.toLowerCase().includes(needle))
      : selectedNode.computedStyles
  }, [selectedNode, styleFilter])

  const consoleErrorCount = consoleEntries.filter((entry) => entry.level === 'error').length
  const failedRequestCount = networkEntries.filter((entry) => entry.failed || (entry.status ?? 0) >= 400).length

  const sections: Array<{ id: DeveloperToolsSection; label: string; badge?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'elements', label: 'Elements' },
    { id: 'console', label: 'Console', badge: consoleErrorCount || undefined },
    { id: 'network', label: 'Network', badge: failedRequestCount || undefined },
    { id: 'performance', label: 'Performance' },
    { id: 'storage', label: 'Storage' },
    { id: 'site', label: 'Site' },
    { id: 'events', label: 'Events' },
  ]

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section className={styles.panel} role="dialog" aria-modal="true" aria-label="Nebula Developer Tools">
        <header className={styles.header}>
          <div>
            <div className={styles.title}>Nebula Inspector</div>
            <div className={styles.subtitle}>
              {activeLabel ?? 'No active WebView'} · {activeUrl ?? 'No active URL'}
            </div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close developer tools" title="Close (F12 / Esc)">
              ✕
            </button>
          </div>
        </header>

        <div className={styles.workspace}>
          <nav className={styles.sidebar}>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                className={section === item.id ? styles.navItemActive : styles.navItem}
                onClick={() => setSection(item.id)}
              >
                <span>{item.label}</span>
                {item.badge !== undefined && <span className={styles.navBadge}>{item.badge}</span>}
              </button>
            ))}
          </nav>

          <main className={styles.content}>
            {!activeTabId && section !== 'storage' ? (
              <div className={styles.emptyState}>Open a browser tab to attach the Nebula inspector.</div>
            ) : null}

            {section === 'overview' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>Overview</h2><p>Live state for the active native WebView.</p></div>
                  <button type="button" className={styles.secondaryButton} onClick={() => void refreshOverview()}>Refresh</button>
                </div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>Active tab</span><strong>{activeTabId}</strong></div>
                  <div className={styles.metricCard}><span>Open tabs</span><strong>{openTabIds.length}</strong></div>
                  <div className={styles.metricCard}><span>Memory pressure</span><strong>{memoryPressure === null ? '—' : `${memoryPressure}%`}</strong></div>
                  <div className={styles.metricCard}><span>Audio</span><strong>{playingAudio === null ? '—' : playingAudio ? 'Playing' : 'Silent'}</strong></div>
                  <div className={styles.metricCard}><span>Security</span><strong>{securityState}</strong></div>
                  <div className={styles.metricCard}><span>Console errors</span><strong>{consoleErrorCount}</strong></div>
                  <div className={styles.metricCard}><span>Requests</span><strong>{networkEntries.length}</strong></div>
                  <div className={styles.metricCard}><span>Failed requests</span><strong>{failedRequestCount}</strong></div>
                </div>
                <div className={styles.urlCard}><span>Current URL</span><code>{activeUrl ?? '—'}</code></div>
                <div className={styles.actionGrid}>
                  <button type="button" className={styles.actionButton} onClick={() => void runBrowserAction('Reload', () => reloadBrowseTab(activeTabId))}><strong>Reload</strong><span>Reload active WebView</span></button>
                  <button type="button" className={styles.actionButton} onClick={() => void runBrowserAction('Clear cache', () => clearBrowseData(activeTabId, 'cache'))}><strong>Clear cache</strong><span>Clear active tab cache</span></button>
                  <button type="button" className={styles.actionButton} onClick={() => { setConsoleEntries([]); setNetworkEntries([]); setRawEvents([]); setStatus('Inspector buffers cleared.') }}><strong>Clear inspector buffers</strong><span>Console, network and event history</span></button>
                </div>
                <pre className={styles.debugOutput}>{JSON.stringify({ environment: import.meta.env.MODE, tauri: isTauri, openedFrom: sourceViewMode, userAgent: navigator.userAgent }, null, 2)}</pre>
              </div>
            )}

            {section === 'elements' && activeTabId && (
              <div className={styles.splitSection}>
                <div className={styles.splitPane}>
                  <div className={styles.paneToolbar}>
                    <strong>DOM</strong>
                    <button type="button" className={styles.smallButton} onClick={() => void refreshDom()}>{loadingDom ? 'Loading…' : 'Refresh'}</button>
                  </div>
                  <div className={styles.domTree}>
                    {domRoot ? <DomTreeNode node={domRoot} depth={0} selectedNodeId={selectedNode?.node.nodeId ?? null} onSelect={(node) => void selectDomNode(node)} /> : <div className={styles.emptyState}>No DOM snapshot yet.</div>}
                  </div>
                </div>
                <div className={styles.splitPane}>
                  <div className={styles.paneToolbar}><strong>Node details</strong>{selectedNode && <button type="button" className={styles.smallButton} onClick={() => { void callTabDevTools(activeTabId, 'Overlay.hideHighlight'); setSelectedNode(null) }}>Clear highlight</button>}</div>
                  {selectedNode ? (
                    <div className={styles.nodeInspector}>
                      <label>Outer HTML</label>
                      <pre className={styles.codeBlock}>{selectedNode.outerHtml}</pre>
                      <div className={styles.filterRow}><input value={styleFilter} onChange={(event) => setStyleFilter(event.target.value)} placeholder="Filter computed styles…" /></div>
                      <div className={styles.styleList}>
                        {filteredStyles.map((item) => <div key={`${item.name}-${item.value}`} className={styles.styleRow}><span>{item.name}</span><code>{item.value}</code></div>)}
                      </div>
                    </div>
                  ) : <div className={styles.emptyState}>Select a DOM node to inspect HTML and computed styles.</div>}
                </div>
              </div>
            )}

            {section === 'console' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}>
                  <div className={styles.filterRow}><input value={consoleFilter} onChange={(event) => setConsoleFilter(event.target.value)} placeholder="Filter console…" /></div>
                  <button type="button" className={styles.smallButton} onClick={() => setConsoleEntries([])}>Clear</button>
                </div>
                <div className={styles.consoleList}>
                  {filteredConsole.map((entry) => (
                    <div key={entry.id} className={`${styles.consoleRow} ${entry.level === 'error' ? styles.consoleError : entry.level === 'warning' || entry.level === 'warn' ? styles.consoleWarn : ''}`}>
                      <span className={styles.consoleLevel}>{entry.level}</span>
                      <span className={styles.consoleText}>{entry.text}</span>
                      <span className={styles.consoleTime}>{new Date(entry.time).toLocaleTimeString()}</span>
                    </div>
                  ))}
                  {filteredConsole.length === 0 && <div className={styles.emptyState}>Console is quiet.</div>}
                </div>
                <div className={styles.consolePrompt}>
                  <span>›</span>
                  <input ref={consoleInputRef} value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runConsoleCommand() }} placeholder="Evaluate JavaScript in the active page…" />
                  <button type="button" className={styles.smallButton} onClick={() => void runConsoleCommand()}>Run</button>
                </div>
              </div>
            )}

            {section === 'network' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}>
                  <div className={styles.filterRow}><input value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value)} placeholder="Filter URL, method, status, type…" /></div>
                  <span className={styles.toolbarStat}>{networkEntries.length} requests · {failedRequestCount} failed</span>
                  <button type="button" className={styles.smallButton} onClick={() => setNetworkEntries([])}>Clear</button>
                </div>
                <div className={styles.networkTable}>
                  <div className={styles.networkHead}><span>Status</span><span>Method</span><span>Type</span><span>URL</span><span>Time</span><span>Size</span></div>
                  {filteredNetwork.map((entry) => (
                    <div key={entry.requestId} className={`${styles.networkRow} ${entry.failed || (entry.status ?? 0) >= 400 ? styles.networkFailed : ''}`} title={entry.errorText ?? entry.url}>
                      <span>{entry.failed ? 'ERR' : entry.status ?? '…'}</span><span>{entry.method}</span><span>{entry.type ?? 'Other'}</span><code>{entry.url}</code><span>{entry.durationMs === undefined ? '—' : `${entry.durationMs.toFixed(0)} ms`}</span><span>{formatBytes(entry.encodedDataLength)}</span>
                    </div>
                  ))}
                  {filteredNetwork.length === 0 && <div className={styles.emptyState}>No requests captured since the inspector opened.</div>}
                </div>
              </div>
            )}

            {section === 'performance' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>Performance</h2><p>CDP performance counters and V8 heap usage.</p></div><button type="button" className={styles.secondaryButton} onClick={() => void refreshPerformance()}>Refresh</button></div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>JS heap used</span><strong>{heapUsed === null ? '—' : formatBytes(heapUsed)}</strong></div>
                  <div className={styles.metricCard}><span>JS heap total</span><strong>{heapTotal === null ? '—' : formatBytes(heapTotal)}</strong></div>
                  <div className={styles.metricCard}><span>Memory pressure</span><strong>{memoryPressure === null ? '—' : `${memoryPressure}%`}</strong></div>
                  <div className={styles.metricCard}><span>Captured metrics</span><strong>{performanceMetrics.length}</strong></div>
                </div>
                <div className={styles.metricList}>{performanceMetrics.map((metric) => <div key={metric.name} className={styles.metricRow}><span>{metric.name}</span><code>{formatMetric(metric)}</code></div>)}</div>
              </div>
            )}

            {section === 'storage' && (
              <div className={styles.storageColumns}>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}><div><h2>Nebula storage</h2><p>Browser shell localStorage state.</p></div><button type="button" className={styles.secondaryButton} onClick={refreshStorage}>Refresh</button></div>
                  <div className={styles.actionGrid}>
                    <button type="button" className={styles.actionButton} onClick={() => clearStorageKey(SHORTCUT_FOLDERS_KEY)}><strong>Clear folder cache</strong><span>{SHORTCUT_FOLDERS_KEY}</span></button>
                    <button type="button" className={styles.actionButton} onClick={() => clearStorageKey(SHORTCUT_POSITIONS_KEY)}><strong>Clear layout</strong><span>{SHORTCUT_POSITIONS_KEY}</span></button>
                  </div>
                  <div className={styles.storageList}>{nebulaStorageEntries.map((entry) => <details key={entry.key} className={styles.storageEntry}><summary><span>{entry.key}</span><button type="button" onClick={(event) => { event.preventDefault(); clearStorageKey(entry.key) }}>Delete</button></summary><pre>{prettyStorageValue(entry.value)}</pre></details>)}{nebulaStorageEntries.length === 0 && <div className={styles.emptyState}>No Nebula localStorage entries.</div>}</div>
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}><div><h2>Page storage</h2><p>Active site's local/session storage and cookie metadata.</p></div><button type="button" className={styles.secondaryButton} disabled={!activeTabId} onClick={() => void refreshPageStorage()}>Refresh</button></div>
                  {pageStorage ? <><h3 className={styles.subheading}>localStorage</h3><pre className={styles.debugOutput}>{JSON.stringify(pageStorage.localStorage, null, 2)}</pre><h3 className={styles.subheading}>sessionStorage</h3><pre className={styles.debugOutput}>{JSON.stringify(pageStorage.sessionStorage, null, 2)}</pre></> : <div className={styles.emptyState}>No page storage snapshot.</div>}
                  <h3 className={styles.subheading}>Cookies ({cookies.length})</h3>
                  <div className={styles.cookieList}>{cookies.map((cookie) => <div key={`${cookie.domain}-${cookie.path}-${cookie.name}`} className={styles.cookieRow}><strong>{cookie.name}</strong><span>{cookie.domain}{cookie.path}</span><small>{cookie.httpOnly ? 'HttpOnly · ' : ''}{cookie.secure ? 'Secure · ' : ''}{cookie.sameSite ?? 'Unspecified'}</small></div>)}</div>
                  <button type="button" className={styles.dangerButton} disabled={!activeTabId || !activeUrl} onClick={() => void clearCurrentOriginStorage()}><strong>Clear current site data</strong><span>Cookies, storage, cache data for the current origin</span></button>
                </div>
              </div>
            )}

            {section === 'site' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>Site</h2><p>Page identity, security and permission state.</p></div><button type="button" className={styles.secondaryButton} onClick={() => void refreshPageInfo()}>Refresh</button></div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>Security</span><strong>{securityState}</strong></div>
                  <div className={styles.metricCard}><span>Ready state</span><strong>{pageInfo?.readyState ?? '—'}</strong></div>
                  <div className={styles.metricCard}><span>Visibility</span><strong>{pageInfo?.visibilityState ?? '—'}</strong></div>
                  <div className={styles.metricCard}><span>Online</span><strong>{pageInfo?.online === undefined ? '—' : pageInfo.online ? 'Yes' : 'No'}</strong></div>
                  <div className={styles.metricCard}><span>Cookies</span><strong>{pageInfo?.cookieEnabled === undefined ? '—' : pageInfo.cookieEnabled ? 'Enabled' : 'Disabled'}</strong></div>
                  <div className={styles.metricCard}><span>History length</span><strong>{pageInfo?.historyLength ?? '—'}</strong></div>
                </div>
                <div className={styles.infoList}>
                  <div><span>Title</span><code>{pageInfo?.title ?? '—'}</code></div><div><span>Origin</span><code>{pageInfo?.origin ?? '—'}</code></div><div><span>Language</span><code>{pageInfo?.language ?? '—'}</code></div><div><span>Charset</span><code>{pageInfo?.charset ?? '—'}</code></div><div><span>Referrer</span><code>{pageInfo?.referrer || '—'}</code></div><div><span>Viewport</span><code>{pageInfo?.viewport ? `${pageInfo.viewport.width ?? '?'} × ${pageInfo.viewport.height ?? '?'} @ ${pageInfo.devicePixelRatio ?? 1}x` : '—'}</code></div>
                </div>
                <h3 className={styles.subheading}>Permissions</h3>
                <div className={styles.permissionGrid}>{Object.entries(pageInfo?.permissions ?? {}).map(([name, state]) => <div key={name} className={styles.permissionCard}><span>{name}</span><strong>{state}</strong></div>)}</div>
              </div>
            )}

            {section === 'events' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}><div className={styles.filterRow}><input value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} placeholder="Filter CDP events…" /></div><span className={styles.toolbarStat}>{rawEvents.length} buffered</span><button type="button" className={styles.smallButton} onClick={() => setRawEvents([])}>Clear</button></div>
                <div className={styles.eventList}>{filteredEvents.map((event, index) => <details key={`${event.timestampMs}-${event.event}-${index}`} className={styles.eventEntry}><summary><span>{event.event}</span><time>{new Date(event.timestampMs).toLocaleTimeString()}</time></summary><pre>{JSON.stringify(safeJson(event.paramsJson), null, 2)}</pre></details>)}{filteredEvents.length === 0 && <div className={styles.emptyState}>No matching CDP events.</div>}</div>
              </div>
            )}
          </main>
        </div>

        <footer className={styles.footer}>
          <span>F12 / Esc to close</span>
          <span className={styles.status}>{status ?? (activeTabId ? 'CDP-backed Nebula inspector' : 'Waiting for a tab')}</span>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
