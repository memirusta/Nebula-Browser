import { getLocaleCopy, tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import type { WallpaperConfig } from '../../core/wallpaperConfig'
import { OnboardingActions } from './OnboardingActions'
import { wallpaperChoiceLabel } from './wallpaperChoice'
import { ONBOARDING_COPY } from './onboardingCopy'
import styles from './OnboardingWizard.module.css'

interface OnboardingDoneStepProps {
  /** The footer of the wizard, where this screen puts its button. */
  footer: HTMLElement | null
  name: string
  restored: boolean
  importedCount: number
  importedPasswordCount: number
  weatherLabel: string | null
  wallpaper: WallpaperConfig
  onFinish: () => void
}

function Tick({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

/** Last screen: what was set up, then the button that opens the browser. */
export function OnboardingDoneStep({
  footer,
  name,
  restored,
  importedCount,
  importedPasswordCount,
  weatherLabel,
  wallpaper,
  onFinish,
}: OnboardingDoneStepProps) {
  const { locale, t } = useLocale()
  const copy = getLocaleCopy(ONBOARDING_COPY, locale)

  const imported = [
    importedCount > 0 ? `${importedCount} ${t('importBookmarksOption').toLocaleLowerCase(locale)}` : '',
    importedPasswordCount > 0 ? tf(locale, 'gsImportDone', { count: importedPasswordCount }) : '',
  ]
    .filter(Boolean)
    .join(', ')

  const rows: Array<[string, string]> = [
    [copy.sumProfile, name || t('userFallback')],
    ...(restored ? [[copy.sumBackup, copy.sumRestored] as [string, string]] : []),
    [copy.sumImported, imported || copy.sumNothing],
    [copy.wallpaperLabel, wallpaperChoiceLabel(wallpaper, copy)],
    [copy.sumWeather, weatherLabel || copy.sumNotSet],
  ]

  return (
    <div className={styles.doneStep}>
      <div className={styles.doneTick}>
        <Tick size={40} />
      </div>

      <h1 id="onboarding-title" className={styles.title}>
        {t('doneTitle')}
      </h1>

      <p className={styles.lead}>{copy.doneLead}</p>

      <ul className={styles.summary}>
        {rows.map(([label, value]) => (
          <li key={label}>
            <Tick size={17} />
            <span>{label}</span>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>

      <OnboardingActions
        slot={footer}
        primary={{ label: copy.openNebula, onClick: onFinish }}
      />
    </div>
  )
}
