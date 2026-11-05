import { useCallback, useState } from 'react'
import { getLocaleCopy } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { openDefaultBrowserSettings } from '../../platform/defaultBrowser'
import { isTauri } from '../../platform/runtime'
import { OnboardingActions } from './OnboardingActions'
import { ONBOARDING_COPY } from './onboardingCopy'
import styles from './OnboardingWizard.module.css'

interface OnboardingDefaultBrowserStepProps {
  /** The footer of the wizard, where this screen puts its buttons. */
  footer: HTMLElement | null
  onBack: () => void
  onContinue: () => void
}

export function OnboardingDefaultBrowserStep({
  footer,
  onBack,
  onContinue,
}: OnboardingDefaultBrowserStepProps) {
  const { locale, t } = useLocale()
  const copy = getLocaleCopy(ONBOARDING_COPY, locale)

  const [error, setError] =
    useState<string | null>(null)

  const [opened, setOpened] = useState(false)

  const handleOpen = useCallback(async () => {
    setError(null)

    try {
      await openDefaultBrowserSettings()
      setOpened(true)
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
    <div className={styles.defaultStep}>
      <div className={styles.markBadge} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      </div>

      <h1 id="onboarding-title" className={styles.title}>
        {t('defaultBrowserTitle')}
      </h1>

      <p className={styles.lead}>
        {t('defaultBrowserLead')}
      </p>

      {!isTauri && (
        <p className={styles.hint}>
          {t('defaultBrowserDesktopOnly')}
        </p>
      )}

      {error && (
        <p className={styles.error}>
          {error}
        </p>
      )}

      {/* Windows asks for the confirmation itself, so opening its settings is the main action; once that is
          done (or when it can't be done here) the way on is the main one. */}
      <OnboardingActions
        slot={footer}
        onBack={onBack}
        secondary={
          isTauri && !opened
            ? { label: copy.notNow, onClick: onContinue }
            : undefined
        }
        primary={
          isTauri && !opened
            ? {
                label: t('defaultBrowserOpen'),
                onClick: () => void handleOpen(),
              }
            : { label: t('continue'), onClick: onContinue }
        }
      />
    </div>
  )
}
