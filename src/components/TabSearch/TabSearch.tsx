import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserTab } from '../../core/browserTab'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useLocale } from '../../hooks/useLocale'
import styles from './TabSearch.module.css'

interface TabSearchProps {
  tabs: BrowserTab[]
  activeTabId: string | null
  onSelect: (shortcutId: string) => void
  onCloseTab: (shortcutId: string) => void
  onToggleMute: (shortcutId: string) => void
  onClose: () => void
}

function searchableTabText(tab: BrowserTab): string {
  let host = ''
  try {
    host = new URL(tab.url).hostname
  } catch {
    host = ''
  }
  return `${tab.title} ${tab.url} ${host}`.toLocaleLowerCase()
}

export function TabSearch({
  tabs,
  activeTabId,
  onSelect,
  onCloseTab,
  onToggleMute,
  onClose,
}: TabSearchProps) {
  const { locale } = useLocale()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredTabs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return tabs
    return tabs.filter((tab) => searchableTabText(tab).includes(normalized))
  }, [query, tabs])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useDialogFocusTrap({
    active: true,
    containerRef: panelRef,
    initialFocusRef: inputRef,
    onEscape: onClose,
  })

  const selectTab = (shortcutId: string) => {
    onSelect(shortcutId)
    onClose()
  }

  return (
    <>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label={locale === 'tr' ? 'Sekme aramasını kapat' : 'Close tab search'}
      />
      <section
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={locale === 'tr' ? 'Sekmelerde ara' : 'Search tabs'}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && filteredTabs.length > 0) {
            event.preventDefault()
            setSelectedIndex((index) => (index + 1) % filteredTabs.length)
          } else if (event.key === 'ArrowUp' && filteredTabs.length > 0) {
            event.preventDefault()
            setSelectedIndex(
              (index) => (index - 1 + filteredTabs.length) % filteredTabs.length,
            )
          } else if (event.key === 'Enter') {
            const tab = filteredTabs[selectedIndex]
            if (tab) {
              event.preventDefault()
              selectTab(tab.shortcutId)
            }
          }
        }}
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>NEBULA TABS</span>
            <h2>{locale === 'tr' ? 'Sekmelerde ara' : 'Search tabs'}</h2>
          </div>
          <kbd>Ctrl Shift A</kbd>
        </header>

        <label className={styles.search}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={locale === 'tr' ? 'Başlık veya adres ara…' : 'Search title or address…'}
            aria-label={locale === 'tr' ? 'Sekme ara' : 'Search tabs'}
          />
        </label>

        <div className={styles.results} role="listbox">
          {filteredTabs.length === 0 ? (
            <div className={styles.empty}>
              {locale === 'tr' ? 'Eşleşen açık sekme yok.' : 'No matching open tabs.'}
            </div>
          ) : (
            filteredTabs.map((tab, index) => (
              <div
                key={tab.shortcutId}
                className={[
                  styles.result,
                  index === selectedIndex ? styles.resultSelected : '',
                  tab.shortcutId === activeTabId ? styles.resultActive : '',
                ].filter(Boolean).join(' ')}
                role="option"
                aria-selected={index === selectedIndex}
                onPointerEnter={() => setSelectedIndex(index)}
              >
                <button
                  type="button"
                  className={styles.resultMain}
                  onClick={() => selectTab(tab.shortcutId)}
                >
                  <span className={styles.favicon}>
                    {tab.favicon ? <img src={tab.favicon} alt="" /> : tab.title.slice(0, 1)}
                  </span>
                  <span className={styles.resultText}>
                    <strong>{tab.title}</strong>
                    <span>{tab.url}</span>
                  </span>
                  {tab.shortcutId === activeTabId && (
                    <span className={styles.activeBadge}>
                      {locale === 'tr' ? 'Açık' : 'Active'}
                    </span>
                  )}
                </button>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={tab.isMuted ? styles.muted : ''}
                    onClick={() => onToggleMute(tab.shortcutId)}
                    title={tab.isMuted
                      ? locale === 'tr' ? 'Sesi aç' : 'Unmute'
                      : locale === 'tr' ? 'Sekmeyi sustur' : 'Mute tab'}
                    aria-label={tab.isMuted
                      ? locale === 'tr' ? 'Sesi aç' : 'Unmute'
                      : locale === 'tr' ? 'Sekmeyi sustur' : 'Mute tab'}
                  >
                    {tab.isMuted ? '🔇' : '🔊'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCloseTab(tab.shortcutId)}
                    title={locale === 'tr' ? 'Sekmeyi kapat' : 'Close tab'}
                    aria-label={locale === 'tr' ? 'Sekmeyi kapat' : 'Close tab'}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  )
}
