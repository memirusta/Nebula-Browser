import type { NebulaLocale } from './locale'
import packages from './extensionPackages.json' with { type: 'json' }
import discoveryCatalog from './extensionDiscoveryCatalog.json' with { type: 'json' }
import type { CompatibilityMetadata } from './extensionCompatibility'

export type ExtensionPackage = typeof packages[number]
export function extensionPackage(id: string): ExtensionPackage | undefined {
  return packages.find(entry => entry.id === id)
}

export type ExtensionCategory = 'privacy' | 'appearance' | 'productivity' | 'media'
export interface ExtensionCatalogEntry extends CompatibilityMetadata {
  id: string
  storeId?: string
  name: string
  category: ExtensionCategory
  website: string
  monogram: string
  color: string
  description?: string
  developer?: string | null
  version?: string
  users?: number
  rating?: number
  ratingCount?: number
  permissions?: readonly string[]
  hostPermissions?: readonly string[]
  hasBroadHostAccess?: boolean
  collectsData?: boolean
  updated?: string
}

/** Popular active MV3 listings cached from Crawlora; no API key ships with Nebula. */
const DISCOVERY_CATALOG: readonly ExtensionCatalogEntry[] = discoveryCatalog.entries.map(entry => ({
  ...entry,
  category: entry.category as ExtensionCategory,
}))
const FEATURED_IDS = ['bitwarden', 'dark-reader', 'sponsorblock', 'languagetool'] as const
const FEATURED_OVERRIDES: Partial<Record<typeof FEATURED_IDS[number], Partial<ExtensionCatalogEntry>>> = {
  bitwarden: {
    name: 'Bitwarden',
    website: 'https://bitwarden.com/download/',
    monogram: 'B',
    color: '#6da9ff',
  },
  languagetool: {
    name: 'LanguageTool',
    website: 'https://languagetool.org/',
    monogram: 'LT',
    color: '#bba0ff',
  },
}

export const EXTENSION_CATALOG_SOURCE = {
  source: discoveryCatalog.source,
  sourceUrl: discoveryCatalog.sourceUrl,
  fetchedAt: discoveryCatalog.fetchedAt,
  filters: discoveryCatalog.filters,
} as const

// New supported packages appear automatically, without another component or
// installer branch. Existing localized descriptions retain their stable IDs.
export const EXTENSION_CATALOG: readonly ExtensionCatalogEntry[] = [
  ...DISCOVERY_CATALOG.map(entry => {
    const featured = FEATURED_OVERRIDES[entry.id as typeof FEATURED_IDS[number]]
    const registered = extensionPackage(entry.id)
    return registered
      ? { ...entry, ...featured, ...registered.display, id: entry.id, category: registered.display.category as ExtensionCategory }
      : { ...entry, ...featured }
  }),
  ...packages.filter(entry => !DISCOVERY_CATALOG.some(known => known.id === entry.id))
    .map(entry => ({ id: entry.id, ...entry.display, category: entry.display.category as ExtensionCategory })),
]

interface ExtensionCopy {
  title: string
  subtitle: string
  search: string
  all: string
  categories: Record<ExtensionCategory, string>
  results: string
  empty: string
  reset: string
  visit: string
  users: string
  verified: string
  unverified: string
  descriptions: readonly [string, string, string, string]
}

