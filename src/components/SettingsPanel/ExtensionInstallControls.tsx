import { useRef, useState } from 'react'
import { extensionInstallCopy } from '../../core/extensionInstallCopy'
import { extensionHostCopy } from '../../core/extensionHostCopy'
import { useLocale } from '../../hooks/useLocale'
import { manageExtension, downloadExtension, type ExtensionStatus, type ExtensionDownloadResult } from '../../platform/extensionDownload'
import { extensionPackage, type ExtensionCatalogEntry } from '../../core/extensionCatalog'
import { EXTENSION_DOWNLOAD_COPY } from '../../core/extensionDownloadCopy'
import { extensionDownloadCheckCopy } from '../../core/extensionDownloadCheckCopy'
import { assessExtensionManifest, isKnownGap } from '../../core/extensionCompatibility'
import { extensionCompatibilityCopy } from '../../core/extensionCompatibilityCopy'
import { isTauri } from '../../platform/runtime'
import { shellIsolationCopy } from '../../core/shellIsolationCopy'
import { offerIsolationForExtension } from '../../platform/extensionIsolation'
import styles from './ExtensionsSettingsSection.module.css'

export function ExtensionInstallControls({ entry, downloaded, knownStatus, onStatusChange, onDownloaded }: {
  entry: ExtensionCatalogEntry
  downloaded?: ExtensionDownloadResult
  knownStatus?: ExtensionStatus
  onStatusChange?: (status: ExtensionStatus) => void
  onDownloaded?: (result: ExtensionDownloadResult) => void
}) {
  const id = entry.id
  const extension = extensionPackage(id)
  const { locale } = useLocale()
  const copy = extensionInstallCopy(locale)
  const hostCopy = extensionHostCopy(locale)
  const isolationCopy = shellIsolationCopy(locale)
  const [reviewing, setReviewing] = useState(false)
  const downloadCopy = EXTENSION_DOWNLOAD_COPY[locale]
  const checkCopy = extensionDownloadCheckCopy(locale)
  const reportCopy = extensionCompatibilityCopy(locale)
  const [download, setDownload] = useState<{ status: 'idle' | 'pending' | 'saved' | 'failed'; result?: ExtensionDownloadResult; error?: string }>(
    downloaded ? { status: 'saved', result: downloaded } : { status: 'idle' },
  )
  const manifestReport = download.result && assessExtensionManifest(download.result.compatibility.manifest, download.result.compatibility.runtimeVersion)
  const manifestStrings = (key: string) => {
    const values = download.result?.compatibility.manifest[key]
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string').join(', ') : '—'
  }
  const downloadLock = useRef(false)
  const startDownload = async () => {
    if (downloadLock.current || !isTauri) return
    downloadLock.current = true
    setDownload({ status: 'pending' })
    try {
      const result = await downloadExtension(id)
      setDownload({ status: 'saved', result })
      onDownloaded?.(result)
      return result
    } catch (error) { setDownload({ status: 'failed', error: error instanceof Error ? error.message : String(error) }) }
    finally { downloadLock.current = false }
  }
  const [mutatedStatus, setMutatedStatus] = useState<ExtensionStatus | null>(null)
  // In the catalog, profile refreshes own the status. A local result must not
  // mask a later enable/disable/removal from another window.
  const status = onStatusChange ? knownStatus ?? null : mutatedStatus ?? knownStatus ?? null
  const [pending, setPending] = useState<'install' | 'remove' | 'enable' | null>(null)
  const [failed, setFailed] = useState(false)
  const [failureMessage, setFailureMessage] = useState('')
  const checking = isTauri && !status
  const mutation = useRef(false)

  const run = async (action: 'install' | 'remove' | 'enable') => {
    if (mutation.current || downloadLock.current || !isTauri) return
    mutation.current = true
    setPending(action)
    setFailed(false)
    setFailureMessage('')
    try {
      const value = await manageExtension(id, action, download.result?.compatibility.sha256)
      setMutatedStatus(value)
      onStatusChange?.(value)
      setReviewing(false)
      // The package is ready but may only start once Nebula's own screens are separated from
      // it: offer the switch (restart) instead of reporting a failure.
      if (value.pendingActivation) void offerIsolationForExtension()
      else if (action === 'install' && !value.enabled) setFailed(true)
    } catch (error) {
      setFailed(true)
      setFailureMessage(error instanceof Error ? error.message : String(error))
      // An operation may complete after a timeout; ask WebView2 rather than
      // assuming that a failed response means it was rolled back.
      try {
        const value = await manageExtension(id, 'status')
        setMutatedStatus(value)
        onStatusChange?.(value)
      } catch { /* keep last known status */ }
    } finally {
      mutation.current = false
      setPending(null)
    }
  }

  const requestInstall = async () => {
    if (mutation.current || downloadLock.current) return
    if (status?.installed) { void run('enable'); return }
    if (extension) { void run('install'); return }
    const result = download.result ?? await startDownload()
    if (result) setReviewing(true)
  }

  return <div className={styles.install}>
    <>
      <div className={styles.installActions}>
        {status?.pendingActivation
          ? <button type="button" data-extension-restart={id} disabled={!!pending} onClick={() => void offerIsolationForExtension()}>{isolationCopy.extensionRestart}</button>
          : status?.installed && status.enabled
          ? <span className={styles.installed}>{copy.installed}</span>
          : <button type="button" data-extension-install={id} disabled={!isTauri || checking || !!pending || download.status === 'pending' || reviewing}
            onClick={() => void requestInstall()}>{checking ? copy.checking : pending === 'install' ? copy.installing : status?.installed ? copy.enable : copy.install}</button>}
        {(status?.installed || status?.pendingActivation) && <button type="button" disabled={!!pending || download.status === 'pending'} onClick={() => void run('remove')}>
          {pending === 'remove' ? copy.removing : copy.remove}
        </button>}
      </div>
      <div className={styles.downloadStatus} role="status" aria-live="polite">
        {failed ? <>{copy.failed}{failureMessage && <span>{failureMessage}</span>}</> : status?.pendingActivation ? isolationCopy.extensionWaiting : status?.activationError ? <>{isolationCopy.activationFailed}<span>{status.activationError}</span></> : status?.enabled ? extension ? copy.reload : hostCopy.separateSession : extension ? <>{copy.access}: {extension.access.map(pattern => pattern === '*://*/*' || pattern === '<all_urls>' ? copy.allSites : pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '')).join(', ')}</> : null}
      </div>
    </>
    {reviewing && download.result && <section className={styles.compatibilityReport} aria-label={hostCopy.review} data-extension-review={id}>
      <h4>{hostCopy.review} · {download.result.version}</h4>
      <p>{hostCopy.separateSession}</p>
      <p>{hostCopy.loadOnly}</p><p>{hostCopy.limited}</p>
      <strong>{hostCopy.permissions}</strong>
      <p>{manifestStrings('permissions') || '—'}</p>
      <strong>{copy.access}</strong>
      <p>{manifestStrings('host_permissions') || '—'}</p>
      {manifestReport && manifestReport.issues.some(isKnownGap) && <>
        <strong data-extension-gaps={id}>{reportCopy.gapsHeading}</strong>
        <ul>{manifestReport.issues.filter(isKnownGap).map((issue, index) => <li key={index}>{reportCopy.issue(issue.code)}<small>{issue.details.join(', ')}</small></li>)}</ul>
      </>}
      {manifestReport && <ul>{manifestReport.issues.filter(issue => !isKnownGap(issue)).map((issue, index) => <li key={index}>{reportCopy.issue(issue.code)}<small>{issue.details.join(', ')}</small></li>)}</ul>}
      <div className={styles.installActions}>
        <button type="button" disabled={!!pending} onClick={() => void run('install')}>{pending ? copy.installing : copy.install}</button>
        <button type="button" disabled={!!pending} onClick={() => setReviewing(false)}>{hostCopy.cancel}</button>
      </div>
    </section>}
    <div className={styles.download}>
      <button type="button" data-extension-download={id} disabled={!isTauri || !!pending || reviewing || download.status === 'pending'}
        title={!isTauri ? downloadCopy.desktop : undefined} onClick={() => void startDownload()}>
        {download.status === 'pending' ? checkCopy.pending : downloadCopy.download}
      </button>
      <span className={styles.package}>{download.result?.version ?? extension?.version ?? entry.version ?? '—'} · {extension ? 'ZIP' : 'Chrome Web Store'}</span>
      <div role="status" aria-live="polite" className={styles.downloadStatus}>
        {download.status === 'saved' && <>{checkCopy.passed}<span>{download.result?.path}</span></>}
        {download.status === 'failed' && <>{checkCopy.failed}<span>{download.error}</span></>}
      </div>
      {download.result && manifestReport && <details className={styles.compatibilityReport} data-extension-download-report={id}>
        <summary>{reportCopy.title} · {download.result.version}</summary>
        <p>{checkCopy.scope}</p>
        <div>WebView2: {download.result.compatibility.runtimeVersion}</div>
        <ul>{manifestReport.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>
          {reportCopy.issue(issue.code)}{issue.optional && ` (${reportCopy.optional})`}
          <small>{issue.details.join(', ')}</small>
        </li>)}</ul>
      </details>}
    </div>
  </div>
}
