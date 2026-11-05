import { useState } from 'react'
import { tf } from '../../core/locale'
import {
  availableKinds,
  chosenParts,
  offeredKinds,
  sourcesWithKinds,
  type BrowserChoices,
  type ImportKind,
  type ImportOffer,
} from '../../core/passwordImportSources'
import { useLocale } from '../../hooks/useLocale'
import type { BrowserImportSource } from '../../platform/browserImport'
import styles from './BrowserImport.module.css'
import { ImportLookupDetails } from './ImportLookupDetails'

interface BrowserSourceListProps {
  sources: readonly BrowserImportSource[]
  choices: BrowserChoices
  /** Which kinds of things this screen offers. */
  offer: ImportOffer
  onChoice: (browser: string, kind: ImportKind, checked: boolean) => void
  /** Ticks or unticks everything a browser can give. */
  onToggleBrowser: (browser: string, checked: boolean) => void
  disabled?: boolean
  /** Opens the CSV file picker (the way to bring Firefox's passwords over). */
  onRequestCsvImport?: () => void
}

/**
 * The browsers found on this computer. With both bookmarks and passwords on offer, each browser is a card: the
 * checkbox ticks everything it has, its name opens a box where bookmarks and passwords are chosen separately, and
 * under the name stands what will be taken. A browser with nothing ticked shows only its name.
 */
export function BrowserSourceList({
  sources,
  choices,
  offer,
  onChoice,
  onToggleBrowser,
  disabled = false,
  onRequestCsvImport,
}: BrowserSourceListProps) {
  const { locale, t } = useLocale()
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const rows = sourcesWithKinds(sources, offer)
  const csvOnly = offer.passwords && sources.some((source) => source.passwordsCsvOnly)
  const both = offer.bookmarks && offer.passwords

  if (rows.length === 0 && !csvOnly) {
    return (
      <>
        <p className={styles.hint}>{t('importNoBrowsers')}</p>
        {sources.length === 0 && <ImportLookupDetails />}
      </>
    )
  }

  const toggleOpen = (browser: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(browser)) next.delete(browser)
      else next.add(browser)
      return next
    })

  const summaryOf = (source: BrowserImportSource): string | null => {
    const parts = chosenParts(source, choices[source.browser], offer)
    if (parts.length === 0) return null
    const details = parts
      .map((part) =>
        part.kind === 'bookmarks'
          ? tf(locale, 'importBrowserBookmarks', { count: part.count ?? 0 })
          : part.count === null
            ? t('importPasswordsOption')
            : tf(locale, 'gsBrowserLogins', { count: part.count }),
      )
      .join(' · ')
    return tf(locale, 'importWillTake', { details })
  }

  return (
    <div className={styles.sourceList}>
      {rows.map((source) => {
        const choice = choices[source.browser] ?? { bookmarks: false, passwords: false }
        const kinds = offeredKinds(source, offer)
        const offeredCount = Number(kinds.bookmarks) + Number(kinds.passwords)
        const chosenCount = Number(choice.bookmarks && kinds.bookmarks) + Number(choice.passwords && kinds.passwords)
        const summary = summaryOf(source)
        const expanded = open.has(source.browser)

        // One kind on offer: a plain row, the checkbox is that kind.
        if (!both) {
          const kind: ImportKind = offer.bookmarks ? 'bookmarks' : 'passwords'
          return (
            <label key={source.browser} className={styles.sourceRow}>
              <input
                type="checkbox"
                checked={choice[kind] && kinds[kind]}
                onChange={(event) => onChoice(source.browser, kind, event.target.checked)}
                disabled={disabled || !kinds[kind]}
              />
              <span className={styles.sourceText}>
                <span>
                  {source.displayName}
                  {source.isDefault && <span className={styles.badge}>{t('gsBrowserDefault')}</span>}
                </span>
                {summary && <span className={styles.hint}>{summary}</span>}
              </span>
            </label>
          )
        }

        const available = availableKinds(source)
        return (
          <div key={source.browser} className={styles.sourceCard}>
            <div className={styles.sourceHead}>
              <input
                type="checkbox"
                aria-label={source.displayName}
                checked={chosenCount > 0}
                ref={(element) => {
                  if (element) element.indeterminate = chosenCount > 0 && chosenCount < offeredCount
                }}
                onChange={(event) => onToggleBrowser(source.browser, event.target.checked)}
                disabled={disabled || offeredCount === 0}
              />
              <button
                type="button"
                className={styles.nameButton}
                aria-expanded={expanded}
                onClick={() => toggleOpen(source.browser)}
              >
                <span>
                  {source.displayName}
                  {source.isDefault && <span className={styles.badge}>{t('gsBrowserDefault')}</span>}
                </span>
                <span className={expanded ? styles.chevronOpen : styles.chevron} aria-hidden="true">
                  ›
                </span>
              </button>
            </div>

            {summary && <div className={styles.sourceSummary}>{summary}</div>}

            {expanded && (
              <div className={styles.sourceOptions}>
                <label className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={choice.bookmarks && available.bookmarks}
                    onChange={(event) => onChoice(source.browser, 'bookmarks', event.target.checked)}
                    disabled={disabled || !available.bookmarks}
                  />
                  <span className={styles.choiceText}>
                    <span>
                      {t('importBookmarksOption')} ({source.bookmarkCount ?? 0})
                    </span>
                    <span className={styles.hint}>{t('importBookmarksHint')}</span>
                  </span>
                </label>

                {!source.passwordsCsvOnly && (
                  <label className={styles.choice}>
                    <input
                      type="checkbox"
                      checked={choice.passwords && available.passwords}
                      onChange={(event) => onChoice(source.browser, 'passwords', event.target.checked)}
                      disabled={disabled || !available.passwords}
                    />
                    <span className={styles.choiceText}>
                      <span>
                        {t('importPasswordsOption')}
                        {typeof source.loginCount === 'number'
                          ? ` (${source.loginCount})`
                          : source.passwordsDirect
                            ? ''
                            : ' (0)'}
                      </span>
                      <span className={styles.hint}>{t('importPasswordsHint')}</span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
        )
      })}

      {csvOnly && (
        <div className={styles.csvHint}>
          <span className={styles.hint}>{t('gsFirefoxCsvHint')}</span>
          {onRequestCsvImport && (
            <button type="button" className={styles.csvButton} onClick={onRequestCsvImport}>
              {t('gsCsvPick')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
