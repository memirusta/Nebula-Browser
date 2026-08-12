import { useMemo, useRef, useState } from 'react'
import {
  entryMatchesHistoryFilters,
  type BrowserSessionSnapshot,
  type ClosedTabEntry,
  type HistoryEntry,
  type HistoryTimeFilter,
} from '../../core/browsingHistory'
import { showAppConfirmation } from '../../core/appDialog'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import styles from './HistoryPanel.module.css'

interface HistoryPanelProps {
  entries: HistoryEntry[]
  hosts: string[]
  closedTabs: ClosedTabEntry[]
  previousSession: BrowserSessionSnapshot | null
  variant: 'home' | 'browsing'
  browsingTop?: number
  onOpenUrl: (url: string, title?: string) => void
  onOpenClosedTab: (entry: ClosedTabEntry) => void
  onOpenPreviousSession: (session: BrowserSessionSnapshot) => void
  onRemoveEntry: (id: string) => void
  onClearFiltered: (filters: { query?: string; host?: string; time?: HistoryTimeFilter }) => void
  onClearAll: () => void
  onClearClosed: () => void
  onClose: () => void
}

function HistoryGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 9A8 8 0 1 1 4 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 4.5V9H9M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function HistoryPanel({
  entries,
  hosts,
  closedTabs,
  previousSession,
  variant,
  browsingTop = 220,
  onOpenUrl,
  onOpenClosedTab,
  onOpenPreviousSession,
  onRemoveEntry,
  onClearFiltered,
  onClearAll,
  onClearClosed,
  onClose,
}: HistoryPanelProps) {
  const { t, locale } = useLocale()
  const [query, setQuery] = useState('')
  const [host, setHost] = useState('all')
  const [time, setTime] = useState<HistoryTimeFilter>('all')
  const panelRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filteredEntries = useMemo(
    () => entries.filter((entry) => entryMatchesHistoryFilters(entry, { query, host, time })),
    [entries, host, query, time],
  )
  const groupedEntries = useMemo(() => {
    const groups: Array<{ key: string; timestamp: number; entries: HistoryEntry[] }> = []
    for (const entry of filteredEntries) {
      const key = dayKey(entry.visitedAt)
      const group = groups[groups.length - 1]
      if (!group || group.key !== key) groups.push({ key, timestamp: entry.visitedAt, entries: [entry] })
      else group.entries.push(entry)
    }
    return groups
  }, [filteredEntries])

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  )
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
    [locale],
  )
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [locale],
  )

  useDialogFocusTrap({ active: true, containerRef: panelRef, initialFocusRef: searchRef, onEscape: onClose })

  const filtersActive = !!query.trim() || host !== 'all' || time !== 'all'
  const previousSessionTabs = previousSession?.tabs ?? []

  return (
    <>
      <div className={styles.backdrop} style={{ zIndex: 10100 }} onClick={onClose} aria-hidden="true" />
      <section
        ref={panelRef}
        className={[styles.panel, variant === 'browsing' ? styles.panelBrowsing : styles.panelHome].join(' ')}
        style={
          variant === 'browsing'
            ? { top: browsingTop + 16, zIndex: 10101 }
            : { zIndex: 10101 }
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-dialog-title"
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.headingGlyph}><HistoryGlyph /></span>
            <div><span className={styles.eyebrow}>{t('historyEyebrow')}</span><h2 id="history-dialog-title">{t('historyTitle')}</h2></div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10m0-10L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className={styles.filters}>
          <label className={styles.searchBox}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('historySearchPlaceholder')} aria-label={t('historySearchPlaceholder')} />
          </label>
          <div className={styles.filterRow}>
            <select value={time} onChange={(event) => setTime(event.target.value as HistoryTimeFilter)} aria-label={t('historyTimeFilter')}>
              <option value="all">{t('historyAllTime')}</option>
              <option value="today">{t('historyToday')}</option>
              <option value="7d">{t('historyLast7Days')}</option>
              <option value="30d">{t('historyLast30Days')}</option>
            </select>
            <select value={host} onChange={(event) => setHost(event.target.value)} aria-label={t('historySiteFilter')}>
              <option value="all">{t('historyAllSites')}</option>
              {hosts.map((site) => <option key={site} value={site}>{site}</option>)}
            </select>
            {filteredEntries.length > 0 && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => {
                  const message = filtersActive ? t('historyConfirmClearFiltered') : t('historyConfirmClearAll')
                  void showAppConfirmation(message, t('historyTitle')).then((accepted) => {
                    if (!accepted) return
                    if (filtersActive) onClearFiltered({ query, host, time })
                    else onClearAll()
                  })
                }}
              >
                {filtersActive ? t('historyClearFiltered') : t('historyClearAll')}
              </button>
            )}
          </div>
        </div>

        <div className={styles.content}>
          {(closedTabs.length > 0 || previousSessionTabs.length > 0) && (
            <section className={styles.restoreSection}>
              <div className={styles.sectionHeader}><h3>{t('historyRestore')}</h3></div>
              {previousSessionTabs.length > 0 && (
                <button type="button" className={styles.sessionCard} onClick={() => previousSession && onOpenPreviousSession(previousSession)}>
                  <span className={styles.sessionIcon}><HistoryGlyph /></span>
                  <span className={styles.sessionText}>
                    <strong>{t('historyPreviousSession')}</strong>
                    <span>{t('historySessionTabs').replace('{n}', String(previousSessionTabs.length))} · {previousSession ? dateTimeFormatter.format(previousSession.savedAt) : ''}</span>
                  </span>
                  <span className={styles.openArrow}>↗</span>
                </button>
              )}
              {closedTabs.length > 0 && (
                <div className={styles.closedWrap}>
                  <div className={styles.closedHeader}>
                    <span>{t('historyRecentlyClosed')}</span>
                    <button type="button" onClick={onClearClosed}>{t('historyClearClosed')}</button>
                  </div>
                  <div className={styles.closedList}>
                    {closedTabs.slice(0, 6).map((entry) => (
                      <button key={entry.id} type="button" className={styles.closedItem} onClick={() => onOpenClosedTab(entry)} title={entry.url}>
                        {entry.favicon ? <img src={entry.favicon} alt="" /> : <span className={styles.faviconFallback}>{hostLabel(entry.url).slice(0, 1).toUpperCase()}</span>}
                        <span><strong>{entry.title}</strong><small>{hostLabel(entry.url)} · {dateTimeFormatter.format(entry.closedAt)}</small></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className={styles.historySection}>
            <div className={styles.sectionHeader}>
              <h3>{t('historyVisits')}</h3>
              <span>{filteredEntries.length}</span>
            </div>
            {filteredEntries.length === 0 ? (
              <div className={styles.empty}><span><HistoryGlyph /></span><strong>{query || host !== 'all' || time !== 'all' ? t('historyNoResults') : t('historyEmpty')}</strong><p>{t('historyEmptyHint')}</p></div>
            ) : (
              <div className={styles.groups}>
                {groupedEntries.map((group) => (
                  <div key={group.key} className={styles.dayGroup}>
                    <div className={styles.dayLabel}>{dayFormatter.format(group.timestamp)}</div>
                    {group.entries.map((entry) => (
                      <article key={entry.id} className={styles.historyItem}>
                        <button type="button" className={styles.itemMain} onClick={() => onOpenUrl(entry.url, entry.title)} title={entry.url}>
                          <span className={styles.time}>{timeFormatter.format(entry.visitedAt)}</span>
                          <span className={styles.itemBody}><strong>{entry.title}</strong><small>{entry.host}<span> · </span>{entry.url}</small></span>
                        </button>
                        <button type="button" className={styles.removeButton} onClick={() => onRemoveEntry(entry.id)} title={t('historyRemoveEntry')} aria-label={t('historyRemoveEntry')}>
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10m0-10L7 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                        </button>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  )
}
