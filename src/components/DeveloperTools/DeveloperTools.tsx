import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { tabWebviewLabel } from '../../core/browserTab'
import { SHORTCUT_POSITIONS_KEY } from '../../core/shortcutLayout'
import { removeLocalStorage } from '../../core/storageSync'
import { RequestEpoch, type RequestEpochSnapshot } from '../../core/requestEpoch'
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
import { useLocale } from '../../hooks/useLocale'
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

const COPY = {
  tr: {
    empty: '— boş —',
    uncaughtException: 'Yakalanmamış özel durum',
    logEntry: 'Günlük kaydı',
    requestFailed: 'İstek başarısız',
    performanceRefreshFailed: 'Performans yenileme başarısız',
    domRefreshed: 'DOM anlık görüntüsü yenilendi.',
    domRefreshFailed: 'DOM yenileme başarısız',
    nodeInspectFailed: 'Düğüm inceleme başarısız',
    storageRefreshFailed: 'Site depolaması yenilenemedi',
    siteInfoRefreshFailed: 'Site bilgisi yenilenemedi',
    inspectorAttached: 'Inspector bağlandı (canlı olaylar geçici olarak devre dışı).',
    inspectorAttachFailed: 'Inspector bağlantısı başarısız',
    evaluationFailed: 'Değerlendirme başarısız',
    actionProgress: (label: string) => `${label}…`,
    actionComplete: (label: string) => `${label} tamamlandı.`,
    actionFailed: (label: string) => `${label} başarısız`,
    clearedSiteStorage: (origin: string) => `${origin} için site verileri temizlendi.`,
    clearSiteStorageFailed: 'Site verileri temizlenemedi',
    titleAria: 'Nebula Geliştirici Araçları',
    inspector: 'Nebula Inspector',
    noActiveWebview: 'Aktif WebView yok',
    noActiveUrl: 'Aktif URL yok',
    closeAria: 'Geliştirici araçlarını kapat',
    closeTitle: 'Kapat (F12 / Esc)',
    overview: 'Genel Bakış',
    elements: 'Öğeler',
    console: 'Konsol',
    network: 'Ağ',
    performance: 'Performans',
    storage: 'Depolama',
    site: 'Site',
    events: 'Olaylar',
    openTabHint: 'Nebula inspector bağlamak için bir tarayıcı sekmesi aç.',
    overviewLead: 'Aktif native WebView için canlı durum.',
    refresh: 'Yenile',
    activeTab: 'Aktif sekme',
    openTabs: 'Açık sekmeler',
    memoryPressure: 'Bellek baskısı',
    audio: 'Ses',
    playing: 'Çalıyor',
    silent: 'Sessiz',
    security: 'Güvenlik',
    consoleErrors: 'Konsol hataları',
    requests: 'İstekler',
    failedRequests: 'Başarısız istekler',
    currentUrl: 'Geçerli URL',
    reload: 'Yenile',
    reloadHint: 'Aktif WebView’ı yenile',
    clearCache: 'Önbelleği temizle',
    clearCacheHint: 'Aktif sekmenin önbelleğini temizle',
    clearBuffers: 'Inspector tamponlarını temizle',
    clearBuffersHint: 'Konsol, ağ ve olay geçmişi',
    buffersCleared: 'Inspector tamponları temizlendi.',
    dom: 'DOM',
    loading: 'Yükleniyor…',
    noDom: 'Henüz DOM anlık görüntüsü yok.',
    nodeDetails: 'Düğüm ayrıntıları',
    clearHighlight: 'Vurguyu temizle',
    outerHtml: 'Dış HTML',
    filterStyles: 'Hesaplanan stilleri filtrele…',
    selectNode: 'HTML ve hesaplanan stilleri incelemek için bir DOM düğümü seç.',
    filterConsole: 'Konsolu filtrele…',
    clear: 'Temizle',
    consoleQuiet: 'Konsol sessiz.',
    evalPlaceholder: 'Aktif sayfada JavaScript değerlendir…',
    run: 'Çalıştır',
    filterNetwork: 'URL, yöntem, durum, tür filtrele…',
    failed: 'başarısız',
    status: 'Durum',
    method: 'Yöntem',
    type: 'Tür',
    time: 'Süre',
    size: 'Boyut',
    other: 'Diğer',
    noRequests: 'Inspector açıldığından beri istek yakalanmadı.',
    performanceLead: 'CDP performans sayaçları ve V8 heap kullanımı.',
    heapUsed: 'Kullanılan JS heap',
    heapTotal: 'Toplam JS heap',
    capturedMetrics: 'Yakalanan metrikler',
    nebulaStorage: 'Nebula depolaması',
    nebulaStorageLead: 'Tarayıcı kabuğunun localStorage durumu.',
    clearFolderCache: 'Klasör önbelleğini temizle',
    clearLayout: 'Yerleşimi temizle',
    delete: 'Sil',
    noNebulaStorage: 'Nebula localStorage kaydı yok.',
    pageStorage: 'Sayfa depolaması',
    pageStorageLead: 'Aktif sitenin local/session storage ve çerez meta verileri.',
    noPageStorage: 'Sayfa depolama anlık görüntüsü yok.',
    unspecified: 'Belirtilmemiş',
    clearCurrentSite: 'Geçerli site verilerini temizle',
    clearCurrentSiteHint: 'Geçerli origin için çerez, depolama ve önbellek verileri',
    siteLead: 'Sayfa kimliği, güvenlik ve izin durumu.',
    readyState: 'Hazır olma durumu',
    visibility: 'Görünürlük',
    online: 'Çevrimiçi',
    cookies: 'Çerezler',
    historyLength: 'Geçmiş uzunluğu',
    yes: 'Evet',
    no: 'Hayır',
    enabled: 'Etkin',
    disabled: 'Devre dışı',
    title: 'Başlık',
    origin: 'Origin',
    language: 'Dil',
    charset: 'Karakter seti',
    referrer: 'Yönlendiren',
    viewport: 'Görünüm alanı',
    permissions: 'İzinler',
    filterEvents: 'CDP olaylarını filtrele…',
    buffered: 'tamponda',
    noEvents: 'Eşleşen CDP olayı yok.',
    closeFooter: 'Kapatmak için F12 / Esc',
    cdpInspector: 'CDP tabanlı Nebula inspector',
    waitingTab: 'Sekme bekleniyor',
  },
  en: {
    empty: '— empty —', uncaughtException: 'Uncaught exception', logEntry: 'Log entry', requestFailed: 'Request failed',
    performanceRefreshFailed: 'Performance refresh failed', domRefreshed: 'DOM snapshot refreshed.', domRefreshFailed: 'DOM refresh failed', nodeInspectFailed: 'Node inspect failed', storageRefreshFailed: 'Site storage refresh failed', siteInfoRefreshFailed: 'Site info refresh failed',
    inspectorAttached: 'Inspector attached (live events temporarily disabled).', inspectorAttachFailed: 'Inspector attach failed', evaluationFailed: 'Evaluation failed', actionProgress: (label: string) => `${label}…`, actionComplete: (label: string) => `${label} complete.`, actionFailed: (label: string) => `${label} failed`, clearedSiteStorage: (origin: string) => `Cleared site storage for ${origin}.`, clearSiteStorageFailed: 'Clear site storage failed',
    titleAria: 'Nebula Developer Tools', inspector: 'Nebula Inspector', noActiveWebview: 'No active WebView', noActiveUrl: 'No active URL', closeAria: 'Close developer tools', closeTitle: 'Close (F12 / Esc)',
    overview: 'Overview', elements: 'Elements', console: 'Console', network: 'Network', performance: 'Performance', storage: 'Storage', site: 'Site', events: 'Events', openTabHint: 'Open a browser tab to attach the Nebula inspector.', overviewLead: 'Live state for the active native WebView.', refresh: 'Refresh',
    activeTab: 'Active tab', openTabs: 'Open tabs', memoryPressure: 'Memory pressure', audio: 'Audio', playing: 'Playing', silent: 'Silent', security: 'Security', consoleErrors: 'Console errors', requests: 'Requests', failedRequests: 'Failed requests', currentUrl: 'Current URL', reload: 'Reload', reloadHint: 'Reload active WebView', clearCache: 'Clear cache', clearCacheHint: 'Clear active tab cache', clearBuffers: 'Clear inspector buffers', clearBuffersHint: 'Console, network and event history', buffersCleared: 'Inspector buffers cleared.',
    dom: 'DOM', loading: 'Loading…', noDom: 'No DOM snapshot yet.', nodeDetails: 'Node details', clearHighlight: 'Clear highlight', outerHtml: 'Outer HTML', filterStyles: 'Filter computed styles…', selectNode: 'Select a DOM node to inspect HTML and computed styles.', filterConsole: 'Filter console…', clear: 'Clear', consoleQuiet: 'Console is quiet.', evalPlaceholder: 'Evaluate JavaScript in the active page…', run: 'Run', filterNetwork: 'Filter URL, method, status, type…', failed: 'failed', status: 'Status', method: 'Method', type: 'Type', time: 'Time', size: 'Size', other: 'Other', noRequests: 'No requests captured since the inspector opened.',
    performanceLead: 'CDP performance counters and V8 heap usage.', heapUsed: 'JS heap used', heapTotal: 'JS heap total', capturedMetrics: 'Captured metrics', nebulaStorage: 'Nebula storage', nebulaStorageLead: 'Browser shell localStorage state.', clearFolderCache: 'Clear folder cache', clearLayout: 'Clear layout', delete: 'Delete', noNebulaStorage: 'No Nebula localStorage entries.', pageStorage: 'Page storage', pageStorageLead: "Active site's local/session storage and cookie metadata.", noPageStorage: 'No page storage snapshot.', unspecified: 'Unspecified', clearCurrentSite: 'Clear current site data', clearCurrentSiteHint: 'Cookies, storage, cache data for the current origin',
    siteLead: 'Page identity, security and permission state.', readyState: 'Ready state', visibility: 'Visibility', online: 'Online', cookies: 'Cookies', historyLength: 'History length', yes: 'Yes', no: 'No', enabled: 'Enabled', disabled: 'Disabled', title: 'Title', origin: 'Origin', language: 'Language', charset: 'Charset', referrer: 'Referrer', viewport: 'Viewport', permissions: 'Permissions', filterEvents: 'Filter CDP events…', buffered: 'buffered', noEvents: 'No matching CDP events.', closeFooter: 'F12 / Esc to close', cdpInspector: 'CDP-backed Nebula inspector', waitingTab: 'Waiting for a tab',
  },
} as const

