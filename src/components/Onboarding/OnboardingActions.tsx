import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../../hooks/useLocale'
import styles from './OnboardingWizard.module.css'

interface ActionButton {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}

interface OnboardingActionsProps {
  /** The footer element of the wizard. Nothing is drawn until it exists. */
  slot: HTMLElement | null
  /** Shows a Back button at the left of the footer. */
  onBack?: () => void
  backDisabled?: boolean
  /** The quiet action next to the main one (Skip, Not now). */
  secondary?: ActionButton
  primary?: ActionButton
}

/**
 * The buttons of a screen. They are drawn into the footer that the wizard keeps at the bottom of the window,
 * so each screen can own its actions (and the state behind them) while the buttons always sit in the same place:
 * Back at the left, everything else at the right.
 */
export function OnboardingActions({
  slot,
  onBack,
  backDisabled,
  secondary,
  primary,
}: OnboardingActionsProps) {
  const { t } = useLocale()

  if (!slot) return null

  return createPortal(
    <>
      {onBack && (
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={onBack}
          disabled={backDisabled}
        >
          {t('back')}
        </button>
      )}

      <div className={styles.footerSpacer} />

      {secondary && (
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={secondary.onClick}
          disabled={secondary.disabled}
        >
          {secondary.label}
        </button>
      )}

      {primary && (
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={primary.onClick}
          disabled={primary.disabled}
          aria-busy={primary.busy || undefined}
        >
          {primary.label}
        </button>
      )}
    </>,
    slot,
  )
}
