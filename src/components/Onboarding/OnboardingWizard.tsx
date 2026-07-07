import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortcutsFromImportedBookmarks } from '../../core/bookmarkImport'
import {
  googleRedirectUri,
  isGoogleSignInSupported,
  signInWithGoogleProfile,
  takePendingGoogleClaims,
} from '../../core/googleSignIn'
import { loadNebulaAccount, type NebulaAccount } from '../../core/nebulaAccount'
import {
  isOAuthReturnUrl,
  peekOnboardingImportedShortcuts,
  saveOnboardingImportedShortcuts,
  saveOnboardingResumeStep,
  type OnboardingStep,
} from '../../core/onboarding'
import { GoogleAccountSetupPanel } from '../GoogleAccountSetupModal/GoogleAccountSetupPanel'
import { mergeImportedPasswords, parsePasswordCsv } from '../../core/passwordImport'
import type { Shortcut } from '../../core/types'
import {
  detectDefaultBrowser,
  importDefaultBrowserBookmarks,
  type BrowserInfo,
} from '../../platform/browserImport'
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
  onApplyImportedShortcuts?: (shortcuts: Shortcut[]) => void
  onComplete: (result: OnboardingResult) => void
  onOpenBrowseUrl?: (url: string) => void
}

type Step = OnboardingStep

const STEPS: Step[] = ['welcome', 'bookmarks', 'profile', 'googleLink', 'done']

