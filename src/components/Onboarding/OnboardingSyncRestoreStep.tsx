import { useCallback, useState } from 'react'
import { applyGoogleSyncRestore } from '../../core/googleSyncRestore'
import type { NebulaSyncBundleV1 } from '../../core/googleSync'
import {
  saveNebulaAccount,
  type NebulaAccount,
} from '../../core/nebulaAccount'
import {
  markOnboardingRestored,
  saveOnboardingResumeStep,
} from '../../core/onboarding'
import { getLocaleCopy } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { OnboardingActions } from './OnboardingActions'
import { ONBOARDING_COPY } from './onboardingCopy'
import styles from './OnboardingWizard.module.css'

interface OnboardingSyncRestoreStepProps {
  /** The footer of the wizard, where this screen puts its buttons. */
  footer: HTMLElement | null
  email: string
  account: NebulaAccount | null
  /** The backup that was found for this account while the profile screen was open. */
  bundle: NebulaSyncBundleV1
  needsPassword: boolean
  onBack: () => void
  onContinue: () => void
}

/**
 * Shown only when the Google account has a Nebula Sync backup. Restoring writes the synced settings, so the
 * app reloads once and the wizard resumes on the import screen.
 */
export function OnboardingSyncRestoreStep({
  footer,
  email,
  account,
  bundle,
  needsPassword,
  onBack,
  onContinue,
}: OnboardingSyncRestoreStepProps) {
  const { locale, t } = useLocale()
  const copy = getLocaleCopy(ONBOARDING_COPY, locale)

  const [syncPassword, setSyncPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRestore = useCallback(async () => {
    if (needsPassword && syncPassword.length < 8) {
      setError(t('syncRestorePasswordRequired'))
      return
    }

    setWorking(true)
    setError(null)

    try {
      await applyGoogleSyncRestore({
        bundle,
        preferences: {
          ...bundle.categories,
        },
        syncPassword,
      })

      if (account) {
        saveNebulaAccount(account)
      }

      /*
       * Synced settings/bookmarks live in localStorage and several hooks read
       * them during startup, so reload once and resume at the next step.
       */
      markOnboardingRestored()
      saveOnboardingResumeStep('bookmarks')

      window.location.reload()
    } catch (reason) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] onboarding sync restore failed', reason)
      }

      setError(t('syncRestoreFailed'))
      setWorking(false)
    }
  }, [account, bundle, needsPassword, syncPassword, t])

  return (
    <div className={styles.restoreStep}>
      <div className={styles.markBadge} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 1.5A4 4 0 0 0 6.5 19z" />
        </svg>
      </div>

      <h1 id="onboarding-title" className={styles.title}>
        {t('syncRestoreTitle')}
      </h1>

      <p className={styles.lead}>
        {(needsPassword ? copy.restoreLead : copy.restoreLeadPlain).replace('{email}', email)}
      </p>

      {needsPassword && (
        <label className={styles.fieldLabel}>
          {t('syncRestorePasswordLabel')}

          <input
            className={styles.textInput}
            type="password"
            value={syncPassword}
            onChange={(event) => setSyncPassword(event.target.value)}
            placeholder={t('syncRestorePasswordPlaceholder')}
            autoComplete="current-password"
          />

          <span className={styles.hint}>
            {t('syncRestorePasswordHint')}
          </span>
        </label>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <OnboardingActions
        slot={footer}
        onBack={onBack}
        backDisabled={working}
        secondary={{ label: t('skip'), onClick: onContinue, disabled: working }}
        primary={{
          label: working ? t('syncRestoreWorking') : t('syncRestoreApply'),
          onClick: () => void handleRestore(),
          disabled: working,
          busy: working,
        }}
      />
    </div>
  )
}
