import { useCallback, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { openDefaultBrowserSettings } from '../../platform/defaultBrowser'
import { isTauri } from '../../platform/runtime'
import styles from './OnboardingWizard.module.css'

export function OnboardingDefaultBrowserStep() {
  const { t } = useLocale()

  const [error, setError] =
    useState<string | null>(null)

  const handleOpen = useCallback(async () => {
    setError(null)

    try {
      await openDefaultBrowserSettings()
    } catch (reason) {
      if (import.meta.env.DEV) {
        console.warn(
          '[nebula] failed to open default-browser settings',
          reason,
        )
      }

      setError(
        t('defaultBrowserOpenFailed'),
      )
    }
  }, [t])

  return (
    <>
      <h2 className={styles.title}>
        {t('defaultBrowserTitle')}
      </h2>

      <p className={styles.lead}>
        {t('defaultBrowserLead')}
      </p>

      {isTauri ? (
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void handleOpen()}
        >
          {t('defaultBrowserOpen')}
        </button>
      ) : (
        <p className={styles.hint}>
          {t('defaultBrowserDesktopOnly')}
        </p>
      )}

      {error && (
        <p className={styles.error}>
          {error}
        </p>
      )}
    </>
  )
}