export const EXTENSION_COPY: Record<NebulaLocale, ExtensionCopy> = {
  tr: {
    title: 'Eklentiler', subtitle: 'Tarayıcını sana göre genişlet.',
    search: 'Eklenti adı veya özellik ara…', all: 'Tümü', categories: { privacy: 'Gizlilik', appearance: 'Görünüm', productivity: 'Üretkenlik', media: 'Video ve medya' },
    results: 'eklenti', empty: 'Aramana uygun eklenti bulunamadı.', reset: 'Filtreleri temizle', visit: 'Resmi sayfayı aç', users: 'kullanıcı', verified: 'Nebula ile doğrulandı', unverified: 'Uyumluluk doğrulanmadı',
    descriptions: ['Şifrelerini yönet ve giriş bilgilerini otomatik doldur.', 'Web sitelerine karanlık bir görünüm kazandır.', 'YouTube videolarındaki sponsor bölümlerini atla.', 'Yazım, dil bilgisi ve üslup önerilerini keşfet.'],
  },
  en: {
    title: 'Extensions', subtitle: 'Make your browser your own.',
    search: 'Search extensions or features…', all: 'All', categories: { privacy: 'Privacy', appearance: 'Appearance', productivity: 'Productivity', media: 'Video & media' },
    results: 'extensions', empty: 'No extensions match your search.', reset: 'Clear filters', visit: 'Visit official website', users: 'users', verified: 'Verified with Nebula', unverified: 'Compatibility not verified',
    descriptions: ['Manage passwords and autofill your sign-in details.', 'Give websites a dark appearance.', 'Skip sponsored segments in YouTube videos.', 'Explore spelling, grammar and style suggestions.'],
  },
  de: {
    title: 'Erweiterungen', subtitle: 'Gestalte deinen Browser nach deinen Wünschen.',
    search: 'Erweiterungen oder Funktionen suchen…', all: 'Alle', categories: { privacy: 'Datenschutz', appearance: 'Darstellung', productivity: 'Produktivität', media: 'Video & Medien' },
    results: 'Erweiterungen', empty: 'Keine passenden Erweiterungen gefunden.', reset: 'Filter löschen', visit: 'Offizielle Website öffnen', users: 'Nutzer', verified: 'Mit Nebula geprüft', unverified: 'Kompatibilität ungeprüft',
    descriptions: ['Passwörter verwalten und Anmeldedaten automatisch ausfüllen.', 'Websites mit dunklem Erscheinungsbild nutzen.', 'Sponsorensegmente in YouTube-Videos überspringen.', 'Vorschläge zu Rechtschreibung, Grammatik und Stil entdecken.'],
  },
  es: {
    title: 'Extensiones', subtitle: 'Personaliza tu navegador.',
    search: 'Buscar extensiones o funciones…', all: 'Todas', categories: { privacy: 'Privacidad', appearance: 'Apariencia', productivity: 'Productividad', media: 'Vídeo y multimedia' },
    results: 'extensiones', empty: 'No se encontraron extensiones.', reset: 'Borrar filtros', visit: 'Abrir sitio oficial', users: 'usuarios', verified: 'Verificada con Nebula', unverified: 'Compatibilidad sin verificar',
    descriptions: ['Gestiona contraseñas y completa tus credenciales.', 'Da un aspecto oscuro a los sitios web.', 'Salta los segmentos patrocinados en YouTube.', 'Descubre sugerencias de ortografía, gramática y estilo.'],
  },
  fr: {
    title: 'Extensions', subtitle: 'Personnalisez votre navigateur.',
    search: 'Rechercher une extension ou fonction…', all: 'Toutes', categories: { privacy: 'Confidentialité', appearance: 'Apparence', productivity: 'Productivité', media: 'Vidéo et médias' },
    results: 'extensions', empty: 'Aucune extension ne correspond à votre recherche.', reset: 'Effacer les filtres', visit: 'Ouvrir le site officiel', users: 'utilisateurs', verified: 'Vérifiée avec Nebula', unverified: 'Compatibilité non vérifiée',
    descriptions: ['Gérez vos mots de passe et remplissez vos identifiants.', 'Donnez aux sites web une apparence sombre.', 'Ignorez les segments sponsorisés sur YouTube.', 'Découvrez des suggestions d’orthographe, de grammaire et de style.'],
  },
  id: {
    title: 'Ekstensi', subtitle: 'Sesuaikan browser dengan kebutuhanmu.',
    search: 'Cari ekstensi atau fitur…', all: 'Semua', categories: { privacy: 'Privasi', appearance: 'Tampilan', productivity: 'Produktivitas', media: 'Video & media' },
    results: 'ekstensi', empty: 'Tidak ada ekstensi yang cocok.', reset: 'Hapus filter', visit: 'Buka situs resmi', users: 'pengguna', verified: 'Terverifikasi dengan Nebula', unverified: 'Kompatibilitas belum diverifikasi',
    descriptions: ['Kelola kata sandi dan isi detail login otomatis.', 'Ubah tampilan situs menjadi gelap.', 'Lewati segmen sponsor dalam video YouTube.', 'Temukan saran ejaan, tata bahasa, dan gaya tulisan.'],
  },
  ru: {
    title: 'Расширения', subtitle: 'Настройте браузер под себя.',
    search: 'Поиск расширений или функций…', all: 'Все', categories: { privacy: 'Приватность', appearance: 'Внешний вид', productivity: 'Продуктивность', media: 'Видео и медиа' },
    results: 'расширений', empty: 'Подходящих расширений нет.', reset: 'Сбросить фильтры', visit: 'Открыть официальный сайт', users: 'пользователей', verified: 'Проверено с Nebula', unverified: 'Совместимость не проверена',
    descriptions: ['Управляйте паролями и автоматически заполняйте данные входа.', 'Используйте тёмное оформление сайтов.', 'Пропускайте спонсорские сегменты в видео YouTube.', 'Проверяйте орфографию, грамматику и стиль текста.'],
  },
  it: {
    title: 'Estensioni', subtitle: 'Rendi il browser davvero tuo.',
    search: 'Cerca estensioni o funzioni…', all: 'Tutte', categories: { privacy: 'Privacy', appearance: 'Aspetto', productivity: 'Produttività', media: 'Video e media' },
    results: 'estensioni', empty: 'Nessuna estensione corrisponde alla ricerca.', reset: 'Cancella filtri', visit: 'Apri il sito ufficiale', users: 'utenti', verified: 'Verificata con Nebula', unverified: 'Compatibilità non verificata',
    descriptions: ['Gestisci le password e compila i dati di accesso.', 'Dai ai siti web un aspetto scuro.', 'Salta i segmenti sponsorizzati nei video YouTube.', 'Scopri suggerimenti di ortografia, grammatica e stile.'],
  },
  ja: {
    title: '拡張機能', subtitle: 'ブラウザーを自分らしく。',
    search: '拡張機能や機能を検索…', all: 'すべて', categories: { privacy: 'プライバシー', appearance: '外観', productivity: '生産性', media: '動画・メディア' },
    results: '件の拡張機能', empty: '一致する拡張機能はありません。', reset: 'フィルターを解除', visit: '公式サイトを開く', users: 'ユーザー', verified: 'Nebulaで検証済み', unverified: '互換性未検証',
    descriptions: ['パスワードを管理し、ログイン情報を自動入力。', 'ウェブサイトをダーク表示に。', 'YouTube動画のスポンサー部分をスキップ。', 'スペル、文法、文体の提案を確認。'],
  },
}

export function searchExtensionCatalog(query: string, category: ExtensionCategory | 'all', locale: NebulaLocale) {
  const copy = EXTENSION_COPY[locale]
  const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale).replace(/ı/g, 'i')
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  return EXTENSION_CATALOG.map((entry) => ({ ...entry, description: copy.descriptions[FEATURED_IDS.indexOf(entry.id as typeof FEATURED_IDS[number])] ?? entry.description ?? entry.name }))
    .filter((entry) => (category === 'all' || entry.category === category) &&
      terms.every((term) => normalize(`${entry.name} ${entry.developer ?? ''} ${entry.description} ${copy.categories[entry.category]}`).includes(term)))
}
