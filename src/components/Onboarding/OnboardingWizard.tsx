import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  googleRedirectUri,
  isGoogleSignInSupported,
  signInWithGoogleProfile,
  takePendingGoogleClaims,
} from '../../core/googleSignIn'
import {
  probeGoogleSyncRestore,
} from '../../core/googleSyncRestore'
import type { NebulaSyncBundleV1 } from '../../core/googleSync'
import {
  loadNebulaAccount,
  type NebulaAccount,
} from '../../core/nebulaAccount'
import { getLocaleCopy, tf } from '../../core/locale'
import { loadRegionalPreferences } from '../../core/regionalPreferences'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import {
  isOAuthReturnUrl,
  ONBOARDING_STEPS,
  peekOnboardingImportedShortcuts,
  saveOnboardingImportedShortcuts,
  saveOnboardingResumeStep,
  wasOnboardingRestored,
  type OnboardingStep,
} from '../../core/onboarding'
import type { NebulaTheme } from '../../core/nebulaSettings'
import type { Shortcut } from '../../core/types'
import nebulaArt from '../../assets/onboarding/crab-nebula.jpg'
import { OnboardingImportStep } from './OnboardingImportStep'
import { OnboardingSyncRestoreStep } from './OnboardingSyncRestoreStep'
import { OnboardingDefaultBrowserStep } from './OnboardingDefaultBrowserStep'
import { OnboardingDoneStep } from './OnboardingDoneStep'
import { OnboardingHomeStep } from './OnboardingHomeStep'
import type { WallpaperConfig } from '../../core/wallpaperConfig'
import { OnboardingProfileStep } from './OnboardingProfileStep'
import { OnboardingWelcomeStep } from './OnboardingWelcomeStep'
import { ONBOARDING_COPY } from './onboardingCopy'
import { getGoogleOAuthStatus } from '../../platform/googleOAuth'
import { isTauri } from '../../platform/runtime'
import styles from './OnboardingWizard.module.css'

export interface OnboardingResult {
  account: NebulaAccount | null
  importedShortcuts: Shortcut[]
}

interface OnboardingWizardProps {
  open: boolean
  initialStep?: OnboardingStep
  /** The app's theme. Until a light or dark one was chosen, the screens follow Windows. */
  theme: NebulaTheme
  /** The person chose light or dark here; it becomes the app's theme. */
  onThemeChange: (theme: 'light' | 'dark') => void
  /** The background of the home screen, and what the person picks for it on the home screen step. */
  wallpaper: WallpaperConfig
  onUpdateWallpaper: (patch: Partial<WallpaperConfig>) => void
  onPickWallpaper: () => void
  onPickVideoWallpaper: () => void
  onApplyImportedShortcuts?: (
    shortcuts: Shortcut[],
  ) => void
  onComplete: (
    result: OnboardingResult,
  ) => void
}

type Step = OnboardingStep

/** What is known about a Nebula Sync backup for the Google account that signed in. */
type BackupState =
  | { phase: 'idle' | 'checking' | 'none' }
  | {
      phase: 'ready'
      bundle: NebulaSyncBundleV1
      needsPassword: boolean
    }

const STEP_LABEL: Record<
  Step,
  | 'stepWelcome'
  | 'stepProfile'
  | 'stepBackup'
  | 'stepImport'
  | 'stepHome'
  | 'stepDefault'
  | 'stepDone'
> = {
  welcome: 'stepWelcome',
  profile: 'stepProfile',
  restore: 'stepBackup',
  bookmarks: 'stepImport',
  home: 'stepHome',
  defaultBrowser: 'stepDefault',
  done: 'stepDone',
}

/** Whether Windows is in dark mode right now (and when it changes). */
function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDark(query.matches)

    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [])

  return dark
}

