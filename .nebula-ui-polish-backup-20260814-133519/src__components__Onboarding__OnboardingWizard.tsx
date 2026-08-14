import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortcutsFromImportedBookmarks } from '../../core/bookmarkImport'
import {
  googleRedirectUri,
  isGoogleSignInSupported,
  signInWithGoogleProfile,
  takePendingGoogleClaims,
} from '../../core/googleSignIn'
import {
  loadNebulaAccount,
  type NebulaAccount,
} from '../../core/nebulaAccount'
import { tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import {
  isOAuthReturnUrl,
  ONBOARDING_STEPS,
  peekOnboardingImportedShortcuts,
  saveOnboardingImportedShortcuts,
  saveOnboardingResumeStep,
  type OnboardingStep,
} from '../../core/onboarding'
import { GoogleAccountSetupPanel } from '../GoogleAccountSetupModal/GoogleAccountSetupPanel'
import {
  mergeImportedPasswords,
  parsePasswordCsv,
} from '../../core/passwordImport'
import type { Shortcut } from '../../core/types'
import {
  detectDefaultBrowser,
  importDefaultBrowserBookmarks,
  type BrowserInfo,
} from '../../platform/browserImport'
import { OnboardingSyncRestoreStep } from './OnboardingSyncRestoreStep'
import { OnboardingDefaultBrowserStep } from './OnboardingDefaultBrowserStep'
import { OnboardingWelcomeStep } from './OnboardingWelcomeStep'
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
  onApplyImportedShortcuts?: (
    shortcuts: Shortcut[],
  ) => void
  onComplete: (
    result: OnboardingResult,
  ) => void
  onOpenBrowseUrl?: (
    url: string,
  ) => void
}

type Step = OnboardingStep

const STEPS: readonly Step[] =
  ONBOARDING_STEPS

