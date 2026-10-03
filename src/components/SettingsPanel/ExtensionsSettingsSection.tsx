import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { EXTENSION_COPY, searchExtensionCatalog, type ExtensionCategory } from '../../core/extensionCatalog'
import { getIntlLocale } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import styles from './ExtensionsSettingsSection.module.css'
import { ExtensionInstallControls } from './ExtensionInstallControls'
import { ShellIsolationSettings } from './ShellIsolationSettings'
import { ExtensionCompatibilityDetails } from './ExtensionCompatibilityDetails'
import { extensionHostCopy } from '../../core/extensionHostCopy'
import { createExtensionCatalogStatus, type ExtensionCatalogStatus } from '../../core/extensionCatalogStatus'
import { extensionRuntimeVersion, installedExtensions, pendingActivations } from '../../platform/extensionDownload'
import type { ExtensionDownloadResult, ExtensionStatus } from '../../platform/extensionDownload'

export function ExtensionsSettingsSection({ onOpenBrowseUrl }: { onOpenBrowseUrl?: (url: string, options?: { activate?: boolean }) => void }) {
  const { locale, t } = useLocale()
  const copy = EXTENSION_COPY[locale]
  const hostCopy = extensionHostCopy(locale)
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ExtensionCategory | 'all'>('all')
  const [runtimeVersion, setRuntimeVersion] = useState<string>()
  const [downloads, setDownloads] = useState<Record<string, ExtensionDownloadResult>>({})
  const [{ statuses, failed: statusesFailed }, setStatusState] = useState<ExtensionCatalogStatus<ExtensionStatus>>({ statuses: null, failed: false })
  const statusController = useRef<ReturnType<typeof createExtensionCatalogStatus<ExtensionStatus>> | null>(null)
  useEffect(() => {
    let cancelled = false
    void extensionRuntimeVersion().then(version => { if (!cancelled) setRuntimeVersion(version) }).catch(() => { /* report remains unverified */ })
    const controller = createExtensionCatalogStatus(async () => {
      const [items, waiting] = await Promise.all([installedExtensions(), pendingActivations().catch(() => [])])
      const statuses: Record<string, ExtensionStatus> = Object.fromEntries(items.map(item => [item.id, { installed: true, enabled: item.enabled }]))
      // Packages that are ready but wait for Nebula's own screens to be separated, and starts that failed.
      for (const item of waiting) {
        if (statuses[item.id]) continue
        statuses[item.id] = { installed: item.action === 'enable', enabled: false, pendingActivation: item.action !== '', activationError: item.error }
      }
      return statuses
    }, setStatusState)
    statusController.current = controller
    const refresh = () => void controller.refresh()
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      controller.dispose()
      statusController.current = null
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const entries = searchExtensionCatalog(query, category, locale)
  const categories = ['all', 'privacy', 'appearance', 'productivity', 'media'] as const
  const numberFormat = new Intl.NumberFormat(getIntlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 })
  const reset = () => { setQuery(''); setCategory('all') }

  return (
    <>
    <ShellIsolationSettings />
    <section className={styles.explorer} aria-label={copy.title} data-extension-explorer="true">
      <div className={styles.hero}>
        <div className={styles.orbit} aria-hidden="true">✦</div>
        <h2>{copy.subtitle}</h2>
        <label className={styles.search} htmlFor={searchId}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input id={searchId} type="search" autoComplete="off" value={query}
            onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} />
          {query && <button type="button" aria-label={t('reset')} onClick={() => setQuery('')}>×</button>}
        </label>
      </div>
      <div className={styles.filters} role="group" aria-label={copy.title}>
        {categories.map((item) => <button type="button" key={item} data-extension-category={item} aria-pressed={item === category}
          onClick={() => setCategory(item)}>{item === 'all' ? copy.all : copy.categories[item]}</button>)}
      </div>
      <div className={styles.resultCount} role="status" aria-live="polite">{entries.length} {copy.results}</div>
      {statusesFailed && <p role="alert" className={styles.statusError}>{hostCopy.statusUnavailable}</p>}
      {entries.length ? <div className={styles.grid}>
        {entries.map((entry) => <article className={styles.card} key={entry.id} style={{ '--extension-color': entry.color } as CSSProperties}>
          <div className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">{entry.monogram}</span>
            <div><h3>{entry.name}</h3><span className={styles.category}>{copy.categories[entry.category]}</span></div>
          </div>
          <div className={styles.meta}>
            {entry.developer && <span title={entry.developer}>{entry.developer}</span>}
            {entry.users != null && <span>{numberFormat.format(entry.users)} {copy.users}</span>}
            {entry.rating != null && <span aria-label={`${entry.rating.toFixed(1)} / 5`}>★ {entry.rating.toFixed(1)}</span>}
          </div>
          <p>{entry.description}</p>
          <ExtensionCompatibilityDetails entry={entry} runtimeVersion={runtimeVersion} downloaded={downloads[entry.id]} />
          <a href={entry.website} target="_blank" rel="noopener noreferrer" onClick={(event) => {
            if (onOpenBrowseUrl) { event.preventDefault(); onOpenBrowseUrl(entry.website, { activate: true }) }
          }}>{copy.visit}<span aria-hidden="true">↗</span></a>
          <ExtensionInstallControls entry={entry} downloaded={downloads[entry.id]}
            knownStatus={statuses ? statuses[entry.id] ?? { installed: false, enabled: false } : undefined}
            onStatusChange={(status) => statusController.current?.setStatus(entry.id, status)}
            onDownloaded={(result) => setDownloads(current => ({ ...current, [entry.id]: result }))} />
        </article>)}
      </div> : <div className={styles.empty}>
        <span aria-hidden="true">⌕</span><p>{copy.empty}</p><button type="button" onClick={reset}>{copy.reset}</button>
      </div>}
    </section>
    </>
  )
}
