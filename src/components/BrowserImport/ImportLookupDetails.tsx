import { useEffect, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { browserImportDiagnostics, formatLookupDiagnostics } from '../../platform/browserImport'
import styles from './BrowserImport.module.css'

/**
 * Under "no browser found": where Nebula looked and what it saw there, so that the reason is on the screen
 * (and can be copied into a report) instead of being guessed at.
 */
export function ImportLookupDetails() {
  const { t } = useLocale()
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    browserImportDiagnostics()
      .then((report) => {
        if (!cancelled) setText(formatLookupDiagnostics(report))
      })
      .catch((error: unknown) => {
        if (!cancelled) setText(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (text === null) return null

  return (
    <details className={styles.details}>
      <summary>{t('importDetails')}</summary>
      <pre className={styles.detailsText}>{text}</pre>
    </details>
  )
}