export function OnboardingWizard({
  open,
  initialStep,
  onApplyImportedShortcuts,
  onComplete,
  onOpenBrowseUrl,
}: OnboardingWizardProps) {
  const {
    locale,
    setLocale,
    t,
  } = useLocale()

  const [
    step,
    setStep,
  ] = useState<Step>(
    initialStep ??
      'welcome',
  )

  const [
    browserInfo,
    setBrowserInfo,
  ] = useState<BrowserInfo | null>(
    null,
  )

  const [
    importing,
    setImporting,
  ] = useState(false)

  const [
    importError,
    setImportError,
  ] = useState<string | null>(
    null,
  )

  const [
    importedCount,
    setImportedCount,
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
    googleConfigHint,
    setGoogleConfigHint,
  ] = useState<string | null>(
    null,
  )

  const [
    googleLinkMessage,
    setGoogleLinkMessage,
  ] = useState<string | null>(
    null,
  )

  const importedShortcutsRef =
    useRef<Shortcut[]>([])

  const accountRef =
    useRef<NebulaAccount | null>(
      null,
    )

  const csvInputRef =
    useRef<HTMLInputElement>(
      null,
    )

  const panelRef =
    useRef<HTMLDivElement>(
      null,
    )

  const browserDisplayName =
    browserInfo &&
    browserInfo.browser !==
      'unknown' &&
    browserInfo.displayName.trim()
      ? browserInfo.displayName
      : t('genericBrowser')

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

    setBrowserInfo(
      null,
    )

    setImporting(
      false,
    )

    setImportError(
      null,
    )

    setImportedCount(
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

    setGoogleConfigHint(
      null,
    )

    setGoogleLinkMessage(
      null,
    )

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
            }) => {
              setGoogleStarting(
                false,
              )

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

  useEffect(() => {
    if (
      !open ||
      step !==
        'bookmarks'
    ) {
      return
    }

    void detectDefaultBrowser()
      .then(
        setBrowserInfo,
      )
  }, [
    open,
    step,
  ])

  const handleImportBookmarks =
    useCallback(
      async () => {
        setImporting(
          true,
        )

        setImportError(
          null,
        )

        try {
          const bookmarks =
            await importDefaultBrowserBookmarks(
              40,
            )

          const shortcuts =
            shortcutsFromImportedBookmarks(
              bookmarks,
            )

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

          if (
            shortcuts.length ===
            0
          ) {
            setImportError(
              t(
                'bookmarksNone',
              ),
            )
          }
        } catch {
          setImportError(
            t(
              'bookmarksFailed',
            ),
          )
        } finally {
          setImporting(
            false,
          )
        }
      },
      [t],
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

  const googleEmail =
    accountRef.current
      ?.provider ===
      'google'
      ? accountRef.current
          .email
      : undefined

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

      if (
        step ===
        'profile'
      ) {
        if (
          googleEmail
        ) {
          setStep(
            'googleLink',
          )

          return
        }

        setStep(
          'defaultBrowser',
        )

        return
      }

      const index =
        STEPS.indexOf(
          step,
        )

      if (
        index <
        STEPS.length -
          1
      ) {
        setStep(
          STEPS[
            index +
              1
          ],
        )

        return
      }

      finish()
    }, [
      step,
      finish,
      onApplyImportedShortcuts,
      googleEmail,
    ])

  const handleCsvSelected =
    useCallback(
      async (
        event:
          React.ChangeEvent<HTMLInputElement>,
      ) => {
        const file =
          event.target
            .files?.[0]

        event.target.value =
          ''

        if (!file) {
          return
        }

        try {
          const text =
            await file.text()

          const imported =
            parsePasswordCsv(
              text,
            )

          if (
            imported.length ===
            0
          ) {
            setGoogleLinkMessage(
              t(
                'accountCsvEmpty',
              ),
            )

            return
          }

          await mergeImportedPasswords(
            imported.map(
              (
                item,
              ) => ({
                label:
                  item.label,
                url:
                  item.url,
                username:
                  item.username,
                password:
                  item.password,
              }),
            ),
          )

          setGoogleLinkMessage(
            tf(
              locale,
              'accountCsvImported',
              {
                count:
                  imported.length,
              },
            ),
          )
        } catch {
          setGoogleLinkMessage(
            t(
              'accountCsvReadError',
            ),
          )
        }
      },
      [
        locale,
        t,
      ],
    )

  const skipGoogleLink =
    useCallback(() => {
      setStep(
        isTauri &&
          googleEmail
          ? 'syncRestore'
          : 'defaultBrowser',
      )
    }, [
      googleEmail,
    ])

  const completeGoogleLink =
    useCallback(() => {
      setGoogleLinkMessage(
        t(
          'googleLinked',
        ),
      )

      setStep(
        isTauri &&
          googleEmail
          ? 'syncRestore'
          : 'defaultBrowser',
      )
    }, [
      googleEmail,
      t,
    ])

  const goBack =
    useCallback(() => {
      switch (step) {
        case 'bookmarks':
          setStep('welcome')
          return

        case 'profile':
          setStep('bookmarks')
          return

        case 'googleLink':
          setStep('profile')
          return

        case 'syncRestore':
          setStep('googleLink')
          return

        case 'defaultBrowser':
          setStep(
            isTauri &&
              googleEmail
              ? 'syncRestore'
              : 'profile',
          )
          return

        case 'done':
          setStep('defaultBrowser')
          return

        default:
          return
      }
    }, [
      step,
      googleEmail,
    ])

  if (!open) {
    return null
  }

  const stepIndex =
    STEPS.indexOf(
      step,
    )

  const hasGoogleClient =
    isGoogleSignInSupported()

  const redirectUri =
    googleRedirectUri()

  return createPortal(
    <div
      className={
        styles.backdrop
      }
      role="presentation"
    >
      <div
        ref={panelRef}
        className={
          styles.panel
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
      >
        <header
          className={
            styles.header
          }
        >
          <p
            className={
              styles.kicker
            }
          >
            {t(
              'onboardingKicker',
            )}
          </p>

          <div
            className={
              styles.progress
            }
            aria-hidden="true"
          >
            {STEPS.map(
              (
                item,
                index,
              ) => (
                <span
                  key={
                    item
                  }
                  className={[
                    styles.progressDot,

                    index <=
                    stepIndex
                      ? styles.progressDotActive
                      : '',
                  ]
                    .filter(
                      Boolean,
                    )
                    .join(
                      ' ',
                    )}
                />
              ),
            )}
          </div>
        </header>

        <div
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
              onContinue={() =>
                setStep(
                  'bookmarks',
                )
              }
            />
          )}

          {step ===
            'bookmarks' && (
            <>
              <h2
                className={
                  styles.title
                }
              >
                {t(
                  'bookmarksTitle',
                )}
              </h2>

              <p
                className={
                  styles.lead
                }
              >
                {isTauri
                  ? browserInfo
                    ? browserInfo
                        .bookmarksAvailable
                      ? `${browserDisplayName} ${t(
                          'bookmarksCanImport',
                        )}`
                      : `${browserDisplayName} ${t(
                          'bookmarksUnavailable',
                        )}`
                    : t(
                        'bookmarksSearching',
                      )
                  : t(
                      'bookmarksWebOnly',
                    )}
              </p>

              {importedCount >
                0 && (
                <p
                  className={
                    styles.success
                  }
                >
                  {
                    importedCount
                  }{' '}
                  {t(
                    'bookmarksReady',
                  )}
                </p>
              )}

              {importError && (
                <p
                  className={
                    styles.error
                  }
                >
                  {
                    importError
                  }
                </p>
              )}

              {isTauri &&
                browserInfo
                  ?.bookmarksAvailable && (
                  <button
                    type="button"
                    className={
                      styles.secondaryBtn
                    }
                    onClick={() =>
                      void handleImportBookmarks()
                    }
                    disabled={
                      importing
                    }
                  >
                    {importing
                      ? t(
                          'bookmarksImporting',
                        )
                      : `${browserDisplayName} ${t(
                          'bookmarksImportBtn',
                        )}`}
                  </button>
                )}
            </>
          )}

          {step ===
            'profile' && (
            <>
              <h2
                className={
                  styles.title
                }
              >
                {t(
                  'profileTitle',
                )}
              </h2>

              <p
                className={
                  styles.lead
                }
              >
                {t(
                  'profileLead',
                )}
              </p>

              {hasGoogleClient ? (
                <>
                  <button
                    type="button"
                    className={
                      styles.googleBtn
                    }
                    onClick={
                      handleGoogleSignIn
                    }
                    disabled={
                      googleStarting
                    }
                  >
                    <span
                      className={
                        styles.googleMark
                      }
                      aria-hidden="true"
                    >
                      G
                    </span>

                    {googleStarting
                      ? isTauri
                        ? t(
                            'googleOpeningTauri',
                          )
                        : t(
                            'googleRedirecting',
                          )
                      : t(
                          'googleSignIn',
                        )}
                  </button>

                  {isTauri ? (
                    <p
                      className={
                        styles.redirectHint
                      }
                    >
                      {t(
                        'googleReturnHintTauri',
                      )}
                    </p>
                  ) : (
                    <p
                      className={
                        styles.redirectHint
                      }
                    >
                      {t(
                        'googleRedirectUri',
                      )}

                      <code>
                        {
                          redirectUri
                        }
                      </code>
                    </p>
                  )}

                  {googleConfigHint && (
                    <p
                      className={
                        styles.hint
                      }
                    >
                      {
                        googleConfigHint
                      }
                    </p>
                  )}

                  {googleError && (
                    <p
                      className={
                        styles.error
                      }
                    >
                      {
                        googleError
                      }
                    </p>
                  )}

                  <p
                    className={
                      styles.divider
                    }
                  >
                    {t(
                      'orDivider',
                    )}
                  </p>
                </>
              ) : (
                <p
                  className={
                    styles.hint
                  }
                >
                  {t(
                    'googleConfigMissing',
                  )}
                </p>
              )}

              <label
                className={
                  styles.fieldLabel
                }
              >
                {t(
                  'displayNameLabel',
                )}

                <input
                  className={
                    styles.textInput
                  }
                  value={
                    displayName
                  }
                  onChange={(
                    event,
                  ) =>
                    setDisplayName(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder={t(
                    'displayNamePlaceholder',
                  )}
                  maxLength={
                    48
                  }
                  autoComplete="nickname"
                />
              </label>
            </>
          )}

          {step ===
            'googleLink' &&
            googleEmail && (
              <>
                <h2
                  className={
                    styles.title
                  }
                >
                  {t(
                    'googleLinkTitle',
                  )}
                </h2>

                <GoogleAccountSetupPanel
                  email={
                    googleEmail
                  }
                  onOpenBrowseUrl={(
                    url,
                  ) =>
                    onOpenBrowseUrl?.(
                      url,
                    )
                  }
                  onMergePasswords={async (
                    entries,
                  ) => {
                    await mergeImportedPasswords(
                      entries,
                    )
                  }}
                  onRequestCsvImport={() =>
                    csvInputRef.current?.click()
                  }
                  onApplied={
                    completeGoogleLink
                  }
                  showSkip
                  onSkip={
                    skipGoogleLink
                  }
                />

                {googleLinkMessage && (
                  <p
                    className={
                      styles.success
                    }
                  >
                    {
                      googleLinkMessage
                    }
                  </p>
                )}

                <input
                  ref={
                    csvInputRef
                  }
                  type="file"
                  accept=".csv,text/csv"
                  className={
                    styles.hiddenFileInput
                  }
                  onChange={(
                    event,
                  ) =>
                    void handleCsvSelected(
                      event,
                    )
                  }
                />
              </>
            )}

          {step ===
            'googleLink' &&
            !googleEmail && (
              <>
                <h2
                  className={
                    styles.title
                  }
                >
                  {t(
                    'googleLinkTitle',
                  )}
                </h2>

                <p
                  className={
                    styles.lead
                  }
                >
                  {t(
                    'googleLinkNeedSignIn',
                  )}
                </p>
              </>
            )}

          {step ===
            'syncRestore' && (
            <OnboardingSyncRestoreStep
              email={
                googleEmail
              }
              account={
                accountRef.current
              }
              onContinue={() => {
                setStep(
                  'defaultBrowser',
                )
              }}
            />
          )}

          {step ===
            'defaultBrowser' && (
            <OnboardingDefaultBrowserStep />
          )}

          {step ===
            'done' && (
            <>
              <h2
                className={
                  styles.title
                }
              >
                {t(
                  'doneTitle',
                )}
              </h2>

              <p
                className={
                  styles.lead
                }
              >
                {importedCount >
                0
                  ? `${importedCount} ${t(
                      'doneBookmarks',
                    )}`
                  : t(
                      'doneEmptyMenu',
                    )}

                {displayName.trim()
                  ? ` ${t(
                      'doneWelcome',
                    )}, ${displayName.trim()}.`
                  : ` ${t(
                      'doneProfileLater',
                    )}`}
              </p>
            </>
          )}
        </div>

        {step !==
          'welcome' && (
          <footer
            className={
              styles.footer
            }
          >
            {stepIndex >
              0 &&
              step !==
                'done' &&
              step !==
                'googleLink' &&
              step !==
                'syncRestore' && (
                <button
                  type="button"
                  className={
                    styles.ghostBtn
                  }
                  onClick={
                    goBack
                  }
                >
                  {t(
                    'back',
                  )}
                </button>
              )}

            <div
              className={
                styles.footerSpacer
              }
            />

            {step ===
              'bookmarks' && (
              <button
                type="button"
                className={
                  styles.ghostBtn
                }
                onClick={
                  goNext
                }
              >
                {t(
                  'skip',
                )}
              </button>
            )}

            {step ===
              'googleLink' && (
              <button
                type="button"
                className={
                  styles.ghostBtn
                }
                onClick={
                  skipGoogleLink
                }
              >
                {t(
                  'continue',
                )}
              </button>
            )}

            {step !==
              'googleLink' &&
              step !==
                'syncRestore' && (
                <button
                  type="button"
                  className={
                    styles.primaryBtn
                  }
                  onClick={
                    step ===
                    'done'
                      ? finish
                      : goNext
                  }
                >
                  {step ===
                  'done'
                    ? t(
                        'start',
                      )
                    : t(
                        'continue',
                      )}
                </button>
              )}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