const TECHNICAL_STATE_LABELS = {
  tr: {
    unknown: 'Bilinmiyor',
    neutral: 'Nötr',
    insecure: 'Güvenli değil',
    'insecure-broken': 'Güvenlik hatası',
    secure: 'Güvenli',
    info: 'Bilgi',
    loading: 'Yükleniyor',
    interactive: 'Etkileşimli',
    complete: 'Tamamlandı',
    visible: 'Görünür',
    hidden: 'Gizli',
    prerender: 'Önceden oluşturuluyor',
    granted: 'İzin verildi',
    denied: 'Reddedildi',
    prompt: 'Sor',
    error: 'Hata',
    warning: 'Uyarı',
    warn: 'Uyarı',
    log: 'Günlük',
    debug: 'Hata ayıklama',
    verbose: 'Ayrıntılı',
  },
  en: {
    unknown: 'Unknown',
    neutral: 'Neutral',
    insecure: 'Not secure',
    'insecure-broken': 'Security error',
    secure: 'Secure',
    info: 'Info',
    loading: 'Loading',
    interactive: 'Interactive',
    complete: 'Complete',
    visible: 'Visible',
    hidden: 'Hidden',
    prerender: 'Prerendering',
    granted: 'Granted',
    denied: 'Denied',
    prompt: 'Ask',
    error: 'Error',
    warning: 'Warning',
    warn: 'Warning',
    log: 'Log',
    debug: 'Debug',
    verbose: 'Verbose',
  },
} as const

