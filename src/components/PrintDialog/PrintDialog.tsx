import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  listBrowsePrinters,
  type BrowsePrinterInfo,
  type BrowsePrintOptions,
} from '../../platform/tauriBrowser'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { useLocale } from '../../hooks/useLocale'
import styles from './PrintDialog.module.css'

interface PrintDialogProps {
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
    preview: 'Yerleşim önizlemesi',
    previewNote: 'Bu yalnızca yerleşim önizlemesidir. Sayfanın kendisini WebView2 yazdırma için oluşturur.',
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
    preview: 'Layout preview',
    previewNote: 'Layout preview only. The page itself is rendered for print by WebView2.',
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
  title,
  url,
  onCancel,
  onPrint,
}: PrintDialogProps) {
  const { locale } = useLocale()
  const copy = COPY[locale]
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
                : copy.portrait} · {scale}%
            </small>
          </div>

          <div className={styles.previewStage}>
            <div
              className={[
                styles.paper,
                paperClass,
              ].join(' ')}
              style={{
                '--preview-scale':
                  String(
                    Math.min(
                      1,
                      Math.max(
                        0.52,
                        scale / 100,
                      ),
                    ),
                  ),
              } as React.CSSProperties}
            >
              <div className={styles.paperHeader}>
                <strong>
                  {title || copy.untitled}
                </strong>
                <span>
                  {displayHost(url)}
                </span>
              </div>

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

              {headersAndFooters && (
                <div className={styles.paperFooter}>
                  <span>{displayHost(url)}</span>
                  <span>1</span>
                </div>
              )}
            </div>
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
