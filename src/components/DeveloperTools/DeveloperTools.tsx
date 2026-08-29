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
  subscribeTabDevTools,
  type NebulaDevToolsEvent,
  unsubscribeTabDevTools,
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
  | 'sources'
  | 'accessibility'
  | 'events'

type SourceViewMode = 'home' | 'browsing' | 'overlay'

type JsonRecord = Record<string, unknown>

interface DeveloperToolsProps {
  activeTabId: string | null
  activeUrl: string | null
  openTabIds: string[]
  sourceViewMode: SourceViewMode
  privacyState: {
    strictCookies: boolean
    trackingLevel: 'none' | 'balanced' | 'strict'
    blockTrackers: boolean
  }
  inspectRequest?: {
    x: number
    y: number
    token: number
  } | null
  onInspectRequestHandled?: () => void
  onElementPickerModeChange?: (active: boolean) => void
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
  lineNumber?: number
  columnNumber?: number
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
  blockedReason?: string
  fromDiskCache?: boolean
  requestHeaders?: JsonRecord
  responseHeaders?: JsonRecord
  postData?: string
  initiator?: JsonRecord
  remoteIPAddress?: string
  remotePort?: number
  securityDetails?: JsonRecord
}

interface NetworkBody {
  requestId: string
  body: string
  base64Encoded: boolean
  error?: string
}

interface PerformanceMetric {
  name: string
  value: number
}

interface PageStorageSnapshot {
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
  cacheNames: string[]
  indexedDbNames: string[]
  serviceWorkers: Array<{
    scope: string
    active: boolean
  }>
}

interface CookieMetadata {
  name: string
  value?: string
  domain: string
  path: string
  expires?: number
  size?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
  session?: boolean
}

interface ScriptEntry {
  scriptId: string
  url: string
  length?: number
  hash?: string
  isModule?: boolean
}

interface AccessibilityNode {
  nodeId: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  description?: { value?: string }
  backendDOMNodeId?: number
}

interface PerformanceSummary {
  domNodes: number
  resourceCount: number
  transferBytes: number
  decodedBodyBytes: number
  navigation: Record<string, number>
  paints: Array<{ name: string; startTime: number }>
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
  protocol?: string
  secureContext?: boolean
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
const RAW_EVENT_SUPPRESSIONS = new Set([
  // Debugger.enable emits one event per already-parsed script. Sources owns
  // this inventory; keeping hundreds of copies in Events evicts useful input.
  'Debugger.scriptParsed',
])

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
    inspectorAttached: 'Inspector bağlandı · canlı olaylar etkin.',
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
    sources: 'Kaynaklar',
    accessibility: 'Erişilebilirlik',
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
    blockedRequests: 'Engellenen istekler',
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
    inspectElement: 'Sayfadan öğe seç',
    stopInspecting: 'Seçimi durdur',
    inspectHint: 'Sayfanın üstüne gel ve incelemek istediğin öğeye tıkla.',
    outerHtml: 'Dış HTML',
    editHtml: 'HTML düzenle',
    apply: 'Uygula',
    cancel: 'İptal',
    copy: 'Kopyala',
    attributeName: 'Özellik adı',
    attributeValue: 'Özellik değeri',
    setAttribute: 'Ekle / güncelle',
    removeAttribute: 'Kaldır',
    searchDom: 'CSS selector, XPath veya metin ara…',
    search: 'Ara',
    previousMatch: 'Önceki',
    nextMatch: 'Sonraki',
    noMatches: 'Eşleşme yok',
    filterStyles: 'Hesaplanan stilleri filtrele…',
    computedStyles: 'Hesaplanan stiller',
    selectNode: 'HTML ve hesaplanan stilleri incelemek için bir DOM düğümü seç.',
    filterConsole: 'Konsolu filtrele…',
    clear: 'Temizle',
    consoleQuiet: 'Konsol sessiz.',
    evalPlaceholder: 'Aktif sayfada JavaScript değerlendir…',
    run: 'Çalıştır',
    filterNetwork: 'URL, yöntem, durum, tür filtrele…',
    failed: 'başarısız',
    blocked: 'engellendi',
    status: 'Durum',
    method: 'Yöntem',
    type: 'Tür',
    time: 'Süre',
    size: 'Boyut',
    other: 'Diğer',
    noRequests: 'Inspector açıldığından beri istek yakalanmadı.',
    recording: 'Kayıt',
    preserveLog: 'Günlüğü koru',
    disableCache: 'Önbelleği devre dışı bırak',
    requestDetails: 'İstek ayrıntıları',
    headers: 'Başlıklar',
    payload: 'İstek gövdesi',
    response: 'Yanıt',
    preview: 'Önizleme',
    copyUrl: 'URL’yi kopyala',
    copyCurl: 'cURL olarak kopyala',
    noResponseBody: 'Yanıt gövdesi yok veya henüz hazır değil.',
    performanceLead: 'CDP performans sayaçları ve V8 heap kullanımı.',
    heapUsed: 'Kullanılan JS heap',
    heapTotal: 'Toplam JS heap',
    capturedMetrics: 'Yakalanan metrikler',
    pageDomNodes: 'Sayfa DOM düğümleri',
    resourceTimingEntries: 'Resource Timing kayıtları',
    resourceTimingTransfer: 'Resource Timing aktarımı',
    resourceTimingDecoded: 'Resource Timing çözülen veri',
    autoRefresh: 'Otomatik yenile',
    pageSummary: 'Sayfa özeti',
    nebulaStorage: 'Nebula depolaması',
    nebulaStorageLead: 'Tarayıcı kabuğunun localStorage durumu.',
    clearFolderCache: 'Klasör önbelleğini temizle',
    clearLayout: 'Yerleşimi temizle',
    delete: 'Sil',
    noNebulaStorage: 'Nebula localStorage kaydı yok.',
    pageStorage: 'Sayfa depolaması',
    pageStorageLead: 'Aktif sitenin local/session storage ve çerez meta verileri.',
    noPageStorage: 'Sayfa depolama anlık görüntüsü yok.',
    storageArea: 'Alan',
    storageKey: 'Anahtar',
    storageValue: 'Değer',
    setStorageValue: 'Kaydet',
    cacheStorage: 'Cache Storage',
    indexedDb: 'IndexedDB',
    serviceWorkers: 'Service Worker’lar',
    deleteCookie: 'Çerezi sil',
    cookieValue: 'Çerez değeri',
    showCookieValue: 'Değeri göster',
    hideCookieValue: 'Değeri gizle',
    unspecified: 'Belirtilmemiş',
    clearCurrentSite: 'Geçerli site verilerini temizle',
    clearCurrentSiteHint: 'Geçerli origin için çerez, depolama ve önbellek verileri',
    siteLead: 'Sayfa kimliği, güvenlik ve izin durumu.',
    readyState: 'Hazır olma durumu',
    visibility: 'Görünürlük',
    online: 'Çevrimiçi',
    cookies: 'Çerezler',
    cookieApi: 'Cookie API',
    cookieApiAvailable: 'Kullanılabilir',
    cookieApiUnavailable: 'Kullanılamıyor',
    siteCookies: 'Site çerezleri',
    nebulaCookiePolicy: 'Nebula siteler arası çerez politikası',
    strictPolicy: 'Sıkı · çerez gönderimi engelli',
    standardPolicy: 'Standart · ek Nebula filtresi yok',
    trackingPrevention: 'İzleme koruması',
    trackerBlocking: 'İzleyici engelleme',
    trackingNone: 'Kapalı',
    trackingBalanced: 'Dengeli',
    trackingStrict: 'Sıkı',
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
    filterSources: 'Script URL’si ara…',
    showAnonymousSources: 'Anonim scriptleri göster',
    anonymousScripts: 'Anonim scriptler',
    inlineScripts: 'Satır içi / sanal scriptler',
    noSources: 'Henüz script yakalanmadı.',
    noSourceMatches: 'Filtre ve görünürlük ayarlarına uyan script yok.',
    selectSource: 'Kaynak kodunu görmek için soldan bir script seç.',
    sourceCode: 'Kaynak kodu',
    accessibilityLead: 'Aktif sayfanın erişilebilirlik ağacı ve DOM eşleşmeleri.',
    filterAccessibility: 'Rol, ad, açıklama veya DOM kimliği ara…',
    showAccessibilityNoise: 'Atlanan ve boş düğümleri göster',
    noAccessibility: 'Erişilebilirlik düğümü bulunamadı.',
    noAccessibilityMatches: 'Filtreye uyan erişilebilirlik düğümü yok.',
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
    inspectorAttached: 'Inspector attached · live events enabled.', inspectorAttachFailed: 'Inspector attach failed', evaluationFailed: 'Evaluation failed', actionProgress: (label: string) => `${label}…`, actionComplete: (label: string) => `${label} complete.`, actionFailed: (label: string) => `${label} failed`, clearedSiteStorage: (origin: string) => `Cleared site storage for ${origin}.`, clearSiteStorageFailed: 'Clear site storage failed',
    titleAria: 'Nebula Developer Tools', inspector: 'Nebula Inspector', noActiveWebview: 'No active WebView', noActiveUrl: 'No active URL', closeAria: 'Close developer tools', closeTitle: 'Close (F12 / Esc)',
    overview: 'Overview', elements: 'Elements', console: 'Console', network: 'Network', performance: 'Performance', storage: 'Storage', site: 'Site', sources: 'Sources', accessibility: 'Accessibility', events: 'Events', openTabHint: 'Open a browser tab to attach the Nebula inspector.', overviewLead: 'Live state for the active native WebView.', refresh: 'Refresh',
    activeTab: 'Active tab', openTabs: 'Open tabs', memoryPressure: 'Memory pressure', audio: 'Audio', playing: 'Playing', silent: 'Silent', security: 'Security', consoleErrors: 'Console errors', requests: 'Requests', failedRequests: 'Failed requests', blockedRequests: 'Blocked requests', currentUrl: 'Current URL', reload: 'Reload', reloadHint: 'Reload active WebView', clearCache: 'Clear cache', clearCacheHint: 'Clear active tab cache', clearBuffers: 'Clear inspector buffers', clearBuffersHint: 'Console, network and event history', buffersCleared: 'Inspector buffers cleared.',
    dom: 'DOM', loading: 'Loading…', noDom: 'No DOM snapshot yet.', nodeDetails: 'Node details', clearHighlight: 'Clear highlight', inspectElement: 'Select element from page', stopInspecting: 'Stop selecting', inspectHint: 'Hover the page and click the element you want to inspect.', outerHtml: 'Outer HTML', editHtml: 'Edit HTML', apply: 'Apply', cancel: 'Cancel', copy: 'Copy', attributeName: 'Attribute name', attributeValue: 'Attribute value', setAttribute: 'Add / update', removeAttribute: 'Remove', searchDom: 'Search CSS selector, XPath or text…', search: 'Search', previousMatch: 'Previous', nextMatch: 'Next', noMatches: 'No matches', filterStyles: 'Filter computed styles…', computedStyles: 'Computed styles', selectNode: 'Select a DOM node to inspect HTML and computed styles.', filterConsole: 'Filter console…', clear: 'Clear', consoleQuiet: 'Console is quiet.', evalPlaceholder: 'Evaluate JavaScript in the active page…', run: 'Run', filterNetwork: 'Filter URL, method, status, type…', failed: 'failed', blocked: 'blocked', status: 'Status', method: 'Method', type: 'Type', time: 'Time', size: 'Size', other: 'Other', noRequests: 'No requests captured since the inspector opened.', recording: 'Recording', preserveLog: 'Preserve log', disableCache: 'Disable cache', requestDetails: 'Request details', headers: 'Headers', payload: 'Request payload', response: 'Response', preview: 'Preview', copyUrl: 'Copy URL', copyCurl: 'Copy as cURL', noResponseBody: 'No response body or it is not ready yet.',
    performanceLead: 'CDP performance counters and V8 heap usage.', heapUsed: 'JS heap used', heapTotal: 'JS heap total', capturedMetrics: 'Captured metrics', pageDomNodes: 'Page DOM nodes', resourceTimingEntries: 'Resource Timing entries', resourceTimingTransfer: 'Resource Timing transfer', resourceTimingDecoded: 'Resource Timing decoded body', autoRefresh: 'Auto refresh', pageSummary: 'Page summary', nebulaStorage: 'Nebula storage', nebulaStorageLead: 'Browser shell localStorage state.', clearFolderCache: 'Clear folder cache', clearLayout: 'Clear layout', delete: 'Delete', noNebulaStorage: 'No Nebula localStorage entries.', pageStorage: 'Page storage', pageStorageLead: "Active site's local/session storage and cookie metadata.", noPageStorage: 'No page storage snapshot.', storageArea: 'Area', storageKey: 'Key', storageValue: 'Value', setStorageValue: 'Save', cacheStorage: 'Cache Storage', indexedDb: 'IndexedDB', serviceWorkers: 'Service Workers', deleteCookie: 'Delete cookie', cookieValue: 'Cookie value', showCookieValue: 'Show value', hideCookieValue: 'Hide value', unspecified: 'Unspecified', clearCurrentSite: 'Clear current site data', clearCurrentSiteHint: 'Cookies, storage, cache data for the current origin',
    siteLead: 'Page identity, security and permission state.', readyState: 'Ready state', visibility: 'Visibility', online: 'Online', cookies: 'Cookies', cookieApi: 'Cookie API', cookieApiAvailable: 'Available', cookieApiUnavailable: 'Unavailable', siteCookies: 'Site cookies', nebulaCookiePolicy: 'Nebula cross-site cookie policy', strictPolicy: 'Strict · cookie sending blocked', standardPolicy: 'Standard · no extra Nebula filter', trackingPrevention: 'Tracking prevention', trackerBlocking: 'Tracker blocking', trackingNone: 'Off', trackingBalanced: 'Balanced', trackingStrict: 'Strict', historyLength: 'History length', yes: 'Yes', no: 'No', enabled: 'Enabled', disabled: 'Disabled', title: 'Title', origin: 'Origin', language: 'Language', charset: 'Charset', referrer: 'Referrer', viewport: 'Viewport', permissions: 'Permissions', filterSources: 'Filter script URLs…', showAnonymousSources: 'Show anonymous scripts', anonymousScripts: 'Anonymous scripts', inlineScripts: 'Inline / virtual scripts', noSources: 'No scripts captured yet.', noSourceMatches: 'No scripts match the filter and visibility settings.', selectSource: 'Select a script on the left to view its source.', sourceCode: 'Source code', accessibilityLead: 'Accessibility tree and DOM matches for the active page.', filterAccessibility: 'Filter by role, name, description or DOM id…', showAccessibilityNoise: 'Show ignored and empty nodes', noAccessibility: 'No accessibility nodes found.', noAccessibilityMatches: 'No accessibility nodes match the filter.', filterEvents: 'Filter CDP events…', buffered: 'buffered', noEvents: 'No matching CDP event.', closeFooter: 'F12 / Esc to close', cdpInspector: 'CDP-backed Nebula inspector', waitingTab: 'Waiting for a tab',
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
    blocked: 'Engellendi',
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
    blocked: 'Blocked',
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

function isClientBlockedNetworkEntry(entry: NetworkEntry): boolean {
  return Boolean(entry.blockedReason) ||
    entry.errorText?.toUpperCase().includes('ERR_BLOCKED_BY_CLIENT') === true
}

function isFailedNetworkEntry(entry: NetworkEntry): boolean {
  return !isClientBlockedNetworkEntry(entry) &&
    (entry.failed === true || (entry.status ?? 0) >= 400)
}

function isClientBlockedConsoleEntry(entry: ConsoleEntry): boolean {
  return entry.text.toUpperCase().includes('ERR_BLOCKED_BY_CLIENT')
}

function consoleDisplayLevel(entry: ConsoleEntry): string {
  return isClientBlockedConsoleEntry(entry) ? 'blocked' : entry.level
}

function isAnonymousSource(entry: ScriptEntry): boolean {
  return entry.url.startsWith('(anonymous script ')
}

function sourceGroupLabel(
  entry: ScriptEntry,
  anonymousLabel: string,
  inlineLabel: string,
): string {
  if (isAnonymousSource(entry)) return anonymousLabel
  try {
    const parsed = new URL(entry.url)
    return parsed.origin === 'null' ? `${inlineLabel} · ${parsed.protocol}` : parsed.origin
  } catch {
    return inlineLabel
  }
}

function isAccessibilityNoise(node: AccessibilityNode): boolean {
  if (node.ignored) return true
  const role = node.role?.value?.trim().toLowerCase() ?? ''
  const hasText = Boolean(node.name?.value?.trim() || node.description?.value?.trim())
  return !hasText && (!role || role === 'generic' || role === 'none')
}

function cookieIdentity(cookie: CookieMetadata): string {
  return `${cookie.domain}\n${cookie.path}\n${cookie.name}`
}

function headersText(headers: JsonRecord | undefined): string {
  if (!headers) return '—'
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join('\n') || '—'
}

function curlForRequest(entry: NetworkEntry): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const parts = [`curl ${quote(entry.url)}`]
  if (entry.method && entry.method !== 'GET') parts.push(`-X ${entry.method}`)
  for (const [name, value] of Object.entries(entry.requestHeaders ?? {})) {
    parts.push(`-H ${quote(`${name}: ${String(value)}`)}`)
  }
  if (entry.postData) parts.push(`--data-raw ${quote(entry.postData)}`)
  return parts.join(' \\\n  ')
}

