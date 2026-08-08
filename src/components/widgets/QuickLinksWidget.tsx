import { useState } from 'react'
import type { WidgetQuickLink } from '../../core/widgets'
import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function QuickLinksWidget({
  value,
  onChange,
  onNavigate,
}: {
  value: WidgetQuickLink[]
  onChange: (value: WidgetQuickLink[]) => void
  onNavigate: (url: string) => void
}) {
  const { t } = useLocale()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  const add = () => {
    if (value.length >= 12) return
    const normalized = normalizeUrl(url)
    if (!normalized) return
    const fallbackLabel = new URL(normalized).hostname.replace(/^www\./, '')
    onChange([...value, { id: crypto.randomUUID(), label: label.trim() || fallbackLabel, url: normalized }])
    setLabel('')
    setUrl('')
  }

  return (
    <div className={styles.quickLinks}>
      <div className={styles.quickLinksList}>
        {value.length === 0 && <span className={styles.widgetHint}>{t('quickLinksEmpty')}</span>}
        {value.map((link) => (
          <div key={link.id} className={styles.quickLinkRow}>
            <button type="button" className={styles.quickLinkOpen} onClick={() => onNavigate(link.url)} title={link.url}>
              <span className={styles.quickLinkIcon}>{link.label.trim().charAt(0).toUpperCase() || '↗'}</span>
              <span>{link.label || link.url}</span>
            </button>
            <button
              type="button"
              className={styles.quickLinkRemove}
              onClick={() => onChange(value.filter((item) => item.id !== link.id))}
              aria-label={t('quickLinksRemove')}
            >×</button>
          </div>
        ))}
      </div>
      <div className={styles.quickLinkForm}>
        <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={t('quickLinksLabelPlaceholder')} />
        <input
          value={url}
          maxLength={2_000}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder={t('quickLinksUrlPlaceholder')}
        />
        <button type="button" onClick={add} disabled={!url.trim() || value.length >= 12}>{t('quickLinksAdd')}</button>
      </div>
    </div>
  )
}