export function OnboardingWizard({
  open,
  initialStep,
  theme,
  onThemeChange,
  wallpaper,
  onUpdateWallpaper,
  onPickWallpaper,
  onPickVideoWallpaper,
  onApplyImportedShortcuts,
  onComplete,
}: OnboardingWizardProps) {
  const {
    locale,
    setLocale,
    t,
  } = useLocale()

  const copy = getLocaleCopy(
    ONBOARDING_COPY,
    locale,
  )

  // The screens look the way the app will: the chosen theme, or Windows' while none was chosen.
  const systemDark =
    useSystemPrefersDark()

  const scheme: 'light' | 'dark' =
    theme === 'light'
      ? 'light'
      : theme === 'dark'
        ? 'dark'
        : systemDark
          ? 'dark'
          : 'light'

  const [
    step,
    setStep,
  ] = useState<Step>(
    initialStep ??
      'welcome',
  )

  const [
    importedCount,
    setImportedCount,
  ] = useState(0)

  const [
    importedPasswordCount,
    setImportedPasswordCount,
  ] = useState(0)

  const [
    displayName,
    setDisplayName,
  ] = useState('')

  const [
    googleStarting,
    setGoogleStarting,
  ] = useState(false)

  const [
    googleError,
    setGoogleError,
  ] = useState<string | null>(
    null,
  )

  const [
    googleAvatarRetry,
    setGoogleAvatarRetry,
  ] = useState(0)

  const [
    googleConfigHint,
    setGoogleConfigHint,
  ] = useState<string | null>(
    null,
  )

  const [
    backup,
    setBackup,
  ] = useState<BackupState>({
    phase: 'idle',
  })

  // The footer is drawn by the wizard, the buttons in it by the screens.
  const [
    footer,
    setFooter,
  ] = useState<HTMLElement | null>(
    null,
  )

  const importedShortcutsRef =
    useRef<Shortcut[]>([])

  const accountRef =
    useRef<NebulaAccount | null>(
      null,
    )

  const backupCheckedEmailRef =
    useRef<string | null>(
      null,
    )

  const panelRef =
    useRef<HTMLDivElement>(
      null,
    )

  useDialogFocusTrap({
    active: open,
    containerRef: panelRef,
    restoreFocus: false,
  })

  const handleGoogleClaims =
    useCallback(
      (
        claims: {
          name?: string
          email?: string
          picture?: string
        },
      ) => {
        const name =
          claims.name?.trim() ||
          claims.email?.split(
            '@',
          )[0] ||
          t('userFallback')

        setDisplayName(
          name,
        )

        setGoogleAvatarRetry(
          0,
        )

        accountRef.current = {
          provider:
            'google',
          displayName:
            name,
          email:
            claims.email,
          avatarUrl:
            claims.picture,
        }
      },
      [t],
    )

  useEffect(() => {
    if (!open) return

    if (initialStep) {
      const pendingClaims =
        takePendingGoogleClaims()

      if (pendingClaims) {
        handleGoogleClaims(
          pendingClaims,
        )
      } else {
        const saved =
          loadNebulaAccount()

        if (
          saved?.provider ===
          'google'
        ) {
          handleGoogleClaims({
            name:
              saved.displayName,
            email:
              saved.email,
            picture:
              saved.avatarUrl,
          })
        }
      }

      const pendingImports =
        peekOnboardingImportedShortcuts()

      if (
        pendingImports.length >
        0
      ) {
        importedShortcutsRef.current =
          pendingImports

        setImportedCount(
          pendingImports.length,
        )
      }

      setStep(
        initialStep,
      )

      return
    }

    if (
      isOAuthReturnUrl()
    ) {
      return
    }

    const pendingClaims =
      takePendingGoogleClaims()

    if (pendingClaims) {
      handleGoogleClaims(
        pendingClaims,
      )
    }

    setStep(
      'welcome',
    )

    setImportedCount(
      0,
    )

    setImportedPasswordCount(
      0,
    )

    setDisplayName(
      '',
    )

    setGoogleStarting(
      false,
    )

    setGoogleError(
      null,
    )

    setGoogleAvatarRetry(
      0,
    )

    setGoogleConfigHint(
      null,
    )

    setBackup({
      phase:
        'idle',
    })

    backupCheckedEmailRef.current =
      null

    importedShortcutsRef.current =
      []

    accountRef.current =
      null
  }, [
    open,
    initialStep,
    handleGoogleClaims,
  ])

  const handleGoogleSignIn =
    useCallback(() => {
      setGoogleStarting(
        true,
      )

      setGoogleError(
        null,
      )

      saveOnboardingResumeStep(
        step,
      )

      if (isTauri) {
        void signInWithGoogleProfile()
          .then(
            ({
              claims,
              error,
              cancelled,
            }) => {
              setGoogleStarting(
                false,
              )

              // The sign-in window was closed: nothing failed, so the button just goes back.
              if (
                cancelled
              ) {
                return
              }

              if (
                claims
              ) {
                handleGoogleClaims(
                  claims,
                )

                return
              }

              if (
                import.meta.env
                  .DEV &&
                error
              ) {
                console.warn(
                  '[nebula] Google sign-in failed',
                  error,
                )
              }

              setGoogleError(
                error ||
                  t(
                    'googleSignInFailed',
                  ),
              )
            },
          )

        return
      }

      void signInWithGoogleProfile(
        'onboarding-profile',
      )
    }, [
      step,
      handleGoogleClaims,
      t,
    ])

  useEffect(() => {
    if (
      !open ||
      step !==
        'profile' ||
      !isTauri
    ) {
      return
    }

    void getGoogleOAuthStatus()
      .then(
        (
          status,
        ) => {
          if (
            !status ||
            status.clientIdConfigured
          ) {
            setGoogleConfigHint(
              null,
            )

            return
          }

          setGoogleConfigHint(
            tf(
              locale,
              'accountGoogleSecretMissing',
              {
                path:
                  status.appdataEnvPath,
              },
            ),
          )
        },
      )
  }, [
    open,
    step,
    locale,
  ])

  const googleEmail =
    accountRef.current
      ?.provider ===
      'google'
      ? accountRef.current
          .email
      : undefined

  /*
   * As soon as a Google account is linked on the profile screen, look for a Nebula Sync backup in the
   * background. The backup screen is only part of the flow when one exists. A failed look is the same as no
   * backup here; restoring can still be done later from the account settings.
   */
  useEffect(() => {
    if (
      !open ||
      step !==
        'profile' ||
      !isTauri ||
      !googleEmail ||
      wasOnboardingRestored() ||
      backupCheckedEmailRef.current ===
        googleEmail
    ) {
      return
    }

    backupCheckedEmailRef.current =
      googleEmail

    setBackup({
      phase:
        'checking',
    })

    void probeGoogleSyncRestore(
      googleEmail,
    )
      .then(
        (
          probe,
        ) => {
          if (
            backupCheckedEmailRef.current !==
            googleEmail
          ) {
            return
          }

          setBackup(
            probe.status ===
              'ready'
              ? {
                  phase:
                    'ready',
                  bundle:
                    probe.bundle,
                  needsPassword:
                    probe.needsPassword,
                }
              : {
                  phase:
                    'none',
                },
          )
        },
        (
          reason,
        ) => {
          if (
            import.meta.env
              .DEV
          ) {
            console.warn(
              '[nebula] onboarding backup check failed',
              reason,
            )
          }

          if (
            backupCheckedEmailRef.current ===
            googleEmail
          ) {
            setBackup({
              phase:
                'none',
            })
          }
        },
      )
  }, [
    open,
    step,
    googleEmail,
  ])

  const handleImportedShortcuts =
    useCallback(
      (
        shortcuts: Shortcut[],
      ) => {
        importedShortcutsRef.current =
          shortcuts

        setImportedCount(
          shortcuts.length,
        )

        if (
          shortcuts.length >
          0
        ) {
          saveOnboardingImportedShortcuts(
            shortcuts,
          )
        }
      },
      [],
    )

  const handlePasswordsAdded =
    useCallback(
      (
        count: number,
      ) => {
        setImportedPasswordCount(
          (
            current,
          ) =>
            current +
            count,
        )
      },
      [],
    )

  const finish =
    useCallback(() => {
      const trimmed =
        displayName.trim()

      if (
        !accountRef.current &&
        trimmed
      ) {
        accountRef.current = {
          provider:
            'local',
          displayName:
            trimmed,
        }
      }

      onComplete({
        account:
          accountRef.current ??
          loadNebulaAccount(),

        importedShortcuts:
          importedShortcutsRef.current,
      })
    }, [
      displayName,
      onComplete,
    ])

  // The screens in order. The backup screen only exists when there is a backup to restore.
  const steps =
    useMemo<readonly Step[]>(
      () =>
        ONBOARDING_STEPS.filter(
          (
            item,
          ) =>
            item !==
              'restore' ||
            backup.phase ===
              'ready',
        ),
      [
        backup.phase,
      ],
    )

  // The backup screen has nothing to show without a backup (for instance after a reload): move on to the import.
  useEffect(() => {
    if (
      open &&
      step ===
        'restore' &&
      backup.phase !==
        'ready'
    ) {
      setStep(
        'bookmarks',
      )
    }
  }, [
    open,
    step,
    backup.phase,
  ])

  const goNext =
    useCallback(() => {
      if (
        step ===
          'bookmarks' &&
        importedShortcutsRef
          .current
          .length >
          0
      ) {
        onApplyImportedShortcuts?.(
          importedShortcutsRef.current,
        )
      }

      const index =
        steps.indexOf(
          step,
        )

      if (
        index >= 0 &&
        index <
          steps.length -
            1
      ) {
        setStep(
          steps[
            index +
              1
          ],
        )

        return
      }

      if (
        index < 0
      ) {
        // A step that is not part of this flow (a backup screen without a backup): carry on after it.
        const after =
          ONBOARDING_STEPS.slice(
            ONBOARDING_STEPS.indexOf(
              step,
            ) + 1,
          ).find(
            (
              item,
            ) =>
              steps.includes(
                item,
              ),
          )

        if (
          after
        ) {
          setStep(
            after,
          )

          return
        }
      }

      finish()
    }, [
      step,
      steps,
      finish,
      onApplyImportedShortcuts,
    ])

  const goBack =
    useCallback(() => {
      const index =
        steps.indexOf(
          step,
        )

      if (
        index > 0
      ) {
        setStep(
          steps[
            index -
              1
          ],
        )
      }
    }, [
      step,
      steps,
    ])

  const weatherLabel =
    useMemo(
      () =>
        step ===
        'done'
          ? loadRegionalPreferences()
              .weatherLocation
              ?.label ??
            null
          : null,
      [
        step,
      ],
    )

  if (!open) {
    return null
  }

  const stepIndex =
    Math.max(
      0,
      steps.indexOf(
        step,
      ),
    )

  const hasGoogleClient =
    isGoogleSignInSupported()

  const redirectUri =
    googleRedirectUri()

  return createPortal(
    <div
      ref={panelRef}
      className={
        styles.root
      }
      data-scheme={
        scheme
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      tabIndex={-1}
    >
      <div
        className={
          styles.art
        }
        aria-hidden="true"
      >
        <img
          src={
            nebulaArt
          }
          alt=""
          draggable={
            false
          }
        />
      </div>

      <aside
        className={
          styles.side
        }
      >
        <div
          className={
            styles.brand
          }
        >
          <img
            className={
              styles.brandLogo
            }
            src="/nebula-app-logo.png"
            alt=""
            aria-hidden="true"
            draggable={
              false
            }
          />

          <strong>
            Nebula
          </strong>
        </div>

        <p
          className={
            styles.tagline
          }
        >
          {
            copy.tagline
          }
        </p>

        <ol
          className={
            styles.steps
          }
          aria-label={
            copy.stepsLabel
          }
        >
          {steps.map(
            (
              item,
              index,
            ) => (
              <li
                key={
                  item
                }
                className={[
                  styles.stepItem,

                  index <
                  stepIndex
                    ? styles.stepDone
                    : '',

                  index ===
                  stepIndex
                    ? styles.stepNow
                    : '',
                ]
                  .filter(
                    Boolean,
                  )
                  .join(
                    ' ',
                  )}
                aria-current={
                  index ===
                  stepIndex
                    ? 'step'
                    : undefined
                }
              >
                <i>
                  {index <
                  stepIndex
                    ? '✓'
                    : index +
                      1}
                </i>

                {
                  copy[
                    STEP_LABEL[
                      item
                    ]
                  ]
                }
              </li>
            ),
          )}
        </ol>

        <div
          className={
            styles.progress
          }
          role="progressbar"
          aria-label={
            copy.stepsLabel
          }
          aria-valuemin={
            1
          }
          aria-valuemax={
            steps.length
          }
          aria-valuenow={
            stepIndex +
            1
          }
        >
          <i
            style={{
              width: `${
                ((stepIndex + 1) /
                  steps.length) *
                100
              }%`,
            }}
          />
        </div>
      </aside>

      <main
        className={
          styles.main
        }
      >
        <div
          key={
            step
          }
          className={
            styles.body
          }
        >
          {step ===
            'welcome' && (
            <OnboardingWelcomeStep
              locale={
                locale
              }
              onLocaleChange={
                setLocale
              }
              scheme={
                scheme
              }
              onSchemeChange={
                onThemeChange
              }
              footer={
                footer
              }
              onContinue={
                goNext
              }
            />
          )}

          {step ===
            'profile' && (
            <OnboardingProfileStep
              footer={
                footer
              }
              account={
                accountRef.current
              }
              displayName={
                displayName
              }
              onDisplayNameChange={
                setDisplayName
              }
              hasGoogleClient={
                hasGoogleClient
              }
              redirectUri={
                redirectUri
              }
              googleStarting={
                googleStarting
              }
              googleError={
                googleError
              }
              googleConfigHint={
                googleConfigHint
              }
              googleAvatarRetry={
                googleAvatarRetry
              }
              onAvatarRetry={
                setGoogleAvatarRetry
              }
              onGoogleSignIn={
                handleGoogleSignIn
              }
              checkingBackup={
                backup.phase ===
                'checking'
              }
              onBack={
                goBack
              }
              onContinue={
                goNext
              }
            />
          )}

          {step ===
            'restore' &&
            googleEmail &&
            backup.phase ===
              'ready' && (
              <OnboardingSyncRestoreStep
                footer={
                  footer
                }
                email={
                  googleEmail
                }
                account={
                  accountRef.current
                }
                bundle={
                  backup.bundle
                }
                needsPassword={
                  backup.needsPassword
                }
                onBack={
                  goBack
                }
                onContinue={
                  goNext
                }
              />
            )}

          {step ===
            'bookmarks' && (
            <OnboardingImportStep
              footer={
                footer
              }
              onBack={
                goBack
              }
              onContinue={
                goNext
              }
              onShortcuts={
                handleImportedShortcuts
              }
              onPasswordsAdded={
                handlePasswordsAdded
              }
            />
          )}

          {step ===
            'home' && (
            <OnboardingHomeStep
              locale={
                locale
              }
              footer={
                footer
              }
              wallpaper={wallpaper}
              onUpdateWallpaper={onUpdateWallpaper}
              onPickWallpaper={onPickWallpaper}
              onPickVideoWallpaper={onPickVideoWallpaper}
              onBack={
                goBack
              }
              onContinue={
                goNext
              }
            />
          )}

          {step ===
            'defaultBrowser' && (
            <OnboardingDefaultBrowserStep
              footer={
                footer
              }
              onBack={
                goBack
              }
              onContinue={
                goNext
              }
            />
          )}

          {step ===
            'done' && (
            <OnboardingDoneStep
              footer={
                footer
              }
              name={
                displayName.trim()
              }
              restored={
                wasOnboardingRestored()
              }
              importedCount={
                importedCount
              }
              importedPasswordCount={
                importedPasswordCount
              }
              weatherLabel={
                weatherLabel
              }
              wallpaper={wallpaper}
              onFinish={
                finish
              }
            />
          )}
        </div>
      </main>

      <div
        ref={
          setFooter
        }
        className={
          styles.footer
        }
      />
    </div>,
    document.body,
  )
}