function consoleSourceLabel(entry: ConsoleEntry): string {
  if (!entry.url) return entry.source
  let source = entry.url
  try {
    const url = new URL(entry.url)
    const path = url.pathname.split('/').filter(Boolean).at(-1)
    source = `${url.hostname}/${path || ''}`.replace(/\/$/, '')
  } catch {
    // Keep non-URL sources such as VM identifiers readable as-is.
  }
  const line = entry.lineNumber === undefined ? '' : `:${entry.lineNumber + 1}`
  const column = entry.columnNumber === undefined ? '' : `:${entry.columnNumber + 1}`
  return `${source}${line}${column}`
}

export function DeveloperTools({
  activeTabId,
  activeUrl,
  openTabIds,
  sourceViewMode,
  privacyState,
  inspectRequest = null,
  onInspectRequestHandled,
  onElementPickerModeChange,
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
  const [selectedNetworkRequestId, setSelectedNetworkRequestId] = useState<string | null>(null)
  const [networkBody, setNetworkBody] = useState<NetworkBody | null>(null)
  const [networkRecording, setNetworkRecording] = useState(true)
  const [preserveConsoleLog, setPreserveConsoleLog] = useState(false)
  const [preserveNetworkLog, setPreserveNetworkLog] = useState(false)
  const [cacheDisabled, setCacheDisabled] = useState(false)
  const [rawEvents, setRawEvents] = useState<NebulaDevToolsEvent[]>([])
  const [securityState, setSecurityState] = useState('unknown')
  const [memoryPressure, setMemoryPressure] = useState<number | null>(null)
  const [playingAudio, setPlayingAudio] = useState<boolean | null>(null)
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetric[]>([])
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null)
  const [performanceAutoRefresh, setPerformanceAutoRefresh] = useState(false)
  const [heapUsed, setHeapUsed] = useState<number | null>(null)
  const [heapTotal, setHeapTotal] = useState<number | null>(null)
  const [domRoot, setDomRoot] = useState<CdpDomNode | null>(null)
  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null)
  const [elementPickerActive, setElementPickerActive] = useState(false)
  const [pendingBackendNodeId, setPendingBackendNodeId] = useState<number | null>(null)
  const [domSearch, setDomSearch] = useState('')
  const [domSearchNodeIds, setDomSearchNodeIds] = useState<number[]>([])
  const [domSearchIndex, setDomSearchIndex] = useState(-1)
  const [editingOuterHtml, setEditingOuterHtml] = useState(false)
  const [editableOuterHtml, setEditableOuterHtml] = useState('')
  const [attributeName, setAttributeName] = useState('')
  const [attributeValue, setAttributeValue] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [consoleFilter, setConsoleFilter] = useState('')
  const [networkFilter, setNetworkFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [consoleCommand, setConsoleCommand] = useState('')
  const [consoleLevelFilter, setConsoleLevelFilter] = useState('all')
  const [pageStorage, setPageStorage] = useState<PageStorageSnapshot | null>(null)
  const [cookies, setCookies] = useState<CookieMetadata[]>([])
  const [revealedCookieIds, setRevealedCookieIds] = useState<Set<string>>(() => new Set())
  const [storageArea, setStorageArea] = useState<'localStorage' | 'sessionStorage'>('localStorage')
  const [storageKey, setStorageKey] = useState('')
  const [storageValue, setStorageValue] = useState('')
  const [sourceEntries, setSourceEntries] = useState<ScriptEntry[]>([])
  const [sourceFilter, setSourceFilter] = useState('')
  const [showAnonymousSources, setShowAnonymousSources] = useState(false)
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null)
  const [scriptSource, setScriptSource] = useState('')
  const [accessibilityNodes, setAccessibilityNodes] = useState<AccessibilityNode[]>([])
  const [accessibilityFilter, setAccessibilityFilter] = useState('')
  const [showAccessibilityNoise, setShowAccessibilityNoise] = useState(false)
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [loadingDom, setLoadingDom] = useState(false)
  const [inspectorReady, setInspectorReady] = useState(false)
  const consoleInputRef = useRef<HTMLInputElement>(null)
  const consoleHistoryRef = useRef<string[]>([])
  const consoleHistoryIndexRef = useRef(-1)
  const domSearchIdRef = useRef<string | null>(null)
  const sourceRequestIdRef = useRef(0)
  const networkRecordingRef = useRef(networkRecording)
  const preserveConsoleLogRef = useRef(preserveConsoleLog)
  const preserveNetworkLogRef = useRef(preserveNetworkLog)
  networkRecordingRef.current = networkRecording
  preserveConsoleLogRef.current = preserveConsoleLog
  preserveNetworkLogRef.current = preserveNetworkLog
  const requestEpochRef = useRef(new RequestEpoch<string | null>(activeTabId))

  const selectSection = useCallback((nextSection: DeveloperToolsSection) => {
    setSection(nextSection)
    setStatus(null)
  }, [])
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
    if (!RAW_EVENT_SUPPRESSIONS.has(event.event)) {
      setRawEvents((events) => [event, ...events].slice(0, MAX_EVENTS))
    }
    const params = safeJson(event.paramsJson)

    if (event.event === 'Overlay.inspectNodeRequested') {
      const backendNodeId = params.backendNodeId
      if (typeof backendNodeId === 'number') {
        setElementPickerActive(false)
        onElementPickerModeChange?.(false)
        selectSection('elements')
        setPendingBackendNodeId(backendNodeId)
      }
      return
    }

    if (event.event === 'DOM.documentUpdated') {
      setDomRoot(null)
      setSelectedNode(null)
      return
    }

    if (event.event === 'Debugger.scriptParsed') {
      const scriptId = typeof params.scriptId === 'string' ? params.scriptId : ''
      if (!scriptId) return
      const url = typeof params.url === 'string' && params.url
        ? params.url
        : `(anonymous script ${scriptId})`
      setSourceEntries((items) => {
        const next: ScriptEntry = {
          scriptId,
          url,
          length: typeof params.length === 'number' ? params.length : undefined,
          hash: typeof params.hash === 'string' ? params.hash : undefined,
          isModule: params.isModule === true,
        }
        const index = items.findIndex((item) => item.scriptId === scriptId)
        if (index < 0) return [...items, next].slice(-800)
        const updated = items.slice()
        updated[index] = next
        return updated
      })
      return
    }

    if (event.event === 'Page.frameNavigated') {
      const frame = nestedRecord(params.frame)
      if (typeof frame.parentId === 'string' && frame.parentId) return
      if (!preserveConsoleLogRef.current) setConsoleEntries([])
      if (!preserveNetworkLogRef.current) {
        const frameUrl = typeof frame.url === 'string' ? frame.url : ''
        setNetworkEntries((items) => items.filter((item) => item.type === 'Document' && item.url === frameUrl))
        setSelectedNetworkRequestId(null)
        setNetworkBody(null)
      }
      setDomRoot(null)
      setSelectedNode(null)
      return
    }

    if (event.event === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(params.args) ? params.args : []
      const stackTrace = nestedRecord(params.stackTrace)
      const callFrames = Array.isArray(stackTrace.callFrames) ? stackTrace.callFrames : []
      const frame = nestedRecord(callFrames[0])
      addConsoleEntry({
        time: event.timestampMs,
        level: typeof params.type === 'string' ? params.type : 'log',
        text: args.map(remoteObjectText).join(' '),
        source: 'console',
        url: typeof frame.url === 'string' ? frame.url : undefined,
        lineNumber: typeof frame.lineNumber === 'number' ? frame.lineNumber : undefined,
        columnNumber: typeof frame.columnNumber === 'number' ? frame.columnNumber : undefined,
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
        lineNumber: typeof details.lineNumber === 'number' ? details.lineNumber : undefined,
        columnNumber: typeof details.columnNumber === 'number' ? details.columnNumber : undefined,
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
        lineNumber: typeof entry.lineNumber === 'number' ? entry.lineNumber : undefined,
      })
      return
    }

    const requestId = typeof params.requestId === 'string' ? params.requestId : ''
    if (event.event.startsWith('Network.') && !networkRecordingRef.current) return

    if (event.event === 'Network.requestWillBeSent' && requestId) {
      const request = nestedRecord(params.request)
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          url: typeof request.url === 'string' ? request.url : '',
          method: typeof request.method === 'string' ? request.method : 'GET',
          type: typeof params.type === 'string' ? params.type : undefined,
          startedAt: typeof params.timestamp === 'number' ? params.timestamp : undefined,
          requestHeaders: nestedRecord(request.headers),
          postData: typeof request.postData === 'string' ? request.postData : undefined,
          initiator: nestedRecord(params.initiator),
          failed: false,
        }),
      )
      return
    }

    if (event.event === 'Network.responseReceived' && requestId) {
      const response = nestedRecord(params.response)
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          ...(typeof response.url === 'string' ? { url: response.url } : {}),
          status: typeof response.status === 'number' ? response.status : undefined,
          statusText: typeof response.statusText === 'string' ? response.statusText : undefined,
          mimeType: typeof response.mimeType === 'string' ? response.mimeType : undefined,
          protocol: typeof response.protocol === 'string' ? response.protocol : undefined,
          fromDiskCache: response.fromDiskCache === true,
          responseHeaders: nestedRecord(response.headers),
          remoteIPAddress:
            typeof response.remoteIPAddress === 'string' ? response.remoteIPAddress : undefined,
          remotePort: typeof response.remotePort === 'number' ? response.remotePort : undefined,
          securityDetails: nestedRecord(response.securityDetails),
          type: typeof params.type === 'string' ? params.type : undefined,
        }),
      )
      if (params.type === 'Document') {
        const responseState = typeof response.securityState === 'string'
          ? response.securityState
          : null
        if (responseState) {
          setSecurityState(responseState)
        } else if (Object.keys(nestedRecord(response.securityDetails)).length > 0) {
          setSecurityState('secure')
        }
      }
      return
    }

    if (event.event === 'Network.webSocketCreated' && requestId) {
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          url: typeof params.url === 'string' ? params.url : '',
          method: 'WS',
          type: 'WebSocket',
          startedAt: event.timestampMs / 1000,
          initiator: nestedRecord(params.initiator),
        }),
      )
      return
    }

    if (event.event === 'Network.webSocketClosed' && requestId) {
      setNetworkEntries((items) =>
        upsertNetwork(items, requestId, {
          finishedAt: event.timestampMs / 1000,
        }),
      )
      return
    }

    if (event.event === 'Network.loadingFinished' && requestId) {
      const finishedAt = typeof params.timestamp === 'number' ? params.timestamp : undefined
      setNetworkEntries((items) => {
        const current = items.find((item) => item.requestId === requestId)
        if (!current) return items
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
      setNetworkEntries((items) => {
        if (!items.some((item) => item.requestId === requestId)) return items
        return upsertNetwork(items, requestId, {
          failed: true,
          errorText: typeof params.errorText === 'string' ? params.errorText : copy.requestFailed,
          blockedReason:
            typeof params.blockedReason === 'string' ? params.blockedReason : undefined,
          finishedAt: typeof params.timestamp === 'number' ? params.timestamp : undefined,
        })
      })
      return
    }

    if (event.event === 'Security.securityStateChanged') {
      if (typeof params.securityState === 'string') setSecurityState(params.securityState)
    }
  }, [addConsoleEntry, copy, onElementPickerModeChange, selectSection])

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
      const [performance, heap, pageSummary] = await Promise.all([
        callTabDevTools<{ metrics?: PerformanceMetric[] }>(request.tabId, 'Performance.getMetrics'),
        callTabDevTools<{ usedSize?: number; totalSize?: number }>(request.tabId, 'Runtime.getHeapUsage'),
        callTabDevTools<{ result?: { value?: string } }>(request.tabId, 'Runtime.evaluate', {
          expression: `(() => {
            const resources = performance.getEntriesByType('resource');
            const navigation = performance.getEntriesByType('navigation')[0];
            return JSON.stringify({
              domNodes: document.getElementsByTagName('*').length,
              resourceCount: resources.length,
              transferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
              decodedBodyBytes: resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
              navigation: navigation ? {
                domInteractive: navigation.domInteractive,
                domContentLoaded: navigation.domContentLoadedEventEnd,
                loadEvent: navigation.loadEventEnd,
                responseEnd: navigation.responseEnd
              } : {},
              paints: performance.getEntriesByType('paint').map((entry) => ({
                name: entry.name,
                startTime: entry.startTime
              }))
            });
          })()`,
          returnByValue: true,
        }),
      ])
      if (!requestIsCurrent(request.epoch)) return
      setPerformanceMetrics(Array.isArray(performance.metrics) ? performance.metrics : [])
      setHeapUsed(typeof heap.usedSize === 'number' ? heap.usedSize : null)
      setHeapTotal(typeof heap.totalSize === 'number' ? heap.totalSize : null)
      const rawSummary = pageSummary.result?.value
      setPerformanceSummary(
        typeof rawSummary === 'string'
          ? JSON.parse(rawSummary) as PerformanceSummary
          : null,
      )
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
    const [htmlResult, computedResult] = await Promise.allSettled([
      callTabDevTools<{ outerHTML?: string }>(request.tabId, 'DOM.getOuterHTML', {
        nodeId: node.nodeId,
      }),
      node.nodeType === 1
        ? callTabDevTools<{ computedStyle?: Array<{ name: string; value: string }> }>(
            request.tabId,
            'CSS.getComputedStyleForNode',
            { nodeId: node.nodeId },
          )
        : Promise.resolve({ computedStyle: [] }),
    ])
    if (!requestIsCurrent(request.epoch)) return

    const html = htmlResult.status === 'fulfilled'
      ? htmlResult.value.outerHTML ?? node.nodeValue ?? ''
      : node.nodeValue ?? ''
    const computedStyles = computedResult.status === 'fulfilled' &&
      Array.isArray(computedResult.value.computedStyle)
      ? computedResult.value.computedStyle
      : []

    setSelectedNode({ node, outerHtml: html, computedStyles })
    setEditableOuterHtml(html)
    setEditingOuterHtml(false)
    setAttributeName('')
    setAttributeValue('')

    if (node.nodeType === 1) {
      void callTabDevTools(request.tabId, 'Overlay.highlightNode', {
        highlightConfig: HIGHLIGHT_CONFIG,
        nodeId: node.nodeId,
      }).catch(() => {})
    }
  }, [captureTabRequest, requestIsCurrent])

  const selectDomNodeById = useCallback(async (nodeId: number) => {
    const request = captureTabRequest()
    if (!request) return
    try {
      const described = await callTabDevTools<{ node?: CdpDomNode }>(
        request.tabId,
        'DOM.describeNode',
        { nodeId, depth: 2, pierce: true },
      )
      if (!requestIsCurrent(request.epoch) || !described.node) return
      let node = described.node

      // A context-menu hit on selected text can resolve to a Text node. CSS
      // inspection and highlighting require an Element, so promote it to its
      // closest parent element before reading details.
      if (node.nodeType !== 1) {
        const objectGroup = `nebula-inspector-node-${nodeId}`
        try {
          const resolved = await callTabDevTools<{
            object?: { objectId?: string }
          }>(request.tabId, 'DOM.resolveNode', {
            nodeId,
            objectGroup,
          })
          const objectId = resolved.object?.objectId
          if (objectId) {
            const parent = await callTabDevTools<{
              result?: { objectId?: string }
            }>(request.tabId, 'Runtime.callFunctionOn', {
              objectId,
              functionDeclaration: 'function () { return this && this.nodeType === 1 ? this : this && this.parentElement; }',
              objectGroup,
              returnByValue: false,
              silent: true,
            })
            const parentObjectId = parent.result?.objectId
            if (parentObjectId) {
              const requested = await callTabDevTools<{ nodeId?: number }>(
                request.tabId,
                'DOM.requestNode',
                { objectId: parentObjectId },
              )
              if (typeof requested.nodeId === 'number' && requested.nodeId > 0) {
                const parentDescription = await callTabDevTools<{ node?: CdpDomNode }>(
                  request.tabId,
                  'DOM.describeNode',
                  { nodeId: requested.nodeId, depth: 2, pierce: true },
                )
                if (parentDescription.node?.nodeType === 1) node = parentDescription.node
              }
            }
          }
        } catch {
          // The partial node remains inspectable even when promotion is not
          // supported by the current CDP implementation.
        } finally {
          void callTabDevTools(request.tabId, 'Runtime.releaseObjectGroup', {
            objectGroup,
          }).catch(() => {})
        }
      }

      if (!requestIsCurrent(request.epoch)) return
      await selectDomNode(node)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.nodeInspectFailed, requestIsCurrent, selectDomNode])

  const selectBackendNode = useCallback(async (backendNodeId: number) => {
    const request = captureTabRequest()
    if (!request) return
    try {
      const pushed = await callTabDevTools<{ nodeIds?: number[] }>(
        request.tabId,
        'DOM.pushNodesByBackendIdsToFrontend',
        { backendNodeIds: [backendNodeId] },
      )
      if (!requestIsCurrent(request.epoch)) return
      const nodeId = pushed.nodeIds?.[0]
      if (typeof nodeId === 'number' && nodeId > 0) await selectDomNodeById(nodeId)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.nodeInspectFailed, requestIsCurrent, selectDomNodeById])

  const toggleElementPicker = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    const next = !elementPickerActive
    try {
      await callTabDevTools(request.tabId, 'Overlay.setInspectMode', {
        mode: next ? 'searchForNode' : 'none',
        highlightConfig: HIGHLIGHT_CONFIG,
      })
      if (!requestIsCurrent(request.epoch)) return
      setElementPickerActive(next)
      onElementPickerModeChange?.(next)
      setStatus(next ? copy.inspectHint : null)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.inspectHint, copy.nodeInspectFailed, elementPickerActive, onElementPickerModeChange, requestIsCurrent])

  const runDomSearch = useCallback(async () => {
    const query = domSearch.trim()
    const request = captureTabRequest()
    if (!request || !query) return
    try {
      if (domSearchIdRef.current) {
        await callTabDevTools(request.tabId, 'DOM.discardSearchResults', {
          searchId: domSearchIdRef.current,
        }).catch(() => {})
      }
      const result = await callTabDevTools<{ searchId?: string; resultCount?: number }>(
        request.tabId,
        'DOM.performSearch',
        { query, includeUserAgentShadowDOM: true },
      )
      if (!requestIsCurrent(request.epoch)) return
      const searchId = result.searchId ?? ''
      const resultCount = Math.min(result.resultCount ?? 0, 200)
      domSearchIdRef.current = searchId || null
      if (!searchId || resultCount === 0) {
        setDomSearchNodeIds([])
        setDomSearchIndex(-1)
        setStatus(copy.noMatches)
        return
      }
      const nodes = await callTabDevTools<{ nodeIds?: number[] }>(
        request.tabId,
        'DOM.getSearchResults',
        { searchId, fromIndex: 0, toIndex: resultCount },
      )
      if (!requestIsCurrent(request.epoch)) return
      const nodeIds = Array.isArray(nodes.nodeIds) ? nodes.nodeIds : []
      setDomSearchNodeIds(nodeIds)
      setDomSearchIndex(nodeIds.length ? 0 : -1)
      if (nodeIds[0]) await selectDomNodeById(nodeIds[0])
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.domRefreshFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.domRefreshFailed, copy.noMatches, domSearch, requestIsCurrent, selectDomNodeById])

  const moveDomSearch = useCallback(async (direction: -1 | 1) => {
    if (!domSearchNodeIds.length) return
    const next = (domSearchIndex + direction + domSearchNodeIds.length) % domSearchNodeIds.length
    setDomSearchIndex(next)
    await selectDomNodeById(domSearchNodeIds[next])
  }, [domSearchIndex, domSearchNodeIds, selectDomNodeById])

  const applyOuterHtml = useCallback(async () => {
    const request = captureTabRequest()
    if (!request || !selectedNode) return
    try {
      await callTabDevTools(request.tabId, 'DOM.setOuterHTML', {
        nodeId: selectedNode.node.nodeId,
        outerHTML: editableOuterHtml,
      })
      if (!requestIsCurrent(request.epoch)) return
      setEditingOuterHtml(false)
      setSelectedNode(null)
      await refreshDom()
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.nodeInspectFailed, editableOuterHtml, refreshDom, requestIsCurrent, selectedNode])

  const setSelectedNodeAttribute = useCallback(async () => {
    const name = attributeName.trim()
    const request = captureTabRequest()
    if (!request || !selectedNode || !name) return
    try {
      await callTabDevTools(request.tabId, 'DOM.setAttributeValue', {
        nodeId: selectedNode.node.nodeId,
        name,
        value: attributeValue,
      })
      if (!requestIsCurrent(request.epoch)) return
      await selectDomNodeById(selectedNode.node.nodeId)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
    }
  }, [attributeName, attributeValue, captureTabRequest, copy.nodeInspectFailed, requestIsCurrent, selectDomNodeById, selectedNode])

  const removeSelectedNodeAttribute = useCallback(async (name: string) => {
    const request = captureTabRequest()
    if (!request || !selectedNode) return
    try {
      await callTabDevTools(request.tabId, 'DOM.removeAttribute', {
        nodeId: selectedNode.node.nodeId,
        name,
      })
      if (!requestIsCurrent(request.epoch)) return
      await selectDomNodeById(selectedNode.node.nodeId)
    } catch (error) {
      if (requestIsCurrent(request.epoch)) setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
    }
  }, [captureTabRequest, copy.nodeInspectFailed, requestIsCurrent, selectDomNodeById, selectedNode])

  const refreshPageStorage = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    const expression = `(async () => {
      const cacheNames = typeof caches === 'undefined' ? [] : await caches.keys().catch(() => []);
      const indexedDbNames = typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function'
        ? []
        : (await indexedDB.databases().catch(() => [])).map((database) => database.name || '(unnamed)');
      const registrations = !navigator.serviceWorker
        ? []
        : await navigator.serviceWorker.getRegistrations().catch(() => []);
      return JSON.stringify({
        localStorage: Object.fromEntries(Array.from({length: localStorage.length}, (_, i) => { const k = localStorage.key(i); return k === null ? ['', ''] : [k, localStorage.getItem(k) ?? '']; }).filter(([k]) => k)),
        sessionStorage: Object.fromEntries(Array.from({length: sessionStorage.length}, (_, i) => { const k = sessionStorage.key(i); return k === null ? ['', ''] : [k, sessionStorage.getItem(k) ?? '']; }).filter(([k]) => k)),
        cacheNames,
        indexedDbNames,
        serviceWorkers: registrations.map((registration) => ({
          scope: registration.scope,
          active: Boolean(registration.active)
        }))
      });
    })()`
    try {
      const runtime = await callTabDevTools<{ result?: { value?: string } }>(
        request.tabId,
        'Runtime.evaluate',
        {
          expression,
          awaitPromise: true,
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
    // builds can reject or delay Network.getCookies independently.
    try {
      const cookieResult = activeUrl
        ? await callTabDevTools<{ cookies?: CookieMetadata[] }>(
            request.tabId,
            'Network.getCookies',
            { urls: [activeUrl] },
          )
        : { cookies: [] }
      if (!requestIsCurrent(request.epoch)) return
      setCookies(Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [])
    } catch {
      if (requestIsCurrent(request.epoch)) setCookies([])
    }
  }, [activeUrl, captureTabRequest, copy.storageRefreshFailed, requestIsCurrent])

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
        protocol: location.protocol,
        secureContext: window.isSecureContext,
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
        const info = JSON.parse(result.result.value) as PageInfo
        setPageInfo(info)
        setSecurityState((current) => {
          if (current !== 'unknown') return current
          if (info.secureContext) return 'secure'
          if (info.protocol === 'https:') return 'insecure-broken'
          if (info.protocol === 'http:') return 'insecure'
          return 'neutral'
        })
      }
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.siteInfoRefreshFailed}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy.siteInfoRefreshFailed, requestIsCurrent])

  const selectScript = useCallback(async (scriptId: string) => {
    const request = captureTabRequest()
    if (!request) return
    const sourceRequestId = ++sourceRequestIdRef.current
    setSelectedScriptId(scriptId)
    try {
      const result = await callTabDevTools<{ scriptSource?: string }>(
        request.tabId,
        'Debugger.getScriptSource',
        { scriptId },
      )
      if (!requestIsCurrent(request.epoch) || sourceRequestId !== sourceRequestIdRef.current) return
      setScriptSource(result.scriptSource ?? '')
    } catch (error) {
      if (requestIsCurrent(request.epoch)) setStatus(`${copy.actionFailed(copy.sources)}: ${String(error)}`)
    }
  }, [captureTabRequest, copy, requestIsCurrent])

  const refreshAccessibility = useCallback(async () => {
    const request = captureTabRequest()
    if (!request) return
    try {
      const result = await callTabDevTools<{ nodes?: AccessibilityNode[] }>(
        request.tabId,
        'Accessibility.getFullAXTree',
        { depth: 8 },
      )
      if (!requestIsCurrent(request.epoch)) return
      setAccessibilityNodes(Array.isArray(result.nodes) ? result.nodes : [])
    } catch (error) {
      if (requestIsCurrent(request.epoch)) {
        setStatus(`${copy.actionFailed(copy.accessibility)}: ${String(error)}`)
      }
    }
  }, [captureTabRequest, copy, requestIsCurrent])

  useEffect(() => {
    setStatus(null)
    setConsoleEntries([])
    setNetworkEntries([])
    setSelectedNetworkRequestId(null)
    setNetworkBody(null)
    setRawEvents([])
    setSecurityState('unknown')
    setMemoryPressure(null)
    setPlayingAudio(null)
    setPerformanceMetrics([])
    setPerformanceSummary(null)
    setHeapUsed(null)
    setHeapTotal(null)
    setDomRoot(null)
    setSelectedNode(null)
    setElementPickerActive(false)
    setPendingBackendNodeId(null)
    setDomSearchNodeIds([])
    setDomSearchIndex(-1)
    setEditingOuterHtml(false)
    setPageStorage(null)
    setCookies([])
    setRevealedCookieIds(new Set<string>())
    setSourceEntries([])
    setSelectedScriptId(null)
    setScriptSource('')
    setAccessibilityNodes([])
    setPageInfo(null)
    setLoadingDom(false)
    setInspectorReady(false)
  }, [activeTabId])

  useEffect(() => {
    if (!activeTabId || !activeLabel || !isTauri) return

    let disposed = false
    let unlisten: (() => void) | undefined
    let subscribed = false
    const epoch = requestEpochRef.current.capture()
    if (epoch.key !== activeTabId) return
    setInspectorReady(false)

    void (async () => {
      try {
        unlisten = await listenNebulaDevToolsEvents((event) => {
          if (
            requestIsCurrent(epoch) &&
            event.tabLabel === activeLabel
          ) {
            handleDevToolsEvent(event)
          }
        })
        await subscribeTabDevTools(activeTabId)
        if (disposed || !requestIsCurrent(epoch)) {
          await unsubscribeTabDevTools(activeTabId).catch(() => {})
          return
        }
        subscribed = true
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
      if (subscribed) void unsubscribeTabDevTools(activeTabId).catch(() => {})
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
    if (!inspectorReady || pendingBackendNodeId === null) return
    const backendNodeId = pendingBackendNodeId
    setPendingBackendNodeId(null)
    void selectBackendNode(backendNodeId)
  }, [inspectorReady, pendingBackendNodeId, selectBackendNode])

  useEffect(() => {
    if (!inspectorReady || !activeTabId || !inspectRequest) return
    let disposed = false
    void (async () => {
      try {
        selectSection('elements')
        await enableInspectorSectionDomains(activeTabId, 'elements')
        const x = Math.max(0, Math.round(inspectRequest.x))
        const y = Math.max(0, Math.round(inspectRequest.y))
        let nodeId: number | undefined
        let backendNodeId: number | undefined
        let hitTestError: unknown

        // elementFromPoint is the stable path on WebView2 and always returns
        // an Element. DOM.getNodeForLocation is retained only as a fallback;
        // some runtime builds reject repeated calls to it with E_INVALIDARG.
        const objectGroup = `nebula-inspector-hit-${inspectRequest.token}`
        try {
          const evaluated = await callTabDevTools<{
            result?: { objectId?: string }
          }>(activeTabId, 'Runtime.evaluate', {
            expression: `document.elementFromPoint(${x}, ${y})`,
            objectGroup,
            returnByValue: false,
            silent: true,
          })
          const objectId = evaluated.result?.objectId
          if (objectId) {
            const requested = await callTabDevTools<{
              nodeId?: number
            }>(activeTabId, 'DOM.requestNode', { objectId })
            nodeId = requested.nodeId
          }
        } catch (error) {
          hitTestError = error
        } finally {
          void callTabDevTools(activeTabId, 'Runtime.releaseObjectGroup', {
            objectGroup,
          }).catch(() => {})
        }

        if (!(typeof nodeId === 'number' && nodeId > 0)) {
          try {
            const result = await callTabDevTools<{
              nodeId?: number
              backendNodeId?: number
            }>(activeTabId, 'DOM.getNodeForLocation', { x, y })
            nodeId = result.nodeId
            backendNodeId = result.backendNodeId
          } catch (error) {
            hitTestError ??= error
          }
        }

        if (!(typeof nodeId === 'number' && nodeId > 0) &&
          !(typeof backendNodeId === 'number' && backendNodeId > 0)) {
          throw hitTestError ?? new Error('No DOM node found at the context-menu location')
        }

        if (disposed) return
        if (typeof nodeId === 'number' && nodeId > 0) {
          await selectDomNodeById(nodeId)
        } else if (typeof backendNodeId === 'number') {
          await selectBackendNode(backendNodeId)
        }
      } catch (error) {
        if (!disposed) setStatus(`${copy.nodeInspectFailed}: ${String(error)}`)
      } finally {
        if (!disposed) onInspectRequestHandled?.()
      }
    })()
    return () => {
      disposed = true
    }
  }, [activeTabId, copy.nodeInspectFailed, inspectRequest, inspectorReady, onInspectRequestHandled, selectBackendNode, selectDomNodeById, selectSection])

  useEffect(() => {
    if (!inspectorReady || !activeTabId || !performanceAutoRefresh) return
    const interval = window.setInterval(() => void refreshPerformance(), 1200)
    return () => window.clearInterval(interval)
  }, [activeTabId, inspectorReady, performanceAutoRefresh, refreshPerformance])

  useEffect(() => {
    if (!inspectorReady || !activeTabId) return
    void callTabDevTools(activeTabId, 'Network.setCacheDisabled', {
      cacheDisabled,
    }).catch((error) => setStatus(`${copy.actionFailed(copy.disableCache)}: ${String(error)}`))
  }, [activeTabId, cacheDisabled, copy, inspectorReady])

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
      if (section === 'sources') {
        await enableInspectorSectionDomains(activeTabId, 'sources')
        return
      }
      if (section === 'accessibility') {
        await enableInspectorSectionDomains(activeTabId, 'accessibility')
        if (!disposed) await refreshAccessibility()
        return
      }
      if (section === 'site') {
        await Promise.all([refreshPageInfo(), refreshPageStorage()])
      }
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
    refreshAccessibility,
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
    consoleHistoryRef.current = [
      expression,
      ...consoleHistoryRef.current.filter((item) => item !== expression),
    ].slice(0, 50)
    consoleHistoryIndexRef.current = -1
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

  const copyText = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus(copy.actionComplete(copy.copy))
    } catch (error) {
      setStatus(`${copy.actionFailed(copy.copy)}: ${String(error)}`)
    }
  }, [copy])

  const selectNetworkEntry = useCallback(async (entry: NetworkEntry) => {
    const request = captureTabRequest()
    if (!request) return
    setSelectedNetworkRequestId(entry.requestId)
    setNetworkBody(null)
    if (entry.method === 'WS' || entry.failed) return
    try {
      const result = await callTabDevTools<{ body?: string; base64Encoded?: boolean }>(
        request.tabId,
        'Network.getResponseBody',
        { requestId: entry.requestId },
      )
      if (!requestIsCurrent(request.epoch)) return
      setNetworkBody({
        requestId: entry.requestId,
        body: result.body ?? '',
        base64Encoded: result.base64Encoded === true,
      })
    } catch (error) {
      if (!requestIsCurrent(request.epoch)) return
      setNetworkBody({
        requestId: entry.requestId,
        body: '',
        base64Encoded: false,
        error: String(error),
      })
    }
  }, [captureTabRequest, requestIsCurrent])

  const setPageStorageEntry = useCallback(async () => {
    const key = storageKey.trim()
    const request = captureTabRequest()
    if (!request || !key) return
    try {
      await callTabDevTools(request.tabId, 'Runtime.evaluate', {
        expression: `${storageArea}.setItem(${JSON.stringify(key)}, ${JSON.stringify(storageValue)})`,
      })
      if (!requestIsCurrent(request.epoch)) return
      setStorageKey('')
      setStorageValue('')
      await refreshPageStorage()
    } catch (error) {
      if (requestIsCurrent(request.epoch)) setStatus(`${copy.storageRefreshFailed}: ${String(error)}`)
    }
  }, [captureTabRequest, copy.storageRefreshFailed, refreshPageStorage, requestIsCurrent, storageArea, storageKey, storageValue])

  const deletePageStorageEntry = useCallback(async (
    area: 'localStorage' | 'sessionStorage',
    key: string,
  ) => {
    const request = captureTabRequest()
    if (!request) return
    try {
      await callTabDevTools(request.tabId, 'Runtime.evaluate', {
        expression: `${area}.removeItem(${JSON.stringify(key)})`,
      })
      if (requestIsCurrent(request.epoch)) await refreshPageStorage()
    } catch (error) {
      if (requestIsCurrent(request.epoch)) setStatus(`${copy.storageRefreshFailed}: ${String(error)}`)
    }
  }, [captureTabRequest, copy.storageRefreshFailed, refreshPageStorage, requestIsCurrent])

  const toggleCookieValue = useCallback((cookie: CookieMetadata) => {
    const id = cookieIdentity(cookie)
    setRevealedCookieIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const deleteCookie = useCallback(async (cookie: CookieMetadata) => {
    const request = captureTabRequest()
    if (!request) return
    try {
      await callTabDevTools(request.tabId, 'Network.deleteCookies', {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
      })
      if (requestIsCurrent(request.epoch)) await refreshPageStorage()
    } catch (error) {
      if (requestIsCurrent(request.epoch)) setStatus(`${copy.storageRefreshFailed}: ${String(error)}`)
    }
  }, [captureTabRequest, copy.storageRefreshFailed, refreshPageStorage, requestIsCurrent])

  const dateLocale = locale === 'tr' ? 'tr-TR' : 'en-US'

  const filteredConsole = useMemo(() => {
    const needle = consoleFilter.trim().toLowerCase()
    return consoleEntries.filter((entry) => {
      const displayLevel = consoleDisplayLevel(entry)
      const levelMatches = consoleLevelFilter === 'all' || displayLevel === consoleLevelFilter
      const textMatches = !needle || `${displayLevel} ${entry.source} ${entry.text}`.toLowerCase().includes(needle)
      return levelMatches && textMatches
    })
  }, [consoleEntries, consoleFilter, consoleLevelFilter])

  const filteredNetwork = useMemo(() => {
    const needle = networkFilter.trim().toLowerCase()
    return needle
      ? networkEntries.filter((entry) => `${entry.method} ${entry.status ?? ''} ${entry.type ?? ''} ${entry.url} ${entry.errorText ?? ''} ${entry.blockedReason ?? ''} ${isClientBlockedNetworkEntry(entry) ? copy.blocked : ''}`.toLowerCase().includes(needle))
      : networkEntries
  }, [copy.blocked, networkEntries, networkFilter])

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

  const filteredSources = useMemo(() => {
    const needle = sourceFilter.trim().toLowerCase()
    return sourceEntries
      .filter((entry) => showAnonymousSources || !isAnonymousSource(entry))
      .filter((entry) => !needle || entry.url.toLowerCase().includes(needle))
      .sort((a, b) => a.url.localeCompare(b.url))
  }, [showAnonymousSources, sourceEntries, sourceFilter])

  const sourceGroups = useMemo(() => {
    const groups = new Map<string, ScriptEntry[]>()
    for (const entry of filteredSources) {
      const label = sourceGroupLabel(entry, copy.anonymousScripts, copy.inlineScripts)
      const group = groups.get(label)
      if (group) group.push(entry)
      else groups.set(label, [entry])
    }
    return [...groups.entries()]
  }, [copy.anonymousScripts, copy.inlineScripts, filteredSources])

  const filteredAccessibilityNodes = useMemo(() => {
    const needle = accessibilityFilter.trim().toLowerCase()
    return accessibilityNodes.filter((node) => {
      if (!showAccessibilityNoise && isAccessibilityNoise(node)) return false
      if (!needle) return true
      return `${node.role?.value ?? ''} ${node.name?.value ?? ''} ${node.description?.value ?? ''} ${node.backendDOMNodeId ?? ''}`
        .toLowerCase()
        .includes(needle)
    })
  }, [accessibilityFilter, accessibilityNodes, showAccessibilityNoise])

  const selectedNetworkEntry = useMemo(
    () => networkEntries.find((entry) => entry.requestId === selectedNetworkRequestId) ?? null,
    [networkEntries, selectedNetworkRequestId],
  )

  const selectedNodeAttributes = useMemo(() => {
    const values = selectedNode?.node.attributes ?? []
    const pairs: Array<{ name: string; value: string }> = []
    for (let index = 0; index < values.length; index += 2) {
      pairs.push({ name: values[index], value: values[index + 1] ?? '' })
    }
    return pairs
  }, [selectedNode])

  const trackingPreventionLabel = privacyState.trackingLevel === 'strict'
    ? copy.trackingStrict
    : privacyState.trackingLevel === 'none'
      ? copy.trackingNone
      : copy.trackingBalanced

  const consoleErrorCount = consoleEntries.filter(
    (entry) => entry.level === 'error' && !isClientBlockedConsoleEntry(entry),
  ).length
  const failedRequestCount = networkEntries.filter(isFailedNetworkEntry).length
  const blockedRequestCount = networkEntries.filter(isClientBlockedNetworkEntry).length

  const sections: Array<{ id: DeveloperToolsSection; label: string; badge?: number }> = [
    { id: 'overview', label: copy.overview },
    { id: 'elements', label: copy.elements },
    { id: 'console', label: copy.console, badge: consoleErrorCount || undefined },
    { id: 'network', label: copy.network, badge: failedRequestCount || undefined },
    { id: 'performance', label: copy.performance },
    { id: 'storage', label: copy.storage },
    { id: 'site', label: copy.site },
    { id: 'sources', label: copy.sources },
    { id: 'accessibility', label: copy.accessibility },
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
                onClick={() => selectSection(item.id)}
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
                  <div className={styles.metricCard}><span>{copy.blockedRequests}</span><strong>{blockedRequestCount}</strong></div>
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
                    <button
                      type="button"
                      className={elementPickerActive ? styles.smallButtonActive : styles.smallButton}
                      onClick={() => void toggleElementPicker()}
                    >
                      {elementPickerActive ? copy.stopInspecting : copy.inspectElement}
                    </button>
                    <button type="button" className={styles.smallButton} onClick={() => void refreshDom()}>{loadingDom ? copy.loading : copy.refresh}</button>
                  </div>
                  <div className={styles.searchToolbar}>
                    <input
                      value={domSearch}
                      onChange={(event) => setDomSearch(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') void runDomSearch() }}
                      placeholder={copy.searchDom}
                    />
                    <button type="button" className={styles.smallButton} onClick={() => void runDomSearch()}>{copy.search}</button>
                    <button type="button" className={styles.smallButton} disabled={domSearchNodeIds.length === 0} onClick={() => void moveDomSearch(-1)}>↑</button>
                    <button type="button" className={styles.smallButton} disabled={domSearchNodeIds.length === 0} onClick={() => void moveDomSearch(1)}>↓</button>
                    <span className={styles.toolbarStat}>{domSearchNodeIds.length ? `${domSearchIndex + 1}/${domSearchNodeIds.length}` : copy.noMatches}</span>
                  </div>
                  <div className={styles.domTree}>
                    {domRoot ? <DomTreeNode node={domRoot} depth={0} selectedNodeId={selectedNode?.node.nodeId ?? null} onSelect={(node) => void selectDomNode(node)} /> : <div className={styles.emptyState}>{copy.noDom}</div>}
                  </div>
                </div>
                <div className={styles.splitPane}>
                  <div className={styles.paneToolbar}><strong>{copy.nodeDetails}</strong>{selectedNode && <button type="button" className={styles.smallButton} onClick={() => { void callTabDevTools(activeTabId, 'Overlay.hideHighlight'); setSelectedNode(null) }}>{copy.clearHighlight}</button>}</div>
                  {selectedNode ? (
                    <div className={styles.nodeInspector}>
                      <div className={styles.inspectorTitleRow}>
                        <h3>{copy.outerHtml}</h3>
                        <div>
                          <button type="button" className={styles.smallButton} onClick={() => void copyText(selectedNode.outerHtml)}>{copy.copy}</button>
                          <button type="button" className={styles.smallButton} onClick={() => setEditingOuterHtml((value) => !value)}>{editingOuterHtml ? copy.cancel : copy.editHtml}</button>
                        </div>
                      </div>
                      {editingOuterHtml ? (
                        <div className={styles.editorBlock}>
                          <textarea value={editableOuterHtml} onChange={(event) => setEditableOuterHtml(event.target.value)} spellCheck={false} />
                          <button type="button" className={styles.secondaryButton} onClick={() => void applyOuterHtml()}>{copy.apply}</button>
                        </div>
                      ) : <pre className={styles.codeBlock}>{selectedNode.outerHtml}</pre>}

                      <h3>{copy.attributeName}</h3>
                      <div className={styles.attributeEditor}>
                        <input value={attributeName} onChange={(event) => setAttributeName(event.target.value)} placeholder={copy.attributeName} />
                        <input value={attributeValue} onChange={(event) => setAttributeValue(event.target.value)} placeholder={copy.attributeValue} />
                        <button type="button" className={styles.smallButton} disabled={!attributeName.trim()} onClick={() => void setSelectedNodeAttribute()}>{copy.setAttribute}</button>
                      </div>
                      <div className={styles.attributeList}>
                        {selectedNodeAttributes.map((attribute) => (
                          <div key={attribute.name} className={styles.attributeRow}>
                            <code>{attribute.name}</code><span>{attribute.value || copy.empty}</span>
                            <button type="button" onClick={() => void removeSelectedNodeAttribute(attribute.name)}>{copy.removeAttribute}</button>
                          </div>
                        ))}
                      </div>

                      <h3>{copy.computedStyles}</h3>
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
                  <select className={styles.compactSelect} value={consoleLevelFilter} onChange={(event) => setConsoleLevelFilter(event.target.value)}>
                    <option value="all">{locale === 'tr' ? 'Tüm düzeyler' : 'All levels'}</option>
                    <option value="error">Error</option>
                    <option value="blocked">{locale === 'tr' ? 'Engellendi' : 'Blocked'}</option>
                    <option value="warning">Warning</option>
                    <option value="log">Log</option>
                    <option value="info">Info</option>
                    <option value="debug">Debug</option>
                    <option value="command">Command</option>
                    <option value="result">Result</option>
                  </select>
                  <label className={styles.toggleLabel}><input type="checkbox" checked={preserveConsoleLog} onChange={(event) => setPreserveConsoleLog(event.target.checked)} />{copy.preserveLog}</label>
                  <button type="button" className={styles.smallButton} onClick={() => setConsoleEntries([])}>{copy.clear}</button>
                </div>
                <div className={styles.consoleList}>
                  {filteredConsole.map((entry) => (
                    <div key={entry.id} className={`${styles.consoleRow} ${consoleDisplayLevel(entry) === 'blocked' ? styles.consoleBlocked : entry.level === 'error' ? styles.consoleError : entry.level === 'warning' || entry.level === 'warn' ? styles.consoleWarn : ''}`}>
                      <span className={styles.consoleLevel}>{localizeTechnicalState(locale, consoleDisplayLevel(entry))}</span>
                      <span className={styles.consoleContent}>
                        <span className={styles.consoleText}>{entry.text}</span>
                        <span className={styles.consoleSource} title={entry.url ?? entry.source}>{consoleSourceLabel(entry)}</span>
                      </span>
                      <span className={styles.consoleTime}>{new Date(entry.time).toLocaleTimeString(dateLocale)}</span>
                    </div>
                  ))}
                  {filteredConsole.length === 0 && <div className={styles.emptyState}>{copy.consoleQuiet}</div>}
                </div>
                <div className={styles.consolePrompt}>
                  <span>›</span>
                  <input
                    ref={consoleInputRef}
                    value={consoleCommand}
                    onChange={(event) => setConsoleCommand(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void runConsoleCommand()
                        return
                      }
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                      const history = consoleHistoryRef.current
                      if (history.length === 0) return
                      event.preventDefault()
                      const delta = event.key === 'ArrowUp' ? 1 : -1
                      const next = Math.max(-1, Math.min(history.length - 1, consoleHistoryIndexRef.current + delta))
                      consoleHistoryIndexRef.current = next
                      setConsoleCommand(next < 0 ? '' : history[next])
                    }}
                    placeholder={copy.evalPlaceholder}
                  />
                  <button type="button" className={styles.smallButton} onClick={() => void runConsoleCommand()}>{copy.run}</button>
                </div>
              </div>
            )}

            {section === 'network' && activeTabId && (
              <div className={styles.sectionFill}>
                <div className={styles.paneToolbar}>
                  <button type="button" className={networkRecording ? styles.recordButtonActive : styles.recordButton} onClick={() => setNetworkRecording((value) => !value)} title={copy.recording}>●</button>
                  <div className={styles.filterRow}><input value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value)} placeholder={copy.filterNetwork} /></div>
                  <label className={styles.toggleLabel}><input type="checkbox" checked={preserveNetworkLog} onChange={(event) => setPreserveNetworkLog(event.target.checked)} />{copy.preserveLog}</label>
                  <label className={styles.toggleLabel}><input type="checkbox" checked={cacheDisabled} onChange={(event) => setCacheDisabled(event.target.checked)} />{copy.disableCache}</label>
                  <span className={styles.toolbarStat}>{networkEntries.length} {copy.requests.toLocaleLowerCase(locale)} · {failedRequestCount} {copy.failed} · {blockedRequestCount} {copy.blocked}</span>
                  <button type="button" className={styles.smallButton} onClick={() => { setNetworkEntries([]); setSelectedNetworkRequestId(null); setNetworkBody(null) }}>{copy.clear}</button>
                </div>
                <div className={styles.networkWorkspace}>
                  <div className={styles.networkTable}>
                    <div className={styles.networkHead}><span>{copy.status}</span><span>{copy.method}</span><span>{copy.type}</span><span>URL</span><span>{copy.time}</span><span>{copy.size}</span></div>
                    {filteredNetwork.map((entry) => (
                      <button
                        type="button"
                        key={entry.requestId}
                        className={`${styles.networkRow} ${entry.requestId === selectedNetworkRequestId ? styles.networkRowSelected : ''} ${isClientBlockedNetworkEntry(entry) ? styles.networkBlocked : isFailedNetworkEntry(entry) ? styles.networkFailed : ''}`}
                        title={entry.errorText ?? entry.url}
                        onClick={() => void selectNetworkEntry(entry)}
                      >
                        <span>{isClientBlockedNetworkEntry(entry) ? copy.blocked : entry.failed ? 'ERR' : entry.status ?? '…'}</span><span>{entry.method}</span><span>{entry.type ?? copy.other}</span><code>{entry.url}</code><span>{entry.durationMs === undefined ? '—' : `${entry.durationMs.toFixed(0)} ms`}</span><span>{formatBytes(entry.encodedDataLength)}</span>
                      </button>
                    ))}
                    {filteredNetwork.length === 0 && <div className={styles.emptyState}>{copy.noRequests}</div>}
                  </div>
                  {selectedNetworkEntry && (
                    <aside className={styles.networkDetails}>
                      <div className={styles.paneToolbar}>
                        <strong>{copy.requestDetails}</strong>
                        <button type="button" className={styles.smallButton} onClick={() => void copyText(selectedNetworkEntry.url)}>{copy.copyUrl}</button>
                        <button type="button" className={styles.smallButton} onClick={() => void copyText(curlForRequest(selectedNetworkEntry))}>{copy.copyCurl}</button>
                        <button type="button" className={styles.smallButton} onClick={() => { setSelectedNetworkRequestId(null); setNetworkBody(null) }}>✕</button>
                      </div>
                      <div className={styles.networkDetailsBody}>
                        <div className={styles.detailGrid}>
                          <span>URL</span><code>{selectedNetworkEntry.url}</code>
                          <span>{copy.method}</span><code>{selectedNetworkEntry.method}</code>
                          <span>{copy.status}</span><code>{isClientBlockedNetworkEntry(selectedNetworkEntry) ? `${copy.blocked}${selectedNetworkEntry.blockedReason ? ` · ${selectedNetworkEntry.blockedReason}` : ''}` : selectedNetworkEntry.status ?? selectedNetworkEntry.errorText ?? '—'} {selectedNetworkEntry.statusText ?? ''}</code>
                          <span>Protocol</span><code>{selectedNetworkEntry.protocol ?? '—'}</code>
                          <span>Remote</span><code>{selectedNetworkEntry.remoteIPAddress ? `${selectedNetworkEntry.remoteIPAddress}:${selectedNetworkEntry.remotePort ?? ''}` : '—'}</code>
                          <span>Cache</span><code>{selectedNetworkEntry.fromDiskCache ? copy.yes : copy.no}</code>
                        </div>
                        <details open className={styles.detailSection}><summary>{copy.headers}</summary><h4>Request</h4><pre>{headersText(selectedNetworkEntry.requestHeaders)}</pre><h4>Response</h4><pre>{headersText(selectedNetworkEntry.responseHeaders)}</pre></details>
                        <details className={styles.detailSection}><summary>{copy.payload}</summary><pre>{selectedNetworkEntry.postData || copy.empty}</pre></details>
                        <details open className={styles.detailSection}><summary>{copy.response}</summary><pre>{networkBody?.requestId === selectedNetworkEntry.requestId ? (networkBody.error || networkBody.body || copy.noResponseBody) : copy.noResponseBody}</pre>{networkBody?.base64Encoded && <small>Base64</small>}</details>
                        <details className={styles.detailSection}><summary>Initiator / Security</summary><pre>{JSON.stringify({ initiator: selectedNetworkEntry.initiator, security: selectedNetworkEntry.securityDetails }, null, 2)}</pre></details>
                      </div>
                    </aside>
                  )}
                </div>
              </div>
            )}

            {section === 'performance' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div><h2>{copy.performance}</h2><p>{copy.performanceLead}</p></div>
                  <div className={styles.inlineActions}>
                    <label className={styles.toggleLabel}><input type="checkbox" checked={performanceAutoRefresh} onChange={(event) => setPerformanceAutoRefresh(event.target.checked)} />{copy.autoRefresh}</label>
                    <button type="button" className={styles.secondaryButton} onClick={() => void refreshPerformance()}>{copy.refresh}</button>
                  </div>
                </div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>{copy.heapUsed}</span><strong>{heapUsed === null ? '—' : formatBytes(heapUsed)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.heapTotal}</span><strong>{heapTotal === null ? '—' : formatBytes(heapTotal)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.memoryPressure}</span><strong>{memoryPressure === null ? '—' : `${memoryPressure}%`}</strong></div>
                  <div className={styles.metricCard}><span>{copy.capturedMetrics}</span><strong>{performanceMetrics.length}</strong></div>
                  <div className={styles.metricCard}><span>{copy.pageDomNodes}</span><strong>{performanceSummary?.domNodes ?? '—'}</strong></div>
                  <div className={styles.metricCard}><span>{copy.resourceTimingEntries}</span><strong>{performanceSummary?.resourceCount ?? '—'}</strong></div>
                  <div className={styles.metricCard}><span>{copy.resourceTimingTransfer}</span><strong>{formatBytes(performanceSummary?.transferBytes)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.resourceTimingDecoded}</span><strong>{formatBytes(performanceSummary?.decodedBodyBytes)}</strong></div>
                </div>
                {performanceSummary && (
                  <>
                    <h3 className={styles.subheading}>{copy.pageSummary}</h3>
                    <div className={styles.metricList}>
                      {Object.entries(performanceSummary.navigation).map(([name, value]) => <div key={name} className={styles.metricRow}><span>{name}</span><code>{Number(value).toFixed(1)} ms</code></div>)}
                      {performanceSummary.paints.map((paint) => <div key={paint.name} className={styles.metricRow}><span>{paint.name}</span><code>{paint.startTime.toFixed(1)} ms</code></div>)}
                    </div>
                  </>
                )}
                <h3 className={styles.subheading}>CDP metrics</h3>
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
                  <div className={styles.storageEditor}>
                    <select value={storageArea} onChange={(event) => setStorageArea(event.target.value as 'localStorage' | 'sessionStorage')} aria-label={copy.storageArea}>
                      <option value="localStorage">localStorage</option>
                      <option value="sessionStorage">sessionStorage</option>
                    </select>
                    <input value={storageKey} onChange={(event) => setStorageKey(event.target.value)} placeholder={copy.storageKey} />
                    <input value={storageValue} onChange={(event) => setStorageValue(event.target.value)} placeholder={copy.storageValue} />
                    <button type="button" className={styles.smallButton} disabled={!activeTabId || !storageKey.trim()} onClick={() => void setPageStorageEntry()}>{copy.setStorageValue}</button>
                  </div>
                  {pageStorage ? (
                    <>
                      {(['localStorage', 'sessionStorage'] as const).map((area) => (
                        <div key={area}>
                          <h3 className={styles.subheading}>{area}</h3>
                          <div className={styles.keyValueList}>
                            {Object.entries(pageStorage[area]).map(([key, value]) => (
                              <div key={key} className={styles.keyValueRow}>
                                <button type="button" title={locale === 'tr' ? 'Düzenle' : 'Edit'} onClick={() => { setStorageArea(area); setStorageKey(key); setStorageValue(value) }}><code>{key}</code><span>{value}</span></button>
                                <button type="button" className={styles.rowDeleteButton} onClick={() => void deletePageStorageEntry(area, key)}>{copy.delete}</button>
                              </div>
                            ))}
                            {Object.keys(pageStorage[area]).length === 0 && <div className={styles.emptyState}>{copy.empty}</div>}
                          </div>
                        </div>
                      ))}
                      <div className={styles.storageMetadataGrid}>
                        <div><h3 className={styles.subheading}>{copy.cacheStorage}</h3>{pageStorage.cacheNames.map((name) => <code key={name}>{name}</code>)}{pageStorage.cacheNames.length === 0 && <span>{copy.empty}</span>}</div>
                        <div><h3 className={styles.subheading}>{copy.indexedDb}</h3>{pageStorage.indexedDbNames.map((name) => <code key={name}>{name}</code>)}{pageStorage.indexedDbNames.length === 0 && <span>{copy.empty}</span>}</div>
                        <div><h3 className={styles.subheading}>{copy.serviceWorkers}</h3>{pageStorage.serviceWorkers.map((worker) => <code key={worker.scope}>{worker.active ? '● ' : '○ '}{worker.scope}</code>)}{pageStorage.serviceWorkers.length === 0 && <span>{copy.empty}</span>}</div>
                      </div>
                    </>
                  ) : <div className={styles.emptyState}>{copy.noPageStorage}</div>}
                  <h3 className={styles.subheading}>{copy.cookies} ({cookies.length})</h3>
                  <div className={styles.cookieList}>
                    {cookies.map((cookie) => {
                      const cookieId = cookieIdentity(cookie)
                      const isRevealed = revealedCookieIds.has(cookieId)
                      return (
                        <div key={cookieId} className={styles.cookieRow}>
                          <strong>{cookie.name}</strong>
                          <span>{cookie.domain}{cookie.path}</span>
                          <code className={isRevealed ? styles.cookieValueRevealed : styles.cookieValue} aria-label={copy.cookieValue}>
                            {isRevealed ? cookie.value || copy.empty : cookie.value ? '••••••••' : copy.empty}
                          </code>
                          <small>{cookie.httpOnly ? 'HttpOnly · ' : ''}{cookie.secure ? 'Secure · ' : ''}{cookie.sameSite ?? copy.unspecified}</small>
                          <div className={styles.cookieActions}>
                            <button type="button" className={styles.smallButton} aria-pressed={isRevealed} onClick={() => toggleCookieValue(cookie)}>{isRevealed ? copy.hideCookieValue : copy.showCookieValue}</button>
                            <button type="button" className={styles.rowDeleteButton} onClick={() => void deleteCookie(cookie)}>{copy.deleteCookie}</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <button type="button" className={styles.dangerButton} disabled={!activeTabId || !activeUrl} onClick={() => void clearCurrentOriginStorage()}><strong>{copy.clearCurrentSite}</strong><span>{copy.clearCurrentSiteHint}</span></button>
                </div>
              </div>
            )}

            {section === 'site' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>{copy.site}</h2><p>{copy.siteLead}</p></div><button type="button" className={styles.secondaryButton} onClick={() => { void refreshPageInfo(); void refreshPageStorage() }}>{copy.refresh}</button></div>
                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}><span>{copy.security}</span><strong>{localizeTechnicalState(locale, securityState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.readyState}</span><strong>{localizeTechnicalState(locale, pageInfo?.readyState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.visibility}</span><strong>{localizeTechnicalState(locale, pageInfo?.visibilityState)}</strong></div>
                  <div className={styles.metricCard}><span>{copy.online}</span><strong>{pageInfo?.online === undefined ? '—' : pageInfo.online ? copy.yes : copy.no}</strong></div>
                  <div className={styles.metricCard}><span>{copy.cookieApi}</span><strong>{pageInfo?.cookieEnabled === undefined ? '—' : pageInfo.cookieEnabled ? copy.cookieApiAvailable : copy.cookieApiUnavailable}</strong></div>
                  <div className={styles.metricCard}><span>{copy.siteCookies}</span><strong>{cookies.length}</strong></div>
                  <div className={styles.metricCard}><span>{copy.nebulaCookiePolicy}</span><strong title={privacyState.strictCookies ? copy.strictPolicy : copy.standardPolicy}>{privacyState.strictCookies ? copy.strictPolicy : copy.standardPolicy}</strong></div>
                  <div className={styles.metricCard}><span>{copy.trackingPrevention}</span><strong>{trackingPreventionLabel}</strong></div>
                  <div className={styles.metricCard}><span>{copy.trackerBlocking}</span><strong>{privacyState.blockTrackers ? copy.enabled : copy.disabled}</strong></div>
                  <div className={styles.metricCard}><span>{copy.historyLength}</span><strong>{pageInfo?.historyLength ?? '—'}</strong></div>
                </div>
                <div className={styles.infoList}>
                  <div><span>{copy.title}</span><code>{pageInfo?.title ?? '—'}</code></div><div><span>{copy.origin}</span><code>{pageInfo?.origin ?? '—'}</code></div><div><span>{copy.language}</span><code>{pageInfo?.language ?? '—'}</code></div><div><span>{copy.charset}</span><code>{pageInfo?.charset ?? '—'}</code></div><div><span>{copy.referrer}</span><code>{pageInfo?.referrer || '—'}</code></div><div><span>{copy.viewport}</span><code>{pageInfo?.viewport ? `${pageInfo.viewport.width ?? '?'} × ${pageInfo.viewport.height ?? '?'} @ ${pageInfo.devicePixelRatio ?? 1}x` : '—'}</code></div>
                </div>
                <h3 className={styles.subheading}>{copy.permissions}</h3>
                <div className={styles.permissionGrid}>{Object.entries(pageInfo?.permissions ?? {}).map(([name, state]) => <div key={name} className={styles.permissionCard}><span>{name}</span><strong>{localizeTechnicalState(locale, state)}</strong></div>)}</div>
              </div>
            )}

            {section === 'sources' && activeTabId && (
              <div className={styles.sourcesWorkspace}>
                <aside className={styles.sourcesSidebar}>
                  <div className={styles.paneToolbar}>
                    <div className={styles.filterRow}><input value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} placeholder={copy.filterSources} /></div>
                    <label className={styles.toggleLabel}><input type="checkbox" checked={showAnonymousSources} onChange={(event) => setShowAnonymousSources(event.target.checked)} />{copy.showAnonymousSources}</label>
                    <span className={styles.toolbarStat}>{filteredSources.length} / {sourceEntries.length}</span>
                  </div>
                  <div className={styles.sourceList}>
                    {sourceGroups.map(([group, entries]) => (
                      <section key={group} className={styles.sourceGroup}>
                        <div className={styles.sourceGroupHeader}><span>{group}</span><small>{entries.length}</small></div>
                        {entries.map((source) => (
                          <button type="button" key={source.scriptId} className={source.scriptId === selectedScriptId ? styles.sourceRowSelected : styles.sourceRow} title={source.url} onClick={() => void selectScript(source.scriptId)}>
                            <span>{source.isModule ? 'M' : 'JS'}</span><code>{source.url}</code><small>{formatBytes(source.length)}</small>
                          </button>
                        ))}
                      </section>
                    ))}
                    {filteredSources.length === 0 && <div className={styles.emptyState}>{sourceEntries.length === 0 ? copy.noSources : copy.noSourceMatches}</div>}
                  </div>
                </aside>
                <section className={styles.sourceViewer}>
                  <div className={styles.paneToolbar}>
                    <strong>{copy.sourceCode}</strong>
                    <span className={styles.sourcePath}>{sourceEntries.find((item) => item.scriptId === selectedScriptId)?.url ?? '—'}</span>
                    <button type="button" className={styles.smallButton} disabled={!selectedScriptId} onClick={() => void copyText(scriptSource)}>{copy.copy}</button>
                  </div>
                  {selectedScriptId ? <pre className={styles.sourceCode}>{scriptSource}</pre> : <div className={styles.emptyState}>{sourceEntries.length ? copy.selectSource : copy.noSources}</div>}
                </section>
              </div>
            )}

            {section === 'accessibility' && activeTabId && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><h2>{copy.accessibility}</h2><p>{copy.accessibilityLead}</p></div><button type="button" className={styles.secondaryButton} onClick={() => void refreshAccessibility()}>{copy.refresh}</button></div>
                <div className={styles.accessibilityToolbar}>
                  <div className={styles.filterRow}><input value={accessibilityFilter} onChange={(event) => setAccessibilityFilter(event.target.value)} placeholder={copy.filterAccessibility} /></div>
                  <label className={styles.toggleLabel}><input type="checkbox" checked={showAccessibilityNoise} onChange={(event) => setShowAccessibilityNoise(event.target.checked)} />{copy.showAccessibilityNoise}</label>
                  <span className={styles.toolbarStat}>{filteredAccessibilityNodes.length} / {accessibilityNodes.length}</span>
                </div>
                <div className={styles.accessibilityList}>
                  {filteredAccessibilityNodes.map((node) => (
                    <button
                      type="button"
                      key={node.nodeId}
                      className={styles.accessibilityRow}
                      disabled={!node.backendDOMNodeId}
                      onClick={() => { if (node.backendDOMNodeId) { selectSection('elements'); void selectBackendNode(node.backendDOMNodeId) } }}
                    >
                      <span>{node.ignored ? 'ignored' : node.role?.value ?? 'unknown'}</span>
                      <strong>{node.name?.value || copy.empty}</strong>
                      <small>{node.description?.value ?? ''}</small>
                      <code>{node.backendDOMNodeId ? `DOM #${node.backendDOMNodeId}` : '—'}</code>
                    </button>
                  ))}
                  {filteredAccessibilityNodes.length === 0 && <div className={styles.emptyState}>{accessibilityNodes.length === 0 ? copy.noAccessibility : copy.noAccessibilityMatches}</div>}
                </div>
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
