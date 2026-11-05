import { getLocaleCopy, LOCALE_OPTIONS, t } from '../../core/locale'
import {
  loadRegionalPreferences,
  saveRegionalPreferences,
} from '../../core/regionalPreferences'
import type { NebulaLocale } from '../../hooks/useLocale'
import { OnboardingActions } from './OnboardingActions'
import { ONBOARDING_COPY } from './onboardingCopy'
import styles from './OnboardingWizard.module.css'

interface Props {
  locale: NebulaLocale
  onLocaleChange: (locale: NebulaLocale) => void
  /** The footer of the wizard, where this screen puts its button. */
  footer: HTMLElement | null
  onContinue: () => void
}

/** First screen: only the language. Region and weather moved to the home-screen step. */
export function OnboardingWelcomeStep({
  locale,
  onLocaleChange,
  footer,
  onContinue,
}: Props) {
  const copy = getLocaleCopy(ONBOARDING_COPY, locale)

  function handleContinue() {
    // The region stays as it is; only the language the person picked is remembered with it.
    saveRegionalPreferences({
      ...loadRegionalPreferences(),
      language: locale,
    })

    onContinue()
  }

  return (
    <div className={styles.welcomeSetup}>
      <img
        className={styles.nebulaLogo}
        src="/nebula-app-logo.png"
        alt=""
        aria-hidden="true"
        draggable={false}
      />

      <h1 id="onboarding-title" className={styles.title}>
        {copy.welcomeTitle}
      </h1>
      <p className={styles.lead}>{copy.welcomeLead}</p>

      <label className={styles.setupField}>
        <span>{copy.languageLabel}</span>
        <select
          value={locale}
          onChange={(event) =>
            onLocaleChange(event.target.value as NebulaLocale)
          }
        >
          {LOCALE_OPTIONS.map(({ value, nativeLabel }) => (
            <option key={value} value={value}>
              {nativeLabel}
            </option>
          ))}
        </select>
      </label>

      <OnboardingActions
        slot={footer}
        primary={{ label: t(locale, 'start'), onClick: handleContinue }}
      />
    </div>
  )
}