function localizeTechnicalState(locale: 'tr' | 'en', value: string | null | undefined): string {
  if (!value) return '—'
  const key = value.toLowerCase()
  const labels = TECHNICAL_STATE_LABELS[locale] as Record<string, string>
  return labels[key] ?? value
}

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

function prettyStorageValue(value: string | null, emptyLabel: string): string {
  if (value === null) return emptyLabel
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
  const { locale } = useLocale()
  const copy = COPY[locale]
  const dialogRef = useRef<HTMLElement>(null)
  useModalFocusTrap(dialogRef)
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
  const requestEpochRef = useRef(new RequestEpoch<string | null>(activeTabId))
  requestEpochRef.current.sync(activeTabId)

  const captureTabRequest = useCallback((): {
    tabId: string
    epoch: RequestEpochSnapshot<string | null>
  } | null => {
    const epoch = requestEpochRef.current.capture()
    return activeTabId && epoch.key === activeTabId
      ? { tabId: activeTabId, epoch }
      : null
  }, [activeTabId])

  const requestIsCurrent = useCallback(
    (epoch: RequestEpochSnapshot<string | null>) =>
      requestEpochRef.current.isCurrent(epoch),
    [],
  )

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
          copy.uncaughtException,
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
        text: typeof entry.text === 'string' ? entry.text : copy.logEntry,
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
          errorText: typeof params.errorText === 'string' ? params.errorText : copy.requestFailed,
          finishedAt: typeof params.timestamp === 'number' ? params.timestamp : undefined,
        }),
      )
      return
    }

    if (event.event === 'Security.securityStateChanged') {
      if (typeof params.securityState === 'string') setSecurityState(params.securityState)
    }
  }, [addConsoleEntry, copy])

  const refreshOverview = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    const [pressure, audio] = await Promise.all([
      getInspectorMemoryPressure(),
      getInspectorAudioState(request.tabId),
    ])
    if (!requestIsCurrent(request.epoch)) return
    setMemoryPressure(pressure)
    setPlayingAudio(audio)
  }, [captureTabRequest, requestIsCurrent])

  const refreshPerformance = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    try {
      const [performance, heap] = await Promise.all([
        callTabDevTools<{ metrics?: PerformanceMetric[] }>(request.tabId, 'Performance.getMetrics'),
        callTabDevTools<{ usedSize?: number; totalSize?: number }>(request.tabId, 'Runtime.getHeapUsage'),
      ])
      if (!requestIsCurrent(request.epoch)) return
      setPerformanceMetrics(Array.isArray(performance.metrics) ? performance.metrics : [])
      setHeapUsed(typeof heap.usedSize === 'number' ? heap.usedSize : null)
      setHeapTotal(typeof heap.totalSize === 'number' ? heap.totalSize : null)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.performanceRefreshFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.performanceRefreshFailed, requestIsCurrent])

  const refreshDom = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    setLoadingDom(true)
    try {
      const result = await callTabDevTools<{ root?: CdpDomNode }>(request.tabId, 'DOM.getDocument', {
        depth: 5,
        pierce: true,
      })
      if (!requestIsCurrent(request.epoch)) return
      setDomRoot(result.root ?? null)
      setStatus(copy.domRefreshed)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.domRefreshFailed}: ${String(error)}`)
      }
    } finally {
      if (requestIsCurrent(request.epoch)) setLoadingDom(false)
    }
  }, [captureTabRequest, copy.domRefreshFailed, copy.domRefreshed, requestIsCurrent])

  const selectDomNode = useCallback(async (node: CdpDomNode) => {
    const request = captureTabRequest()
    if (!request) return
    try {
      const [html, computed] = await Promise.all([
        callTabDevTools<{ outerHTML?: string }>(request.tabId, 'DOM.getOuterHTML', {
          nodeId: node.nodeId,
        }),
        callTabDevTools<{ computedStyle?: Array<{ name: string; value: string }> }>(
          request.tabId,
          'CSS.getComputedStyleForNode',
          { nodeId: node.nodeId },
        ),
        callTabDevTools(request.tabId, 'Overlay.highlightNode', {
          highlightConfig: HIGHLIGHT_CONFIG,
          nodeId: node.nodeId,
        }),
      ])
      if (!requestIsCurrent(request.epoch)) return
      setSelectedNode({
        node,
        outerHtml: html.outerHTML ?? '',
        computedStyles: Array.isArray(computed.computedStyle) ? computed.computedStyle : [],
      })
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.nodeInspectFailed, requestIsCurrent])

  const refreshPageStorage = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    const expression = `(() => JSON.stringify({
      localStorage: Object.fromEntries(Array.from({length: localStorage.length}, (_, i) => { const k = localStorage.key(i); return k === null ? ['', ''] : [k, localStorage.getItem(k) ?? '']; }).filter(([k]) => k)),
      sessionStorage: Object.fromEntries(Array.from({length: sessionStorage.length}, (_, i) => { const k = sessionStorage.key(i); return k === null ? ['', ''] : [k, sessionStorage.getItem(k) ?? '']; }).filter(([k]) => k))
    }))()`
    try {
      const runtime = await callTabDevTools<{ result?: { value?: string } }>(
        request.tabId,
        'Runtime.evaluate',
        {
          expression,
          returnByValue: true,
        },
      )
      if (!requestIsCurrent(request.epoch)) return
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
      if (requestIsCurrent(request.epoch)) {
        setPageStorage(null)
        setStatus(`${copy.storageRefreshFailed}: ${String(error)}`)
      }
    }

    if (!requestIsCurrent(request.epoch)) return

    // Cookie inspection is useful metadata, but it must never prevent the
    // page's local/session storage snapshot from being shown. Some WebView2
    // builds can reject or delay Network.getAllCookies independently.
    try {
      const cookieResult = await callTabDevTools<{ cookies?: CookieMetadata[] }>(
        request.tabId,
        'Network.getAllCookies',
      )
      if (!requestIsCurrent(request.epoch)) return
      setCookies(Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [])
    } catch {
      if (requestIsCurrent(request.epoch)) setCookies([])
    }
  }, [captureTabRequest, copy.storageRefreshFailed, requestIsCurrent])

  const refreshPageInfo = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
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
        request.tabId,
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
      )
      if (!requestIsCurrent(request.epoch)) return
      if (typeof result.result?.value === 'string') {
        setPageInfo(JSON.parse(result.result.value) as PageInfo)
      }
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.siteInfoRefreshFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.siteInfoRefreshFailed, requestIsCurrent])

  useEffect(() => {
    setStatus(null)
    setConsoleEntries([])
    setNetworkEntries([])
    setRawEvents([])
    setSecurityState('unknown')
    setMemoryPressure(null)
    setPlayingAudio(null)
    setPerformanceMetrics([])
    setHeapUsed(null)
    setHeapTotal(null)
    setDomRoot(null)
    setSelectedNode(null)
    setPageStorage(null)
    setCookies([])
    setPageInfo(null)
    setLoadingDom(false)
    setInspectorReady(false)
  }, [activeTabId])

  useEffect(() => {
    if (!activeTabId || !activeLabel || !isTauri) return

    let disposed = false
    let unlisten: (() => void) | undefined
    const epoch = requestEpochRef.current.capture()
    if (epoch.key !== activeTabId) return
    setInspectorReady(false)

    void (async () => {
      try {
        // Attach in a deterministic order. Live CDP event receivers are
        // intentionally disabled for this stability pass; direct CDP calls
        // still power Overview, Elements, Console evaluate, Performance,
        // Storage and Site. Once F12 is proven stable we can re-enable live
        // Console/Network events behind a safer dedicated bridge.
        unlisten = await listenNebulaDevToolsEvents((event) => {
          if (
            requestIsCurrent(epoch) &&
            event.tabLabel === activeLabel
          ) {
            handleDevToolsEvent(event)
          }
        })
        await enableInspectorDomains(activeTabId)
        if (disposed || !requestIsCurrent(epoch)) return
        setInspectorReady(true)
        setStatus(copy.inspectorAttached)
      } catch (error) {
        if (!disposed && requestIsCurrent(epoch)) {
          setStatus(`${copy.inspectorAttachFailed}: ${String(error)}`)
        }
      }
    })()

    return () => {
      disposed = true
      setInspectorReady(false)
      unlisten?.()
      void callTabDevTools(activeTabId, 'Overlay.hideHighlight').catch(() => {})
    }
  }, [activeLabel, activeTabId, copy.inspectorAttachFailed, copy.inspectorAttached, handleDevToolsEvent, requestIsCurrent])

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
    const request = captureTabRequest()
    if (!request) return
    try {
      setStatus(copy.actionProgress(label))
      await action()
      if (!requestIsCurrent(request.epoch)) return
      setStatus(copy.actionComplete(label))
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.actionFailed(label)}: ${String(error)}`)
      }
    }
  }

  const runConsoleCommand = async () => {
    const expression = consoleCommand.trim()
    const request = captureTabRequest()
    if (!request || !expression) return
    addConsoleEntry({ time: Date.now(), level: 'command', text: `› ${expression}`, source: 'input' })
    setConsoleCommand('')
    try {
      const result = await callTabDevTools<{
        result?: JsonRecord
        exceptionDetails?: JsonRecord
      }>(request.tabId, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        generatePreview: true,
      })
      if (!requestIsCurrent(request.epoch)) return
      if (result.exceptionDetails) {
        const details = nestedRecord(result.exceptionDetails)
        const exception = nestedRecord(details.exception)
        addConsoleEntry({
          time: Date.now(),
          level: 'error',
          text:
            (typeof exception.description === 'string' && exception.description) ||
            (typeof details.text === 'string' && details.text) ||
            copy.evaluationFailed,
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
      if (requestIsCurrent(request.epoch)) {
        addConsoleEntry({ time: Date.now(), level: 'error', text: String(error), source: 'evaluation' })
      }
    }
  }

  const clearCurrentOriginStorage = async () => {
    const request = captureTabRequest()
    if (!request || !activeUrl) return
    try {
      const origin = new URL(activeUrl).origin
      await callTabDevTools(request.tabId, 'Storage.clearDataForOrigin', {
        origin,
        storageTypes: 'all',
      })
      if (!requestIsCurrent(request.epoch)) return
      await refreshPageStorage()
      if (!requestIsCurrent(request.epoch)) return
      setStatus(copy.clearedSiteStorage(origin))
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.clearSiteStorageFailed}: ${String(error)}`)
      }
    }
  }

  const dateLocale = locale === 'tr' ? 'tr-TR' : 'en-US'

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
    { id: 'overview', label: copy.overview },
    { id: 'elements', label: copy.elements },
    { id: 'console', label: copy.console, badge: consoleErrorCount || undefined },
    { id: 'network', label: copy.network, badge: failedRequestCount || undefined },
    { id: 'performance', label: copy.performance },
    { id: 'storage', label: copy.storage },
    { id: 'site', label: copy.site },
    { id: 'events', label: copy.events },
  ]

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section ref={dialogRef} className={styles.panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={copy.titleAria}>
        <header className={styles.header}>
          <div>
            <div className={styles.title}>{copy.inspector}</div>
            <div className={styles.subtitle}>
              {activeLabel ?? copy.noActiveWebview} · {activeUrl ?? copy.noActiveUrl}
            </div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label={copy.closeAria} title={copy.closeTitle}>
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
              <div className={styles.emptyState}>{copy.openTabHint}</div>
            ) : null}

            {section === 'overview' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>{copy.overview}</h2><p>{copy.overviewLead}</p></div>
                  <button type="button" className={styles.secondaryButton} onClick={() => void refreshOverview()}>{copy.refresh}</button>
                </div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>{copy.activeTab}</span><strong>{activeTabId}</strong></div>
                  <div className={styles.metricCard}><span>{copy.openTabs}</span><strong>{openTabIds.length}</strong></div>
                  <div className={styles.metricCard}><span>{copy.memoryPressure}</span><strong>{memoryPressure === null ? '—' : `${memoryPressure}%`}</strong></div>
                  <div className={styles.metricCard}><span>{copy.audio}</span><strong>{playingAudio === null ? '—' : playingAudio ? copy.playing : copy.silent}</strong></div>
                  <div className={styles.metricCard}><span>{copy.security}</span><strong>{localizeTechnicalState(locale, securityState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.consoleErrors}</span><strong>{consoleErrorCount}</strong></div>
                  <div className={styles.metricCard}><span>{copy.requests}</span><strong>{networkEntries.length}</strong></div>
                  <div className={styles.metricCard}><span>{copy.failedRequests}</span><strong>{failedRequestCount}</strong></div>
                </div>
                <div className={styles.urlCard}><span>{copy.currentUrl}</span><code>{activeUrl ?? '—'}</code></div>
                <div className={styles.actionGrid}>
                  <button type="button" className={styles.actionButton} onClick={() => void runBrowserAction(copy.reload, () => reloadBrowseTab(activeTabId))}><strong>{copy.reload}</strong><span>{copy.reloadHint}</span></button>
                  <button type="button" className={styles.actionButton} onClick={() => void runBrowserAction(copy.clearCache, () => clearBrowseData(activeTabId, 'cache'))}><strong>{copy.clearCache}</strong><span>{copy.clearCacheHint}</span></button>
                  <button type="button" className={styles.actionButton} onClick={() => { setConsoleEntries([]); setNetworkEntries([]); setRawEvents([]); setStatus(copy.buffersCleared) }}><strong>{copy.clearBuffers}</strong><span>{copy.clearBuffersHint}</span></button>
                </div>
                <pre className={styles.debugOutput}>{JSON.stringify({ environment: import.meta.env.MODE, tauri: isTauri, openedFrom: sourceViewMode, userAgent: navigator.userAgent }, null, 2)}</pre>
              </div>
            )}

            {section === 'elements' && activeTabId && (
              <div className={styles.splitSection}>
                <div className={styles.splitPane}>
                  <div className={styles.paneToolbar}>
                    <strong>{copy.dom}</strong>
                    <button type="button" className={styles.smallButton} onClick={() => void refreshDom()}>{loadingDom ? copy.loading : copy.refresh}</button>
                  </div>
                  <div className={styles.domTree}>
                    {domRoot ? <DomTreeNode node={domRoot} depth={0} selectedNodeId={selectedNode?.node.nodeId ?? null} onSelect={(node) => void selectDomNode(node)} /> : <div className={styles.emptyState}>{copy.noDom}</div>}
                  </div>
                </div>
                <div className={styles.splitPane}>
                  <div className={styles.paneToolbar}><strong>{copy.nodeDetails}</strong>{selectedNode && <button type="button" className={styles.smallButton} onClick={() => { void callTabDevTools(activeTabId, 'Overlay.hideHighlight'); setSelectedNode(null) }}>{copy.clearHighlight}</button>}</div>
                  {selectedNode ? (
                    <div className={styles.nodeInspector}>
                      <label>{copy.outerHtml}</label>
                      <pre className={styles.codeBlock}>{selectedNode.outerHtml}</pre>
                      <div className={styles.filterRow}><input value={styleFilter} onChange={(event) => setStyleFilter(event.target.value)} placeholder={copy.filterStyles} /></div>
                      <div className={styles.styleList}>
                        {filteredStyles.map((item) => <div key={`${item.name}-${item.value}`} className={styles.styleRow}><span>{item.name}</span><code>{item.value}</code></div>)}
                      </div>
                    </div>
                  ) : <div className={styles.emptyState}>{copy.selectNode}</div>}
                </div>
              </div>
            )}

            {section === 'console' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}>
                  <div className={styles.filterRow}><input value={consoleFilter} onChange={(event) => setConsoleFilter(event.target.value)} placeholder={copy.filterConsole} /></div>
                  <button type="button" className={styles.smallButton} onClick={() => setConsoleEntries([])}>{copy.clear}</button>
                </div>
                <div className={styles.consoleList}>
                  {filteredConsole.map((entry) => (
                    <div key={entry.id} className={`${styles.consoleRow} ${entry.level === 'error' ? styles.consoleError : entry.level === 'warning' || entry.level === 'warn' ? styles.consoleWarn : ''}`}>
                      <span className={styles.consoleLevel}>{localizeTechnicalState(locale, entry.level)}</span>
                      <span className={styles.consoleText}>{entry.text}</span>
                      <span className={styles.consoleTime}>{new Date(entry.time).toLocaleTimeString(dateLocale)}</span>
                    </div>
                  ))}
                  {filteredConsole.length === 0 && <div className={styles.emptyState}>{copy.consoleQuiet}</div>}
                </div>
                <div className={styles.consolePrompt}>
                  <span>›</span>
                  <input ref={consoleInputRef} value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runConsoleCommand() }} placeholder={copy.evalPlaceholder} />
                  <button type="button" className={styles.smallButton} onClick={() => void runConsoleCommand()}>{copy.run}</button>
                </div>
              </div>
            )}

            {section === 'network' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}>
                  <div className={styles.filterRow}><input value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value)} placeholder={copy.filterNetwork} /></div>
                  <span className={styles.toolbarStat}>{networkEntries.length} {copy.requests.toLocaleLowerCase(locale)} · {failedRequestCount} {copy.failed}</span>
                  <button type="button" className={styles.smallButton} onClick={() => setNetworkEntries([])}>{copy.clear}</button>
                </div>
                <div className={styles.networkTable}>
                  <div className={styles.networkHead}><span>{copy.status}</span><span>{copy.method}</span><span>{copy.type}</span><span>URL</span><span>{copy.time}</span><span>{copy.size}</span></div>
                  {filteredNetwork.map((entry) => (
                    <div key={entry.requestId} className={`${styles.networkRow} ${entry.failed || (entry.status ?? 0) >= 400 ? styles.networkFailed : ''}`} title={entry.errorText ?? entry.url}>
                      <span>{entry.failed ? 'ERR' : entry.status ?? '…'}</span><span>{entry.method}</span><span>{entry.type ?? copy.other}</span><code>{entry.url}</code><span>{entry.durationMs === undefined ? '—' : `${entry.durationMs.toFixed(0)} ms`}</span><span>{formatBytes(entry.encodedDataLength)}</span>
                    </div>
                  ))}
                  {filteredNetwork.length === 0 && <div className={styles.emptyState}>{copy.noRequests}</div>}
                </div>
              </div>
            )}

            {section === 'performance' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>{copy.performance}</h2><p>{copy.performanceLead}</p></div><button type="button" className={styles.secondaryButton} onClick={() => void refreshPerformance()}>{copy.refresh}</button></div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>{copy.heapUsed}</span><strong>{heapUsed === null ? '—' : formatBytes(heapUsed)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.heapTotal}</span><strong>{heapTotal === null ? '—' : formatBytes(heapTotal)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.memoryPressure}</span><strong>{memoryPressure === null ? '—' : `${memoryPressure}%`}</strong></div>
                  <div className={styles.metricCard}><span>{copy.capturedMetrics}</span><strong>{performanceMetrics.length}</strong></div>
                </div>
                <div className={styles.metricList}>{performanceMetrics.map((metric) => <div key={metric.name} className={styles.metricRow}><span>{metric.name}</span><code>{formatMetric(metric)}</code></div>)}</div>
              </div>
            )}

            {section === 'storage' && (
              <div className={styles.storageColumns}>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}><div><h2>{copy.nebulaStorage}</h2><p>{copy.nebulaStorageLead}</p></div><button type="button" className={styles.secondaryButton} onClick={refreshStorage}>{copy.refresh}</button></div>
                  <div className={styles.actionGrid}>
                    <button type="button" className={styles.actionButton} onClick={() => clearStorageKey(SHORTCUT_FOLDERS_KEY)}><strong>{copy.clearFolderCache}</strong><span>{SHORTCUT_FOLDERS_KEY}</span></button>
                    <button type="button" className={styles.actionButton} onClick={() => clearStorageKey(SHORTCUT_POSITIONS_KEY)}><strong>{copy.clearLayout}</strong><span>{SHORTCUT_POSITIONS_KEY}</span></button>
                  </div>
                  <div className={styles.storageList}>{nebulaStorageEntries.map((entry) => <details key={entry.key} className={styles.storageEntry}><summary><span>{entry.key}</span><button type="button" onClick={(event) => { event.preventDefault(); clearStorageKey(entry.key) }}>{copy.delete}</button></summary><pre>{prettyStorageValue(entry.value, copy.empty)}</pre></details>)}{nebulaStorageEntries.length === 0 && <div className={styles.emptyState}>{copy.noNebulaStorage}</div>}</div>
                </div>
                <div className={styles.section}>
                  <div className={styles.sectionHeader}><div><h2>{copy.pageStorage}</h2><p>{copy.pageStorageLead}</p></div><button type="button" className={styles.secondaryButton} disabled={!activeTabId} onClick={() => void refreshPageStorage()}>{copy.refresh}</button></div>
                  {pageStorage ? <><h3 className={styles.subheading}>localStorage</h3><pre className={styles.debugOutput}>{JSON.stringify(pageStorage.localStorage, null, 2)}</pre><h3 className={styles.subheading}>sessionStorage</h3><pre className={styles.debugOutput}>{JSON.stringify(pageStorage.sessionStorage, null, 2)}</pre></> : <div className={styles.emptyState}>{copy.noPageStorage}</div>}
                  <h3 className={styles.subheading}>{copy.cookies} ({cookies.length})</h3>
                  <div className={styles.cookieList}>{cookies.map((cookie) => <div key={`${cookie.domain}-${cookie.path}-${cookie.name}`} className={styles.cookieRow}><strong>{cookie.name}</strong><span>{cookie.domain}{cookie.path}</span><small>{cookie.httpOnly ? 'HttpOnly · ' : ''}{cookie.secure ? 'Secure · ' : ''}{cookie.sameSite ?? copy.unspecified}</small></div>)}</div>
                  <button type="button" className={styles.dangerButton} disabled={!activeTabId || !activeUrl} onClick={() => void clearCurrentOriginStorage()}><strong>{copy.clearCurrentSite}</strong><span>{copy.clearCurrentSiteHint}</span></button>
                </div>
              </div>
            )}

            {section === 'site' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>{copy.site}</h2><p>{copy.siteLead}</p></div><button type="button" className={styles.secondaryButton} onClick={() => void refreshPageInfo()}>{copy.refresh}</button></div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>{copy.security}</span><strong>{localizeTechnicalState(locale, securityState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.readyState}</span><strong>{localizeTechnicalState(locale, pageInfo?.readyState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.visibility}</span><strong>{localizeTechnicalState(locale, pageInfo?.visibilityState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.online}</span><strong>{pageInfo?.online === undefined ? '—' : pageInfo.online ? copy.yes : copy.no}</strong></div>
                  <div className={styles.metricCard}><span>{copy.cookies}</span><strong>{pageInfo?.cookieEnabled === undefined ? '—' : pageInfo.cookieEnabled ? copy.enabled : copy.disabled}</strong></div>
                  <div className={styles.metricCard}><span>{copy.historyLength}</span><strong>{pageInfo?.historyLength ?? '—'}</strong></div>
                </div>
                <div className={styles.infoList}>
                  <div><span>{copy.title}</span><code>{pageInfo?.title ?? '—'}</code></div><div><span>{copy.origin}</span><code>{pageInfo?.origin ?? '—'}</code></div><div><span>{copy.language}</span><code>{pageInfo?.language ?? '—'}</code></div><div><span>{copy.charset}</span><code>{pageInfo?.charset ?? '—'}</code></div><div><span>{copy.referrer}</span><code>{pageInfo?.referrer || '—'}</code></div><div><span>{copy.viewport}</span><code>{pageInfo?.viewport ? `${pageInfo.viewport.width ?? '?'} × ${pageInfo.viewport.height ?? '?'} @ ${pageInfo.devicePixelRatio ?? 1}x` : '—'}</code></div>
                </div>
                <h3 className={styles.subheading}>{copy.permissions}</h3>
                <div className={styles.permissionGrid}>{Object.entries(pageInfo?.permissions ?? {}).map(([name, state]) => <div key={name} className={styles.permissionCard}><span>{name}</span><strong>{localizeTechnicalState(locale, state)}</strong></div>)}</div>
              </div>
            )}

            {section === 'events' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}><div className={styles.filterRow}><input value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} placeholder={copy.filterEvents} /></div><span className={styles.toolbarStat}>{rawEvents.length} {copy.buffered}</span><button type="button" className={styles.smallButton} onClick={() => setRawEvents([])}>{copy.clear}</button></div>
                <div className={styles.eventList}>{filteredEvents.map((event, index) => <details key={`${event.timestampMs}-${event.event}-${index}`} className={styles.eventEntry}><summary><span>{event.event}</span><time>{new Date(event.timestampMs).toLocaleTimeString(dateLocale)}</time></summary><pre>{JSON.stringify(safeJson(event.paramsJson), null, 2)}</pre></details>)}{filteredEvents.length === 0 && <div className={styles.emptyState}>{copy.noEvents}</div>}</div>
              </div>
            )}
          </main>
        </div>

        <footer className={styles.footer}>
          <span>{copy.closeFooter}</span>
          <span className={styles.status}>{status ?? (activeTabId ? copy.cdpInspector : copy.waitingTab)}</span>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