export function OnboardingWizard({ open, initialStep, onApplyImportedShortcuts, onComplete, onOpenBrowseUrl }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>(initialStep ?? 'welcome')
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [googleStarting, setGoogleStarting] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googleConfigHint, setGoogleConfigHint] = useState<string | null>(null)
  const [googleLinkMessage, setGoogleLinkMessage] = useState<string | null>(null)
  const importedShortcutsRef = useRef<Shortcut[]>([])
  const accountRef = useRef<NebulaAccount | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const handleGoogleClaims = useCallback(
    (claims: { name?: string; email?: string; picture?: string }) => {
      const name = claims.name?.trim() || claims.email?.split('@')[0] || 'Kullanıcı'
      setDisplayName(name)
      accountRef.current = {
        provider: 'google',
        displayName: name,
        email: claims.email,
        avatarUrl: claims.picture,
      }
    },
    [],
  )

  useEffect(() => {
    if (!open) return

    if (initialStep) {
      const pendingClaims = takePendingGoogleClaims()
      if (pendingClaims) {
        handleGoogleClaims(pendingClaims)
      } else {
        const saved = loadNebulaAccount()
        if (saved?.provider === 'google') {
          handleGoogleClaims({
            name: saved.displayName,
            email: saved.email,
            picture: saved.avatarUrl,
          })
        }
      }

      const pendingImports = peekOnboardingImportedShortcuts()
      if (pendingImports.length > 0) {
        importedShortcutsRef.current = pendingImports
        setImportedCount(pendingImports.length)
      }

      setStep(initialStep)
      return
    }

    if (isOAuthReturnUrl()) {
      return
    }

    const pendingClaims = takePendingGoogleClaims()
    if (pendingClaims) {
      handleGoogleClaims(pendingClaims)
    }

    setStep('welcome')
    setBrowserInfo(null)
    setImporting(false)
    setImportError(null)
    setImportedCount(0)
    setDisplayName('')
    setGoogleStarting(false)
    setGoogleError(null)
    setGoogleConfigHint(null)
    setGoogleLinkMessage(null)
    importedShortcutsRef.current = []
    accountRef.current = null
  }, [open, initialStep, handleGoogleClaims])

  const handleGoogleSignIn = useCallback(() => {
    setGoogleStarting(true)
    setGoogleError(null)
    saveOnboardingResumeStep(step)

    if (isTauri) {
      void signInWithGoogleProfile().then(({ claims, error }) => {
        setGoogleStarting(false)
        if (claims) {
          handleGoogleClaims(claims)
          return
        }
        setGoogleError(error ?? 'Google girişi tamamlanamadı. Tekrar dene veya ismini yaz.')
      })
      return
    }

    void signInWithGoogleProfile('onboarding-profile')
  }, [step, handleGoogleClaims])

  useEffect(() => {
    if (!open || step !== 'profile' || !isTauri) return
    void getGoogleOAuthStatus().then((status) => {
      if (!status || status.secretConfigured) {
        setGoogleConfigHint(null)
        return
      }
      setGoogleConfigHint(
        `Kurulu surumde Google secret gerekli. Dosya: ${status.appdataEnvPath}`,
      )
    })
  }, [open, step])

  useEffect(() => {
    if (!open || step !== 'bookmarks') return
    void detectDefaultBrowser().then(setBrowserInfo)
  }, [open, step])

  const handleImportBookmarks = useCallback(async () => {
    setImporting(true)
    setImportError(null)
    try {
      const bookmarks = await importDefaultBrowserBookmarks(40)
      const shortcuts = shortcutsFromImportedBookmarks(bookmarks)
      importedShortcutsRef.current = shortcuts
      setImportedCount(shortcuts.length)
      if (shortcuts.length > 0) {
        saveOnboardingImportedShortcuts(shortcuts)
      }
      if (shortcuts.length === 0) {
        setImportError('İçe aktarılacak yer işareti bulunamadı.')
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'İçe aktarma başarısız.')
    } finally {
      setImporting(false)
    }
  }, [])

  const finish = useCallback(() => {
    const trimmed = displayName.trim()
    if (!accountRef.current && trimmed) {
      accountRef.current = {
        provider: 'local',
        displayName: trimmed,
      }
    }

    onComplete({
      account: accountRef.current ?? loadNebulaAccount(),
      importedShortcuts: importedShortcutsRef.current,
    })
  }, [displayName, onComplete])

  const googleEmail =
    accountRef.current?.provider === 'google' ? accountRef.current.email : undefined

  const goNext = useCallback(() => {
    if (step === 'bookmarks' && importedShortcutsRef.current.length > 0) {
      onApplyImportedShortcuts?.(importedShortcutsRef.current)
    }

    if (step === 'profile') {
      if (googleEmail) {
        setStep('googleLink')
        return
      }
      setStep('done')
      return
    }

    const index = STEPS.indexOf(step)
    if (index < STEPS.length - 1) {
      setStep(STEPS[index + 1])
      return
    }
    finish()
  }, [step, finish, onApplyImportedShortcuts, googleEmail])

  const handleCsvSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const imported = parsePasswordCsv(text)
      if (imported.length === 0) {
        setGoogleLinkMessage('CSV dosyasında geçerli şifre satırı bulunamadı.')
        return
      }
      mergeImportedPasswords(
        imported.map((item) => ({
          label: item.label,
          url: item.url,
          username: item.username,
          password: item.password,
        })),
      )
      setGoogleLinkMessage(`${imported.length} şifre CSV'den kasaya eklendi.`)
    } catch {
      setGoogleLinkMessage('CSV dosyası okunamadı.')
    }
  }, [])

  const skipGoogleLink = useCallback(() => {
    setStep('done')
  }, [])

  const completeGoogleLink = useCallback(() => {
    setGoogleLinkMessage('Google hesabın bağlandı.')
    setStep('done')
  }, [])

  const goBack = useCallback(() => {
    const index = STEPS.indexOf(step)
    if (index > 0) setStep(STEPS[index - 1])
  }, [step])

  if (!open) return null

  const stepIndex = STEPS.indexOf(step)
  const hasGoogleClient = isGoogleSignInSupported()
  const redirectUri = googleRedirectUri()

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <header className={styles.header}>
          <p className={styles.kicker}>Kurulum</p>
          <div className={styles.progress} aria-hidden="true">
            {STEPS.map((item, index) => (
              <span
                key={item}
                className={[
                  styles.progressDot,
                  index <= stepIndex ? styles.progressDotActive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
          </div>
        </header>

        <div className={styles.body}>
          {step === 'welcome' && (
            <>
              <h1 id="onboarding-title" className={styles.title}>
                Nebula&apos;ya hoş geldin
              </h1>
              <p className={styles.lead}>
                Birkaç adımda tarayıcını kişiselleştirelim: yer işaretleri, Google hesabı ve şifreler.
              </p>
            </>
          )}

          {step === 'bookmarks' && (
            <>
              <h2 className={styles.title}>Yer işaretlerini aktar</h2>
              <p className={styles.lead}>
                {isTauri
                  ? browserInfo
                    ? browserInfo.bookmarksAvailable
                      ? `${browserInfo.displayName} yer işaretlerini semi-lunar menüne ekleyebiliriz.`
                      : `${browserInfo.displayName} için yer işaretleri bulunamadı. Bu adımı atlayabilirsin.`
                    : 'Varsayılan tarayıcı aranıyor…'
                  : 'Yer işareti içe aktarma masaüstü uygulamasında kullanılabilir. Şimdilik bu adımı atlayabilirsin.'}
              </p>

              {importedCount > 0 && (
                <p className={styles.success}>
                  {importedCount} site hazır — devam edince menüye eklenecek.
                </p>
              )}
              {importError && <p className={styles.error}>{importError}</p>}

              {isTauri && browserInfo?.bookmarksAvailable && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void handleImportBookmarks()}
                  disabled={importing}
                >
                  {importing ? 'Aktarılıyor…' : `${browserInfo.displayName} yer işaretlerini aktar`}
                </button>
              )}
            </>
          )}

          {step === 'profile' && (
            <>
              <h2 className={styles.title}>Profilini ayarla</h2>
              <p className={styles.lead}>
                Google ile giriş yaparsan bir sonraki adımda şifreleri ve site oturumunu bağlarız.
                İstersen sadece ismini de yazabilirsin.
              </p>

              {hasGoogleClient ? (
                <>
                  <button
                    type="button"
                    className={styles.googleBtn}
                    onClick={handleGoogleSignIn}
                    disabled={googleStarting}
                  >
                    <span className={styles.googleMark} aria-hidden="true">G</span>
                    {googleStarting
                      ? isTauri
                        ? 'Tarayıcıda Google açılıyor…'
                        : 'Google\'a yönlendiriliyor…'
                      : 'Google ile giriş yap'}
                  </button>
                  {isTauri ? (
                    <p className={styles.redirectHint}>
                      Sistem tarayıcında Google açılır; girişten sonra bu pencereye dön.
                    </p>
                  ) : (
                    <p className={styles.redirectHint}>
                      Google Console redirect URI:
                      <code>{redirectUri}</code>
                    </p>
                  )}
                  {googleConfigHint && <p className={styles.hint}>{googleConfigHint}</p>}
                  {googleError && <p className={styles.error}>{googleError}</p>}
                  <p className={styles.divider}>veya</p>
                </>
              ) : (
                <p className={styles.hint}>
                  Google girişi için geliştirici yapılandırması gerekir; şimdilik isim girebilirsin.
                </p>
              )}

              <label className={styles.fieldLabel}>
                Görünen ad
                <input
                  className={styles.textInput}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Adın"
                  maxLength={48}
                  autoComplete="nickname"
                />
              </label>
            </>
          )}

          {step === 'googleLink' && googleEmail && (
            <>
              <h2 className={styles.title}>Google hesabını bağla</h2>
              <GoogleAccountSetupPanel
                email={googleEmail}
                onOpenBrowseUrl={(url) => onOpenBrowseUrl?.(url)}
                onMergePasswords={(entries) => mergeImportedPasswords(entries)}
                onRequestCsvImport={() => csvInputRef.current?.click()}
                onApplied={completeGoogleLink}
                showSkip
                onSkip={skipGoogleLink}
              />
              {googleLinkMessage && <p className={styles.success}>{googleLinkMessage}</p>}
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className={styles.hiddenFileInput}
                onChange={(event) => void handleCsvSelected(event)}
              />
            </>
          )}

          {step === 'googleLink' && !googleEmail && (
            <>
              <h2 className={styles.title}>Google hesabını bağla</h2>
              <p className={styles.lead}>
                Bu adım için önce Google ile giriş yapman gerekir. Geri dönüp profil adımında giriş
                yapabilirsin.
              </p>
            </>
          )}

          {step === 'done' && (
            <>
              <h2 className={styles.title}>Hazırsın</h2>
              <p className={styles.lead}>
                {importedCount > 0
                  ? `${importedCount} yer işareti menüye eklenecek.`
                  : 'Semi-lunar menü ziyaret ettikçe dolacak.'}
                {displayName.trim()
                  ? ` Hoş geldin, ${displayName.trim()}.`
                  : ' İstediğin zaman ayarlardan profilini değiştirebilirsin.'}
              </p>
            </>
          )}
        </div>

        <footer className={styles.footer}>
          {stepIndex > 0 && step !== 'done' && step !== 'googleLink' && (
            <button type="button" className={styles.ghostBtn} onClick={goBack}>
              Geri
            </button>
          )}
          <div className={styles.footerSpacer} />
          {step === 'bookmarks' && (
            <button type="button" className={styles.ghostBtn} onClick={goNext}>
              Atla
            </button>
          )}
          {step === 'googleLink' && (
            <button type="button" className={styles.ghostBtn} onClick={skipGoogleLink}>
              Atla
            </button>
          )}
          {step !== 'googleLink' && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={step === 'done' ? finish : goNext}
            >
              {step === 'done' ? 'Başla' : 'Devam'}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
