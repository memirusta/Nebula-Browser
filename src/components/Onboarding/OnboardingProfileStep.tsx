import { getLocaleCopy } from '../../core/locale'
import type { NebulaAccount } from '../../core/nebulaAccount'
import { useLocale } from '../../hooks/useLocale'
import { isTauri } from '../../platform/runtime'
import { OnboardingActions } from './OnboardingActions'
import { ONBOARDING_COPY } from './onboardingCopy'
import styles from './OnboardingWizard.module.css'

interface OnboardingProfileStepProps {
  /** The footer of the wizard, where this screen puts its buttons. */
  footer: HTMLElement | null
  account: NebulaAccount | null
  displayName: string
  onDisplayNameChange: (value: string) => void
  hasGoogleClient: boolean
  redirectUri: string
  googleStarting: boolean
  googleError: string | null
  googleConfigHint: string | null
  googleAvatarRetry: number
  onAvatarRetry: (retry: number) => void
  onGoogleSignIn: () => void
  /** True while the Google account is being checked for a Nebula Sync backup. */
  checkingBackup: boolean
  onBack: () => void
  onContinue: () => void
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" role="img" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.23 1.26-.95 2.33-2.04 3.05l3.29 2.55c1.92-1.77 3.02-4.38 3.02-7.5 0-.72-.06-1.4-.19-2.05H12z"
      />
      <path
        fill="#4285F4"
        d="M12 22c2.73 0 5.02-.9 6.69-2.43l-3.29-2.55c-.91.61-2.08.98-3.4.98-2.61 0-4.82-1.76-5.61-4.12H3.01v2.6A10.09 10.09 0 0 0 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.88A6.07 6.07 0 0 1 6.08 12c0-.65.11-1.28.31-1.88V7.52H3.01A10.09 10.09 0 0 0 1.92 12c0 1.63.39 3.18 1.09 4.48l3.38-2.6z"
      />
      <path
        fill="#34A853"
        d="M12 5.99c1.48 0 2.81.51 3.86 1.52l2.89-2.89C17.01 2.98 14.72 2 12 2A10.09 10.09 0 0 0 3.01 7.52l3.38 2.6C7.18 7.75 9.39 5.99 12 5.99z"
      />
    </svg>
  )
}

/** Profile: sign in with Google, or just pick a display name. */
export function OnboardingProfileStep({
  footer,
  account,
  displayName,
  onDisplayNameChange,
  hasGoogleClient,
  redirectUri,
  googleStarting,
  googleError,
  googleConfigHint,
  googleAvatarRetry,
  onAvatarRetry,
  onGoogleSignIn,
  checkingBackup,
  onBack,
  onContinue,
}: OnboardingProfileStepProps) {
  const { locale, t } = useLocale()
  const copy = getLocaleCopy(ONBOARDING_COPY, locale)

  const google = account?.provider === 'google' && account.email ? account : null

  return (
    <div className={styles.profileStep}>
      <div className={styles.markBadge} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </div>

      <h1 id="onboarding-title" className={styles.title}>
        {t('profileTitle')}
      </h1>

      {!google && <p className={styles.lead}>{t('profileLead')}</p>}

      {google ? (
        <>
          <p className={styles.success}>{t('googleLinked')}</p>

          <div className={styles.googleAccountCard}>
            <div className={styles.googleAccountAvatarFrame} aria-hidden="true">
              <div className={styles.googleAccountAvatarPlaceholder}>
                {google.displayName.charAt(0).toUpperCase()}
              </div>

              {google.avatarUrl && googleAvatarRetry < 3 && (
                <img
                  key={googleAvatarRetry}
                  className={styles.googleAccountAvatar}
                  src={
                    googleAvatarRetry === 0
                      ? google.avatarUrl
                      : `${google.avatarUrl}${
                          google.avatarUrl.includes('?') ? '&' : '?'
                        }nebula_retry=${googleAvatarRetry}`
                  }
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => {
                    const nextRetry = googleAvatarRetry + 1

                    window.setTimeout(
                      () => onAvatarRetry(nextRetry),
                      nextRetry === 1 ? 350 : 900,
                    )
                  }}
                />
              )}
            </div>

            <div className={styles.googleAccountMeta}>
              <strong>{google.displayName}</strong>
              <span>{google.email}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          {hasGoogleClient ? (
            <>
              <button
                type="button"
                className={styles.googleBtn}
                onClick={onGoogleSignIn}
                disabled={googleStarting}
              >
                <span className={styles.googleMark} aria-hidden="true">
                  <GoogleMark />
                </span>

                {googleStarting
                  ? isTauri
                    ? t('googleOpeningTauri')
                    : t('googleRedirecting')
                  : t('googleSignIn')}
              </button>

              <p className={styles.divider}>{t('orDivider')}</p>
            </>
          ) : (
            <p className={styles.hint}>{t('googleConfigMissing')}</p>
          )}

          <label className={styles.fieldLabel}>
            {t('displayNameLabel')}

            <input
              className={styles.textInput}
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder={t('displayNamePlaceholder')}
              maxLength={48}
              autoComplete="nickname"
            />
          </label>

          {hasGoogleClient &&
            (isTauri ? (
              <p className={styles.redirectHint}>{t('googleReturnHintTauri')}</p>
            ) : (
              <p className={styles.redirectHint}>
                {t('googleRedirectUri')}
                <code>{redirectUri}</code>
              </p>
            ))}

          {googleConfigHint && <p className={styles.hint}>{googleConfigHint}</p>}

          {googleError && <p className={styles.error}>{googleError}</p>}
        </>
      )}

      <OnboardingActions
        slot={footer}
        onBack={onBack}
        primary={{
          label: checkingBackup ? copy.checkingBackup : t('continue'),
          onClick: onContinue,
          disabled: checkingBackup,
          busy: checkingBackup,
        }}
      />
    </div>
  )
}
