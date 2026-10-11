import { assessExtensionCompatibility, assessExtensionManifest } from '../../core/extensionCompatibility'
import { extensionCompatibilityCopy } from '../../core/extensionCompatibilityCopy'
import { extensionPackage, type ExtensionCatalogEntry } from '../../core/extensionCatalog'
import type { ExtensionDownloadResult } from '../../platform/extensionDownload'
import { extensionDownloadCheckCopy } from '../../core/extensionDownloadCheckCopy'
import { useLocale } from '../../hooks/useLocale'
import styles from './ExtensionsSettingsSection.module.css'

export function ExtensionCompatibilityDetails({ entry, runtimeVersion, downloaded }: {
  entry: ExtensionCatalogEntry
  runtimeVersion?: string
  downloaded?: ExtensionDownloadResult
}) {
  const { locale } = useLocale()
  const copy = extensionCompatibilityCopy(locale)
  const checkCopy = extensionDownloadCheckCopy(locale)
  const report = downloaded ? assessExtensionManifest(downloaded.compatibility.manifest, downloaded.compatibility.runtimeVersion) : assessExtensionCompatibility(entry, runtimeVersion)
  const registered = extensionPackage(entry.id)
  const compatibility = downloaded?.compatibility
  const passed = compatibility?.loadTest === 'passed'
  return <details className={styles.compatibilityReport} data-extension-compatibility={entry.id}>
    <summary><span data-state={passed ? 'tested' : report.status}>{passed ? checkCopy.passed : copy[report.status]}</span><span>{copy.title}</span></summary>
    <p>{passed ? checkCopy.scope : copy.explanation}</p>
    <div>{copy.version}: {downloaded?.version ?? entry.version ?? '—'}</div>
    {registered && <div>{copy.package}: {registered.version}</div>}
    {compatibility && <>
      <div>WebView2: {compatibility.runtimeVersion}</div>
      <div>SHA-256: {compatibility.sha256}</div>
    </>}
    <ul>{report.issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
      {copy.issue(issue.code)}{issue.optional && ` (${copy.optional})`}
      {issue.details.length > 0 && <small>{issue.details.join(', ')}</small>}
    </li>)}</ul>
  </details>
}
