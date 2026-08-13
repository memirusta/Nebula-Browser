import { useCallback, useState } from 'react'
import {
  applyGoogleSyncRestore,
  probeGoogleSyncRestore,
} from '../../core/googleSyncRestore'
import type { NebulaSyncBundleV1 } from '../../core/googleSync'
import {
  saveNebulaAccount,
  type NebulaAccount,
} from '../../core/nebulaAccount'
import { saveOnboardingResumeStep } from '../../core/onboarding'
import { tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { isTauri } from '../../platform/runtime'
import styles from './OnboardingWizard.module.css'

interface OnboardingSyncRestoreStepProps {
  email?: string
  account: NebulaAccount | null
  onContinue: () => void
}

export function OnboardingSyncRestoreStep({
  email,
  account,
  onContinue,
}: OnboardingSyncRestoreStepProps) {
  const { locale, t } = useLocale()

  const [bundle, setBundle] =
    useState<NebulaSyncBundleV1 | null>(null)

  const [syncPassword, setSyncPassword] =
    useState('')

  const [working, setWorking] =
    useState(false)

  const [empty, setEmpty] =
    useState(false)

  const [message, setMessage] =
    useState<string | null>(null)

  const [error, setError] =
    useState<string | null>(null)

  const needsPassword = Boolean(
    bundle?.categories.passwords &&
    bundle.passwords,
  )

  const handleRestore = useCallback(async () => {
    if (!isTauri || !email) {
      onContinue()
      return
    }

    setWorking(true)
    setError(null)
    setMessage(null)

    try {
      let targetBundle = bundle

      if (!targetBundle) {
        const probe =
          await probeGoogleSyncRestore(email)

        if (probe.status === 'empty') {
          setEmpty(true)
          setMessage(t('syncRestoreEmpty'))
          return
        }

        targetBundle = probe.bundle
        setBundle(probe.bundle)

        if (probe.needsPassword) {
          setMessage(
            t('syncRestoreBackupFound'),
          )
          return
        }
      }

      if (
        targetBundle.categories.passwords &&
        targetBundle.passwords &&
        syncPassword.length < 8
      ) {
        setError(
          t('syncRestorePasswordRequired'),
        )
        return
      }

      await applyGoogleSyncRestore({
        bundle: targetBundle,
        preferences: {
          ...targetBundle.categories,
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
      saveOnboardingResumeStep(
        'defaultBrowser',
      )

      window.location.reload()
    } catch (reason) {
      if (import.meta.env.DEV) {
        console.warn(
          '[nebula] onboarding sync restore failed',
          reason,
        )
      }

      setError(
        t('syncRestoreFailed'),
      )
    } finally {
      setWorking(false)
    }
  }, [
    account,
    bundle,
    email,
    onContinue,
    syncPassword,
    t,
  ])

  if (!isTauri || !email) {
    return (
      <>
        <h2 className={styles.title}>
          {t('syncRestoreTitle')}
        </h2>

        <p className={styles.lead}>
          {t('syncRestoreUnavailable')}
        </p>

        <button
          type="button"
          className={styles.primaryBtn}
          onClick={onContinue}
        >
          {t('continue')}
        </button>
      </>
    )
  }

  return (
    <>
      <h2 className={styles.title}>
        {t('syncRestoreTitle')}
      </h2>

      <p className={styles.lead}>
        {tf(
          locale,
          'syncRestoreLead',
          { email },
        )}
      </p>

      {needsPassword && (
        <label className={styles.fieldLabel}>
          {t('syncRestorePasswordLabel')}

          <input
            className={styles.textInput}
            type="password"
            value={syncPassword}
            onChange={(event) =>
              setSyncPassword(
                event.target.value,
              )
            }
            placeholder={
              t('syncRestorePasswordPlaceholder')
            }
            autoComplete="current-password"
          />

          <span className={styles.hint}>
            {t('syncRestorePasswordHint')}
          </span>
        </label>
      )}

      {message && (
        <p className={styles.success}>
          {message}
        </p>
      )}

      {error && (
        <p className={styles.error}>
          {error}
        </p>
      )}

      <div>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={onContinue}
          disabled={working}
        >
          {empty
            ? t('continue')
            : t('skip')}
        </button>

        {!empty && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() =>
              void handleRestore()
            }
            disabled={working}
          >
            {working
              ? t('syncRestoreWorking')
              : needsPassword
                ? t('syncRestoreApply')
                : t('syncRestoreCheck')}
          </button>
        )}
      </div>
    </>
  )
}