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
  /** Light or dark: what the screens show now, and what the app will be. */
  scheme: 'light' | 'dark'
  onSchemeChange: (scheme: 'light' | 'dark') => void
  /** The footer of the wizard, where this screen puts its button. */
  footer: HTMLElement | null
  onContinue: () => void
}

const THEMES = [
  {
    value: 'light',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    value: 'dark',
    icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  },
] as const

/** First screen: the language and light or dark. Region and weather are on the home-screen step. */
export function OnboardingWelcomeStep({
  locale,
  onLocaleChange,
  scheme,
  onSchemeChange,
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

    // Whatever is shown as chosen becomes the app's theme, also when it was only preselected from Windows.
    onSchemeChange(scheme)

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

      <div className={`${styles.setupField} ${styles.themeGroup}`}>
        <span id="onboarding-theme-label">{t(locale, 'theme')}</span>

        <div
          className={styles.themeChoices}
          role="radiogroup"
          aria-labelledby="onboarding-theme-label"
        >
          {THEMES.map(({ value, icon }) => (
            <label key={value} className={styles.themeCard}>
              <input
                type="radio"
                name="onboarding-theme"
                value={value}
                checked={scheme === value}
                onChange={() => onSchemeChange(value)}
                className={styles.srOnly}
              />

              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {icon}
              </svg>

              {t(locale, value === 'light' ? 'themeLight' : 'themeDark')}
            </label>
          ))}
        </div>
      </div>

      <OnboardingActions
        slot={footer}
        primary={{ label: t(locale, 'start'), onClick: handleContinue }}
      />
    </div>
  )
}
