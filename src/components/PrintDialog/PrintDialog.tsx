import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  renderBrowsePrintPreview,
  listBrowsePrinters,
  type BrowsePrinterInfo,
  type BrowsePrintOptions,
} from '../../platform/tauriBrowser'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { useLocale } from '../../hooks/useLocale'
import { getLocaleCopy } from '../../core/locale'
import styles from './PrintDialog.module.css'

interface PrintDialogProps {
  webviewLabel: string
  title: string
  url: string
  onCancel: () => void
  onPrint: (options: BrowsePrintOptions) => Promise<void>
}

const PAGE_RANGE_PATTERN =
  /^\s*\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\s*$/

const COPY = {
  tr: {
    brand: 'NEBULA YAZDIR',
    print: 'Yazdır',
    close: 'Yazdırma penceresini kapat',
    untitled: 'Adsız sayfa',
    destination: 'Hedef',
    windowsDefault: 'Windows varsayılan yazıcısı',
    selectedPrinter: 'Seçili yazıcı',
    usesSystemDefault: 'Geçerli sistem varsayılanını kullanır',
    findingPrinters: 'Yüklü yazıcılar aranıyor…',
    printerDestination: 'Yazıcı hedefi',
    useSystemDefault: 'Geçerli sistem varsayılanını kullan',
    systemDefault: 'Sistem varsayılanı',
    installedPrinter: 'Yüklü yazıcı',
    noPrinters: 'Windows yüklü yazıcı döndürmedi.',
    copies: 'Kopya',
    layout: 'Yönlendirme',
    portrait: 'Dikey',
    landscape: 'Yatay',
    paperSize: 'Kağıt boyutu',
    a4: 'A4',
    letter: 'Letter',
    margins: 'Kenar boşlukları',
    defaultMargins: 'Normal',
    minimumMargins: 'Dar',
    noMargins: 'Yok',
    pages: 'Sayfalar',
    all: 'Tümü',
    custom: 'Özel',
    rangePlaceholder: 'örn. 1-3, 5, 8-10',
    rangeInvalid: '1-3, 5 gibi sayfa numaraları veya aralıklar kullan.',
    scale: 'Ölçek',
    more: 'Diğer ayarlar',
    backgrounds: 'Arka plan grafikleri',
    backgroundsHint: 'Sayfa renklerini ve arka plan görsellerini yazdır',
    headers: 'Üstbilgi ve altbilgi',
    headersHint: 'Sayfa başlığı, URL ve sayfa numarasını ekle',
    selectionOnly: 'Yalnızca seçim',
    selectionOnlyHint: 'Yalnızca seçili sayfa içeriğini yazdır',
    printingFailed: 'Yazdırma başarısız.',
    cancel: 'İptal',
    sending: 'Gönderiliyor…',
    preview: 'Baskı önizlemesi',
    previewLoading: 'Önizleme hazırlanıyor…',
    previewUnavailable: 'Canlı önizleme alınamadı.',
    previewNote: 'WebView2 tarafından oluşturulan gerçek baskı sayfaları. Sayfa aralığı ve baskı ayarları önizlemeye uygulanır.',
  },
  en: {
    brand: 'NEBULA PRINT',
    print: 'Print',
    close: 'Close print dialog',
    untitled: 'Untitled page',
    destination: 'Destination',
    windowsDefault: 'Windows default printer',
    selectedPrinter: 'Selected printer',
    usesSystemDefault: 'Uses your current system default',
    findingPrinters: 'Finding installed printers…',
    printerDestination: 'Printer destination',
    useSystemDefault: 'Use the current system default',
    systemDefault: 'System default',
    installedPrinter: 'Installed printer',
    noPrinters: 'No installed printers were returned by Windows.',
    copies: 'Copies',
    layout: 'Layout',
    portrait: 'Portrait',
    landscape: 'Landscape',
    paperSize: 'Paper size',
    a4: 'A4',
    letter: 'Letter',
    margins: 'Margins',
    defaultMargins: 'Default',
    minimumMargins: 'Narrow',
    noMargins: 'None',
    pages: 'Pages',
    all: 'All',
    custom: 'Custom',
    rangePlaceholder: 'e.g. 1-3, 5, 8-10',
    rangeInvalid: 'Use page numbers or ranges such as 1-3, 5.',
    scale: 'Scale',
    more: 'More settings',
    backgrounds: 'Background graphics',
    backgroundsHint: 'Print page colors and background images',
    headers: 'Headers and footers',
    headersHint: 'Include page title, URL and page number',
    selectionOnly: 'Selection only',
    selectionOnlyHint: 'Print only selected page content',
    printingFailed: 'Printing failed.',
    cancel: 'Cancel',
    sending: 'Sending…',
    preview: 'Print preview',
    previewLoading: 'Preparing preview…',
    previewUnavailable: 'Live preview is unavailable.',
    previewNote: 'Real print pages rendered by WebView2. Page ranges and print settings are applied to the preview.',
  },
  es: {
    brand: 'IMPRIMIR CON NEBULA',
    print: 'Imprimir',
    close: 'Cerrar el diálogo de impresión',
    untitled: 'Página sin título',
    destination: 'Destino',
    windowsDefault: 'Impresora predeterminada de Windows',
    selectedPrinter: 'Impresora seleccionada',
    usesSystemDefault: 'Utiliza la impresora predeterminada actual del sistema',
    findingPrinters: 'Buscando impresoras instaladas…',
    printerDestination: 'Destino de impresión',
    useSystemDefault: 'Usar la impresora predeterminada del sistema',
    systemDefault: 'Predeterminada del sistema',
    installedPrinter: 'Impresora instalada',
    noPrinters: 'Windows no devolvió ninguna impresora instalada.',
    copies: 'Copias',
    layout: 'Orientación',
    portrait: 'Vertical',
    landscape: 'Horizontal',
    paperSize: 'Tamaño del papel',
    a4: 'A4',
    letter: 'Carta',
    margins: 'Márgenes',
    defaultMargins: 'Predeterminados',
    minimumMargins: 'Estrechos',
    noMargins: 'Ninguno',
    pages: 'Páginas',
    all: 'Todas',
    custom: 'Personalizado',
    rangePlaceholder: 'p. ej., 1-3, 5, 8-10',
    rangeInvalid: 'Usa números o intervalos de páginas, como 1-3, 5.',
    scale: 'Escala',
    more: 'Más ajustes',
    backgrounds: 'Gráficos de fondo',
    backgroundsHint: 'Imprimir los colores y las imágenes de fondo de la página',
    headers: 'Encabezados y pies de página',
    headersHint: 'Incluir el título, la URL y el número de página',
    selectionOnly: 'Solo la selección',
    selectionOnlyHint: 'Imprimir únicamente el contenido seleccionado',
    printingFailed: 'La impresión falló.',
    cancel: 'Cancelar',
    sending: 'Enviando…',
    preview: 'Vista previa de impresión',
    previewLoading: 'Preparando la vista previa…',
    previewUnavailable: 'La vista previa en directo no está disponible.',
    previewNote: 'Páginas de impresión reales generadas por WebView2. El intervalo de páginas y los ajustes se aplican a la vista previa.',
  },
  de: {
    brand: 'MIT NEBULA DRUCKEN',
    print: 'Drucken',
    close: 'Druckdialog schließen',
    untitled: 'Unbenannte Seite',
    destination: 'Ziel',
    windowsDefault: 'Windows-Standarddrucker',
    selectedPrinter: 'Ausgewählter Drucker',
    usesSystemDefault: 'Verwendet den aktuellen Standarddrucker des Systems',
    findingPrinters: 'Installierte Drucker werden gesucht…',
    printerDestination: 'Druckziel',
    useSystemDefault: 'Standarddrucker des Systems verwenden',
    systemDefault: 'Systemstandard',
    installedPrinter: 'Installierter Drucker',
    noPrinters: 'Windows hat keine installierten Drucker zurückgegeben.',
    copies: 'Kopien',
    layout: 'Ausrichtung',
    portrait: 'Hochformat',
    landscape: 'Querformat',
    paperSize: 'Papierformat',
    a4: 'A4',
    letter: 'Letter',
    margins: 'Ränder',
    defaultMargins: 'Standard',
    minimumMargins: 'Schmal',
    noMargins: 'Keine',
    pages: 'Seiten',
    all: 'Alle',
    custom: 'Benutzerdefiniert',
    rangePlaceholder: 'z. B. 1-3, 5, 8-10',
    rangeInvalid: 'Verwende Seitenzahlen oder Bereiche wie 1-3, 5.',
    scale: 'Skalierung',
    more: 'Weitere Einstellungen',
    backgrounds: 'Hintergrundgrafiken',
    backgroundsHint: 'Seitenfarben und Hintergrundbilder drucken',
    headers: 'Kopf- und Fußzeilen',
    headersHint: 'Seitentitel, URL und Seitenzahl einschließen',
    selectionOnly: 'Nur Auswahl',
    selectionOnlyHint: 'Nur den ausgewählten Seiteninhalt drucken',
    printingFailed: 'Drucken fehlgeschlagen.',
    cancel: 'Abbrechen',
    sending: 'Wird gesendet…',
    preview: 'Druckvorschau',
    previewLoading: 'Vorschau wird vorbereitet…',
    previewUnavailable: 'Die Live-Vorschau ist nicht verfügbar.',
    previewNote: 'Von WebView2 gerenderte echte Druckseiten. Seitenbereiche und Druckeinstellungen werden auf die Vorschau angewendet.',
  },
  fr: {
    brand: 'IMPRIMER AVEC NEBULA',
    print: 'Imprimer',
    close: 'Fermer la boîte de dialogue d’impression',
    untitled: 'Page sans titre',
    destination: 'Destination',
    windowsDefault: 'Imprimante par défaut de Windows',
    selectedPrinter: 'Imprimante sélectionnée',
    usesSystemDefault: 'Utilise l’imprimante par défaut actuelle du système',
    findingPrinters: 'Recherche des imprimantes installées…',
    printerDestination: 'Destination d’impression',
    useSystemDefault: 'Utiliser l’imprimante par défaut du système',
    systemDefault: 'Valeur par défaut du système',
    installedPrinter: 'Imprimante installée',
    noPrinters: 'Windows n’a renvoyé aucune imprimante installée.',
    copies: 'Copies',
    layout: 'Orientation',
    portrait: 'Portrait',
    landscape: 'Paysage',
    paperSize: 'Format du papier',
    a4: 'A4',
    letter: 'Lettre',
    margins: 'Marges',
    defaultMargins: 'Par défaut',
    minimumMargins: 'Étroites',
    noMargins: 'Aucune',
    pages: 'Pages',
    all: 'Toutes',
    custom: 'Personnalisé',
    rangePlaceholder: 'p. ex. 1-3, 5, 8-10',
    rangeInvalid: 'Utilisez des numéros ou plages de pages, comme 1-3, 5.',
    scale: 'Échelle',
    more: 'Plus de paramètres',
    backgrounds: 'Graphiques d’arrière-plan',
    backgroundsHint: 'Imprimer les couleurs et images d’arrière-plan de la page',
    headers: 'En-têtes et pieds de page',
    headersHint: 'Inclure le titre, l’URL et le numéro de page',
    selectionOnly: 'Sélection uniquement',
    selectionOnlyHint: 'Imprimer uniquement le contenu sélectionné',
    printingFailed: 'Échec de l’impression.',
    cancel: 'Annuler',
    sending: 'Envoi…',
    preview: 'Aperçu avant impression',
    previewLoading: 'Préparation de l’aperçu…',
    previewUnavailable: 'L’aperçu en direct n’est pas disponible.',
    previewNote: 'Pages d’impression réelles rendues par WebView2. Les plages de pages et paramètres d’impression sont appliqués à l’aperçu.',
  },
  id: {
    brand: 'CETAK DENGAN NEBULA',
    print: 'Cetak',
    close: 'Tutup dialog cetak',
    untitled: 'Halaman tanpa judul',
    destination: 'Tujuan',
    windowsDefault: 'Printer bawaan Windows',
    selectedPrinter: 'Printer terpilih',
    usesSystemDefault: 'Menggunakan printer bawaan sistem saat ini',
    findingPrinters: 'Mencari printer yang terpasang…',
    printerDestination: 'Tujuan printer',
    useSystemDefault: 'Gunakan printer bawaan sistem saat ini',
    systemDefault: 'Bawaan sistem',
    installedPrinter: 'Printer terpasang',
    noPrinters: 'Windows tidak mengembalikan printer terpasang.',
    copies: 'Salinan',
    layout: 'Orientasi',
    portrait: 'Potret',
    landscape: 'Lanskap',
    paperSize: 'Ukuran kertas',
    a4: 'A4',
    letter: 'Letter',
    margins: 'Margin',
    defaultMargins: 'Bawaan',
    minimumMargins: 'Sempit',
    noMargins: 'Tidak ada',
    pages: 'Halaman',
    all: 'Semua',
    custom: 'Kustom',
    rangePlaceholder: 'mis. 1-3, 5, 8-10',
    rangeInvalid: 'Gunakan nomor atau rentang halaman seperti 1-3, 5.',
    scale: 'Skala',
    more: 'Setelan lainnya',
    backgrounds: 'Grafis latar belakang',
    backgroundsHint: 'Cetak warna halaman dan gambar latar belakang',
    headers: 'Header dan footer',
    headersHint: 'Sertakan judul halaman, URL, dan nomor halaman',
    selectionOnly: 'Hanya pilihan',
    selectionOnlyHint: 'Cetak hanya konten halaman yang dipilih',
    printingFailed: 'Pencetakan gagal.',
    cancel: 'Batal',
    sending: 'Mengirim…',
    preview: 'Pratinjau cetak',
    previewLoading: 'Menyiapkan pratinjau…',
    previewUnavailable: 'Pratinjau langsung tidak tersedia.',
    previewNote: 'Halaman cetak asli dirender oleh WebView2. Rentang halaman dan setelan cetak diterapkan pada pratinjau.',
  },
  ru: {
    brand: 'ПЕЧАТЬ NEBULA',
    print: 'Печать',
    close: 'Закрыть диалог печати',
    untitled: 'Страница без названия',
    destination: 'Принтер',
    windowsDefault: 'Принтер Windows по умолчанию',
    selectedPrinter: 'Выбранный принтер',
    usesSystemDefault: 'Используется текущий принтер системы по умолчанию',
    findingPrinters: 'Поиск установленных принтеров…',
    printerDestination: 'Принтер назначения',
    useSystemDefault: 'Использовать текущий системный принтер по умолчанию',
    systemDefault: 'Системный по умолчанию',
    installedPrinter: 'Установленный принтер',
    noPrinters: 'Windows не вернула список установленных принтеров.',
    copies: 'Копии',
    layout: 'Ориентация',
    portrait: 'Книжная',
    landscape: 'Альбомная',
    paperSize: 'Размер бумаги',
    a4: 'A4',
    letter: 'Letter',
    margins: 'Поля',
    defaultMargins: 'По умолчанию',
    minimumMargins: 'Узкие',
    noMargins: 'Без полей',
    pages: 'Страницы',
    all: 'Все',
    custom: 'Диапазон',
    rangePlaceholder: 'например, 1-3, 5, 8-10',
    rangeInvalid: 'Укажите номера или диапазоны страниц, например 1-3, 5.',
    scale: 'Масштаб',
    more: 'Дополнительные настройки',
    backgrounds: 'Фоновая графика',
    backgroundsHint: 'Печатать цвета страницы и фоновые изображения',
    headers: 'Колонтитулы',
    headersHint: 'Включить заголовок страницы, URL и номер страницы',
    selectionOnly: 'Только выделенное',
    selectionOnlyHint: 'Печатать только выделенное содержимое страницы',
    printingFailed: 'Не удалось напечатать.',
    cancel: 'Отмена',
    sending: 'Отправка…',
    preview: 'Предварительный просмотр',
    previewLoading: 'Подготовка предпросмотра…',
    previewUnavailable: 'Предварительный просмотр недоступен.',
    previewNote: 'Реальные страницы печати, подготовленные WebView2. Диапазон и параметры печати применяются к предпросмотру.',
  },
  it: {
    brand: 'STAMPA NEBULA',
    print: 'Stampa',
    close: 'Chiudi finestra di stampa',
    untitled: 'Pagina senza titolo',
    destination: 'Destinazione',
    windowsDefault: 'Stampante predefinita di Windows',
    selectedPrinter: 'Stampante selezionata',
    usesSystemDefault: 'Usa la stampante attualmente predefinita nel sistema',
    findingPrinters: 'Ricerca delle stampanti installate…',
    printerDestination: 'Destinazione stampante',
    useSystemDefault: 'Usa la stampante predefinita del sistema',
    systemDefault: 'Predefinita di sistema',
    installedPrinter: 'Stampante installata',
    noPrinters: 'Windows non ha restituito stampanti installate.',
    copies: 'Copie',
    layout: 'Orientamento',
    portrait: 'Verticale',
    landscape: 'Orizzontale',
    paperSize: 'Formato carta',
    a4: 'A4',
    letter: 'Letter',
    margins: 'Margini',
    defaultMargins: 'Predefiniti',
    minimumMargins: 'Minimi',
    noMargins: 'Nessuno',
    pages: 'Pagine',
    all: 'Tutte',
    custom: 'Personalizzate',
    rangePlaceholder: 'es. 1-3, 5, 8-10',
    rangeInvalid: 'Usa numeri di pagina o intervalli, ad esempio 1-3, 5.',
    scale: 'Scala',
    more: 'Altre impostazioni',
    backgrounds: 'Grafica di sfondo',
    backgroundsHint: 'Stampa colori e immagini di sfondo della pagina',
    headers: 'Intestazioni e piè di pagina',
    headersHint: 'Includi titolo della pagina, URL e numero di pagina',
    selectionOnly: 'Solo selezione',
    selectionOnlyHint: 'Stampa solo il contenuto selezionato nella pagina',
    printingFailed: 'Stampa non riuscita.',
    cancel: 'Annulla',
    sending: 'Invio…',
    preview: 'Anteprima di stampa',
    previewLoading: 'Preparazione anteprima…',
    previewUnavailable: 'Anteprima non disponibile.',
    previewNote: 'Pagine di stampa reali generate da WebView2. L’intervallo di pagine e le impostazioni di stampa vengono applicati all’anteprima.',
  },
  ja: {
    brand: 'NEBULA 印刷',
    print: '印刷',
    close: '印刷ダイアログを閉じる',
    untitled: '無題のページ',
    destination: '送信先',
    windowsDefault: 'Windows の既定のプリンター',
    selectedPrinter: '選択中のプリンター',
    usesSystemDefault: '現在のシステム既定プリンターを使用',
    findingPrinters: 'インストール済みプリンターを検索中…',
    printerDestination: 'プリンターの送信先',
    useSystemDefault: '現在のシステム既定プリンターを使用',
    systemDefault: 'システム既定',
    installedPrinter: 'インストール済みプリンター',
    noPrinters: 'Windows からインストール済みプリンターを取得できませんでした。',
    copies: '部数',
    layout: '印刷の向き',
    portrait: '縦',
    landscape: '横',
    paperSize: '用紙サイズ',
    a4: 'A4',
    letter: 'Letter',
    margins: '余白',
    defaultMargins: '既定',
    minimumMargins: '最小',
    noMargins: 'なし',
    pages: 'ページ',
    all: 'すべて',
    custom: '指定',
    rangePlaceholder: '例: 1-3, 5, 8-10',
    rangeInvalid: '1-3, 5 のようにページ番号または範囲を指定してください。',
    scale: '倍率',
    more: 'その他の設定',
    backgrounds: '背景のグラフィック',
    backgroundsHint: 'ページの色と背景画像を印刷',
    headers: 'ヘッダーとフッター',
    headersHint: 'ページタイトル、URL、ページ番号を含める',
    selectionOnly: '選択範囲のみ',
    selectionOnlyHint: 'ページで選択した内容のみ印刷',
    printingFailed: '印刷できませんでした。',
    cancel: 'キャンセル',
    sending: '送信中…',
    preview: '印刷プレビュー',
    previewLoading: 'プレビューを準備中…',
    previewUnavailable: 'プレビューを利用できません。',
    previewNote: 'WebView2 が生成した実際の印刷ページです。ページ範囲と印刷設定はプレビューに反映されます。',
  },
} as const

function displayHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function PrintDialog({
  webviewLabel,
  title,
  url,
  onCancel,
  onPrint,
}: PrintDialogProps) {
  const { locale } = useLocale()
  const copy = getLocaleCopy(COPY, locale)
  const [printers, setPrinters] =
    useState<BrowsePrinterInfo[]>([])
  const [printerName, setPrinterName] =
    useState('')
  const [destinationOpen, setDestinationOpen] =
    useState(false)
  const [printersLoading, setPrintersLoading] =
    useState(true)

  const [pageMode, setPageMode] =
    useState<'all' | 'custom'>('all')
  const [pageRanges, setPageRanges] =
    useState('')
  const [orientation, setOrientation] =
    useState<'portrait' | 'landscape'>('portrait')
  const [paperSize, setPaperSize] =
    useState<'a4' | 'letter'>('a4')
  const [margins, setMargins] =
    useState<'default' | 'minimum' | 'none'>('default')
  const [copies, setCopies] =
    useState(1)
  const [scale, setScale] =
    useState(100)
  const [backgrounds, setBackgrounds] =
    useState(true)
  const [headersAndFooters, setHeadersAndFooters] =
    useState(false)
  const [selectionOnly, setSelectionOnly] =
    useState(false)
  const [busy, setBusy] =
    useState(false)
  const [error, setError] =
    useState<string | null>(null)
  const [previewPdf, setPreviewPdf] =
    useState<string | null>(null)
  const [previewLoading, setPreviewLoading] =
    useState(true)
  const previewEpochRef = useRef(0)
  const dialogRef = useRef<HTMLElement>(null)
  useModalFocusTrap(dialogRef)

  useEffect(() => {
    let disposed = false

    void listBrowsePrinters()
      .then((items) => {
        if (disposed) return
        setPrinters(items)
      })
      .finally(() => {
        if (disposed) return
        setPrintersLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [])

  const defaultPrinter =
    printers.find(
      (printer) =>
        printer.isDefault,
    ) ?? null

  const selectedPrinter =
    printerName
      ? printers.find(
          (printer) =>
            printer.name ===
            printerName,
        ) ?? null
      : null

  const destinationTitle =
    selectedPrinter?.name ??
    defaultPrinter?.name ??
    copy.windowsDefault

  const destinationSubtitle =
    printerName
      ? copy.selectedPrinter
      : defaultPrinter
        ? copy.windowsDefault
        : copy.usesSystemDefault

  const customRangeInvalid =
    pageMode === 'custom' &&
    (
      !pageRanges.trim() ||
      !PAGE_RANGE_PATTERN.test(
        pageRanges,
      )
    )

  const paperClass = useMemo(
    () =>
      orientation === 'landscape'
        ? styles.paperLandscape
        : styles.paperPortrait,
    [orientation],
  )

  useEffect(() => {
    const epoch = previewEpochRef.current + 1
    previewEpochRef.current = epoch
    if (customRangeInvalid) {
      setPreviewPdf(null)
      setPreviewLoading(false)
      return
    }

    setPreviewLoading(true)
    const timer = window.setTimeout(() => {
      void renderBrowsePrintPreview(
        webviewLabel,
        {
          printerName,
          pageRanges:
            pageMode === 'custom'
              ? pageRanges.trim()
              : '',
          landscape: orientation === 'landscape',
          copies,
          scale: scale / 100,
          backgrounds,
          headersAndFooters,
          selectionOnly,
          paperSize,
          margins,
        },
      )
        .then((pdf) => {
          if (previewEpochRef.current !== epoch) return
          setPreviewPdf(pdf)
        })
        .finally(() => {
          if (previewEpochRef.current !== epoch) return
          setPreviewLoading(false)
        })
    }, 350)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    backgrounds,
    copies,
    customRangeInvalid,
    headersAndFooters,
    margins,
    orientation,
    pageMode,
    pageRanges,
    paperSize,
    printerName,
    scale,
    selectionOnly,
    webviewLabel,
  ])

  const submit = async () => {
    if (
      busy ||
      customRangeInvalid
    ) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await onPrint({
        printerName,
        pageRanges:
          pageMode === 'custom'
            ? pageRanges.trim()
            : '',
        landscape:
          orientation === 'landscape',
        copies:
          Math.max(
            1,
            Math.min(
              99,
              Math.round(copies),
            ),
          ),
        scale:
          Math.max(
            10,
            Math.min(
              200,
              Math.round(scale),
            ),
          ) / 100,
        backgrounds,
        headersAndFooters,
        selectionOnly,
        paperSize,
        margins,
      })
    } catch (printError) {
      console.error('[nebula print] print failed', printError)
      setBusy(false)
      setError(copy.printingFailed)
    }
  }
  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget &&
          !busy
        ) {
          onCancel()
        }
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nebula-print-title"
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !busy
          ) {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <div className={styles.settingsPane}>
          <header className={styles.header}>
            <div className={styles.printMark}>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 8V3h12v5H6Zm10-2V5H8v1h8ZM6 19H4a2 2 0 0 1-2-2v-6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v6a2 2 0 0 1-2 2h-2v2H6v-2Zm10 0v-5H8v5h8Zm3-8.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
              </svg>
            </div>

            <div className={styles.heading}>
              <span>{copy.brand}</span>
              <h2 id="nebula-print-title">
                {copy.print}
              </h2>
            </div>

            <button
              type="button"
              className={styles.closeButton}
              onClick={onCancel}
              disabled={busy}
              aria-label={copy.close}
            >
              ×
            </button>
          </header>

          <div className={styles.document}>
            <strong>{title || copy.untitled}</strong>
            <span>{displayHost(url)}</span>
          </div>

          <div className={styles.field}>
            <label>{copy.destination}</label>

            <div className={styles.destinationWrap}>
              <button
                type="button"
                className={styles.destination}
                onClick={() =>
                  setDestinationOpen(
                    (open) => !open,
                  )
                }
                aria-haspopup="listbox"
                aria-expanded={destinationOpen}
              >
                <span className={styles.destinationIcon}>
                  ◈
                </span>

                <div className={styles.destinationText}>
                  <strong>
                    {destinationTitle}
                  </strong>
                  <span>
                    {printersLoading
                      ? copy.findingPrinters
                      : destinationSubtitle}
                  </span>
                </div>

                <span
                  className={styles.destinationChevron}
                  aria-hidden="true"
                >
                  {destinationOpen
                    ? '⌃'
                    : '⌄'}
                </span>
              </button>

              {destinationOpen && (
                <div
                  className={styles.destinationMenu}
                  role="listbox"
                  aria-label={copy.printerDestination}
                >
                  <button
                    type="button"
                    className={[
                      styles.destinationOption,
                      printerName === ''
                        ? styles.destinationOptionActive
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      setPrinterName('')
                      setDestinationOpen(false)
                    }}
                    role="option"
                    aria-selected={
                      printerName === ''
                    }
                  >
                    <span className={styles.optionMark}>
                      {printerName === ''
                        ? '✓'
                        : ''}
                    </span>
                    <span>
                      <strong>
                        {copy.windowsDefault}
                      </strong>
                      <small>
                        {defaultPrinter?.name ??
                          copy.useSystemDefault}
                      </small>
                    </span>
                  </button>

                  {printers.map(
                    (printer) => (
                      <button
                        key={printer.name}
                        type="button"
                        className={[
                          styles.destinationOption,
                          printerName ===
                          printer.name
                            ? styles.destinationOptionActive
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setPrinterName(
                            printer.name,
                          )
                          setDestinationOpen(
                            false,
                          )
                        }}
                        role="option"
                        aria-selected={
                          printerName ===
                          printer.name
                        }
                      >
                        <span className={styles.optionMark}>
                          {printerName ===
                          printer.name
                            ? '✓'
                            : ''}
                        </span>
                        <span>
                          <strong>
                            {printer.name}
                          </strong>
                          <small>
                            {printer.isDefault
                              ? copy.systemDefault
                              : copy.installedPrinter}
                          </small>
                        </span>
                      </button>
                    ),
                  )}

                  {!printersLoading &&
                    printers.length === 0 && (
                      <div className={styles.destinationEmpty}>
                        {copy.noPrinters}
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>

          <div className={styles.twoColumn}>
            <div className={styles.field}>
              <label htmlFor="nebula-print-copies">
                {copy.copies}
              </label>
              <input
                id="nebula-print-copies"
                className={styles.input}
                type="number"
                min={1}
                max={99}
                value={copies}
                onChange={(event) =>
                  setCopies(
                    Number(
                      event.target.value,
                    ) || 1,
                  )
                }
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="nebula-print-orientation">
                {copy.layout}
              </label>
              <select
                id="nebula-print-orientation"
                className={styles.input}
                value={orientation}
                onChange={(event) =>
                  setOrientation(
                    event.target.value as
                      | 'portrait'
                      | 'landscape',
                  )
                }
              >
                <option value="portrait">
                  {copy.portrait}
                </option>
                <option value="landscape">
                  {copy.landscape}
                </option>
              </select>
            </div>
          </div>

          <div className={styles.twoColumn}>
            <div className={styles.field}>
              <label htmlFor="nebula-print-paper-size">
                {copy.paperSize}
              </label>
              <select
                id="nebula-print-paper-size"
                className={styles.input}
                value={paperSize}
                onChange={(event) =>
                  setPaperSize(
                    event.target.value as
                      | 'a4'
                      | 'letter',
                  )
                }
              >
                <option value="a4">{copy.a4}</option>
                <option value="letter">{copy.letter}</option>
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="nebula-print-margins">
                {copy.margins}
              </label>
              <select
                id="nebula-print-margins"
                className={styles.input}
                value={margins}
                onChange={(event) =>
                  setMargins(
                    event.target.value as
                      | 'default'
                      | 'minimum'
                      | 'none',
                  )
                }
              >
                <option value="default">{copy.defaultMargins}</option>
                <option value="minimum">{copy.minimumMargins}</option>
                <option value="none">{copy.noMargins}</option>
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label>{copy.pages}</label>
            <div className={styles.segmented}>
              <button
                type="button"
                className={
                  pageMode === 'all'
                    ? styles.segmentActive
                    : ''
                }
                onClick={() =>
                  setPageMode('all')
                }
              >
                {copy.all}
              </button>
              <button
                type="button"
                className={
                  pageMode === 'custom'
                    ? styles.segmentActive
                    : ''
                }
                onClick={() =>
                  setPageMode('custom')
                }
              >
                {copy.custom}
              </button>
            </div>

            {pageMode === 'custom' && (
              <>
                <input
                  className={styles.input}
                  value={pageRanges}
                  onChange={(event) =>
                    setPageRanges(
                      event.target.value,
                    )
                  }
                  placeholder={copy.rangePlaceholder}
                  aria-invalid={
                    customRangeInvalid
                  }
                  autoFocus
                />
                {customRangeInvalid && (
                  <span className={styles.validation}>
                    {copy.rangeInvalid}
                  </span>
                )}
              </>
            )}
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor="nebula-print-scale">
                {copy.scale}
              </label>
              <span>{scale}%</span>
            </div>

            <input
              id="nebula-print-scale"
              className={styles.range}
              type="range"
              min={50}
              max={200}
              step={5}
              value={scale}
              onChange={(event) =>
                setScale(
                  Number(
                    event.target.value,
                  ),
                )
              }
            />
          </div>

          <details className={styles.more}>
            <summary>{copy.more}</summary>

            <label className={styles.toggleRow}>
              <span>
                <strong>{copy.backgrounds}</strong>
                <small>
                  {copy.backgroundsHint}
                </small>
              </span>
              <input
                type="checkbox"
                checked={backgrounds}
                onChange={(event) =>
                  setBackgrounds(
                    event.target.checked,
                  )
                }
              />
            </label>

            <label className={styles.toggleRow}>
              <span>
                <strong>{copy.headers}</strong>
                <small>
                  {copy.headersHint}
                </small>
              </span>
              <input
                type="checkbox"
                checked={headersAndFooters}
                onChange={(event) =>
                  setHeadersAndFooters(
                    event.target.checked,
                  )
                }
              />
            </label>

            <label className={styles.toggleRow}>
              <span>
                <strong>{copy.selectionOnly}</strong>
                <small>
                  {copy.selectionOnlyHint}
                </small>
              </span>
              <input
                type="checkbox"
                checked={selectionOnly}
                onChange={(event) =>
                  setSelectionOnly(
                    event.target.checked,
                  )
                }
              />
            </label>
          </details>

          {error && (
            <div
              className={styles.error}
              role="alert"
            >
              {error}
            </div>
          )}

          <footer className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={onCancel}
              disabled={busy}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                void submit()
              }}
              disabled={
                busy ||
                customRangeInvalid
              }
            >
              {busy
                ? copy.sending
                : copy.print}
            </button>
          </footer>
        </div>

        <div className={styles.previewPane}>
          <div className={styles.previewTop}>
            <span>{copy.preview}</span>
            <small>
              {orientation === 'landscape'
                ? copy.landscape
                : copy.portrait} · {paperSize === 'a4' ? copy.a4 : copy.letter} · {scale}%
            </small>
          </div>

          <div className={styles.previewStage}>
            {previewPdf ? (
              <iframe
                className={styles.previewDocument}
                src={`${previewPdf}#toolbar=0&navpanes=0&view=FitH`}
                title={copy.preview}
              />
            ) : (
              <div
                className={[
                  styles.paper,
                  paperClass,
                ].join(' ')}
              >
                <div className={styles.paperHeader}>
                  <strong>{title || copy.untitled}</strong>
                  <span>{displayHost(url)}</span>
                </div>

                <div className={styles.paperContent}>
                  <div
                    className={styles.previewFallback}
                    aria-busy={previewLoading}
                  >
                    <div className={styles.previewHero} />
                    <div className={styles.previewLineLong} />
                    <div className={styles.previewLine} />
                    <div className={styles.previewLine} />
                    <div className={styles.previewGrid}>
                      <span />
                      <span />
                    </div>
                    <div className={styles.previewLineLong} />
                    <div className={styles.previewLine} />
                    <span className={styles.previewStatus}>
                      {previewLoading
                        ? copy.previewLoading
                        : copy.previewUnavailable}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className={styles.previewNote}>
            {copy.previewNote}
          </p>
        </div>
      </section>
    </div>,
    document.body,
  )
}
