import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  getSettingsCategories,
  type SettingsCategoryId,
} from '../../core/settingsCategories'
import { useLocale, type NebulaLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { showAppConfirmation } from '../../core/appDialog'
import type { NebulaSettings } from '../../core/nebulaSettings'
import type { WallpaperConfig } from '../../core/wallpaperConfig'
import { WallpaperSettingsSection } from './WallpaperSettingsSection'
import {
  SettingColorRow,
  SettingDangerRow,
  SettingRangeRow,
  SettingResetRow,
  SettingSelectRow,
  SettingTextRow,
  SettingToggleRow,
} from './SettingControls'
import { AboutUpdateSection } from './AboutUpdateSection'
import { AccountSettingsSection } from './AccountSettingsSection'
import styles from './SettingsPanel.module.css'
import type { NebulaAccount } from '../../core/nebulaAccount'
import type { BrowsingDataKind } from '../../platform/tauriBrowser'
import {
  browserShortcutBindingFromEvent,
  findBrowserShortcutConflict,
  formatBrowserShortcutBinding,
  validateBrowserShortcutBinding,
  type BrowserShortcutBindings,
  type ConfigurableBrowserShortcutId,
} from '../../core/browserShortcuts'

export interface SettingsAnchor {
  x: number
  y: number
}

interface ShortcutReferenceItem {
  id: ConfigurableBrowserShortcutId
  tr: string
  en: string
  noteTr?: string
  noteEn?: string
}

interface ShortcutReferenceGroup {
  tr: string
  en: string
  items: ShortcutReferenceItem[]
}

const SHORTCUT_REFERENCE: ShortcutReferenceGroup[] = [
  {
    tr: 'Sekmeler',
    en: 'Tabs',
    items: [
      { id: 'close-tab', tr: 'Aktif sekmeyi kapat', en: 'Close the active tab' },
      { id: 'reopen-tab', tr: 'Son kapatılan sekmeyi yeniden aç', en: 'Reopen the last closed tab' },
      { id: 'next-tab', tr: 'Sonraki sekmeye geç', en: 'Switch to the next tab' },
      { id: 'prev-tab', tr: 'Önceki sekmeye geç', en: 'Switch to the previous tab' },
      { id: 'switch-tab-1', tr: '1. sekmeye geç', en: 'Switch to tab 1' },
      { id: 'switch-tab-2', tr: '2. sekmeye geç', en: 'Switch to tab 2' },
      { id: 'switch-tab-3', tr: '3. sekmeye geç', en: 'Switch to tab 3' },
      { id: 'switch-tab-4', tr: '4. sekmeye geç', en: 'Switch to tab 4' },
      { id: 'switch-tab-5', tr: '5. sekmeye geç', en: 'Switch to tab 5' },
      { id: 'switch-tab-6', tr: '6. sekmeye geç', en: 'Switch to tab 6' },
      { id: 'switch-tab-7', tr: '7. sekmeye geç', en: 'Switch to tab 7' },
      { id: 'switch-tab-8', tr: '8. sekmeye geç', en: 'Switch to tab 8' },
      { id: 'switch-tab-last', tr: 'Son sekmeye geç', en: 'Switch to the last tab' },
    ],
  },
  {
    tr: 'Gezinme',
    en: 'Navigation',
    items: [
      { id: 'go-home', tr: 'Ana sayfaya dön', en: 'Go to Home' },
      { id: 'open-history', tr: 'Geçmişi aç', en: 'Open History' },
      { id: 'focus-url-bar', tr: 'Adres çubuğuna odaklan', en: 'Focus the address bar' },
      { id: 'go-back', tr: 'Geri git', en: 'Go back' },
      { id: 'go-forward', tr: 'İleri git', en: 'Go forward' },
      { id: 'reload', tr: 'Sayfayı yenile', en: 'Reload the page' },
    ],
  },
  {
    tr: 'Görünüm ve geliştirici',
    en: 'View and developer',
    items: [
      { id: 'zoom-in', tr: 'Yakınlaştır', en: 'Zoom in' },
      { id: 'zoom-out', tr: 'Uzaklaştır', en: 'Zoom out' },
      { id: 'zoom-reset', tr: 'Yakınlaştırmayı sıfırla', en: 'Reset zoom' },
      { id: 'print', tr: 'Sayfayı yazdır', en: 'Print the current page' },
      { id: 'toggle-fullscreen', tr: 'Tam ekranı aç/kapat', en: 'Toggle fullscreen' },
      { id: 'devtools', tr: 'Geliştirici araçlarını aç', en: 'Open Developer Tools' },
    ],
  },
]

const SHORTCUT_LABELS = new Map(
  SHORTCUT_REFERENCE.flatMap((group) =>
    group.items.map((item) => [item.id, item] as const),
  ),
)

function ShortcutReference({
  locale,
  bindings,
  onSetBinding,
  onResetBinding,
  onResetAll,
}: {
  locale: NebulaLocale
  bindings: BrowserShortcutBindings
  onSetBinding: (action: ConfigurableBrowserShortcutId, binding: string) => boolean
  onResetBinding: (action: ConfigurableBrowserShortcutId) => boolean
  onResetAll: () => void
}) {
  const isTr = locale === 'tr'
  const [recordingAction, setRecordingAction] =
    useState<ConfigurableBrowserShortcutId | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const actionLabel = useCallback(
    (action: ConfigurableBrowserShortcutId) => {
      const item = SHORTCUT_LABELS.get(action)
      return item ? (isTr ? item.tr : item.en) : action
    },
    [isTr],
  )

  const stopRecording = useCallback(() => {
    setRecordingAction(null)
    setMessage(null)
  }, [])

  const handleRecordingKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!recordingAction) return

      event.preventDefault()
      event.stopPropagation()

      if (
        event.key === 'Escape' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey
      ) {
        stopRecording()
        return
      }

      const binding = browserShortcutBindingFromEvent(event.nativeEvent)
      if (!binding) return

      const validation = validateBrowserShortcutBinding(binding)
      if (validation.ok === false) {
        setMessage(
          validation.reason === 'reserved'
            ? isTr
              ? 'Bu kombinasyon Windows veya Nebula tarafından ayrılmış.'
              : 'This combination is reserved by Windows or Nebula.'
            : validation.reason === 'needs-modifier'
              ? isTr
                ? 'Harf, sayı ve gezinme tuşları için Ctrl veya Alt kullan.'
                : 'Use Ctrl or Alt with letters, numbers, and navigation keys.'
              : isTr
                ? 'Bu tuş kombinasyonu site WebView’larında güvenilir biçimde desteklenmiyor.'
                : 'This key combination is not reliably supported inside site WebViews.',
        )
        return
      }

      const conflict = findBrowserShortcutConflict(bindings, binding, recordingAction)
      if (conflict) {
        setMessage(
          isTr
            ? `${formatBrowserShortcutBinding(binding)} zaten “${actionLabel(conflict)}” için kullanılıyor.`
            : `${formatBrowserShortcutBinding(binding)} is already used by “${actionLabel(conflict)}”.`,
        )
        return
      }

      if (!onSetBinding(recordingAction, binding)) {
        setMessage(
          isTr
            ? 'Kısayol değiştirilemedi; çakışma olup olmadığını kontrol et.'
            : 'The shortcut could not be changed; check for a conflict.',
        )
        return
      }

      setRecordingAction(null)
      setMessage(
        isTr
          ? `${formatBrowserShortcutBinding(binding)} kaydedildi.`
          : `${formatBrowserShortcutBinding(binding)} saved.`,
      )
    },
    [actionLabel, bindings, isTr, onSetBinding, recordingAction, stopRecording],
  )

  return (
    <div className={styles.shortcutGroups} onKeyDownCapture={handleRecordingKeyDown}>
      <p className={styles.shortcutIntro}>
        {isTr
          ? 'Bir eylemde Değiştir’e basıp yeni kombinasyona bas. Değişiklikler Home, Semi-Lunar ve site sekmeleri arasında anında eşitlenir.'
          : 'Choose Change on an action, then press the new combination. Changes sync immediately across Home, Semi-Lunar, and site tabs.'}
      </p>

      {message && (
        <div className={styles.shortcutMessage} role="status" aria-live="polite">
          {message}
        </div>
      )}

      {SHORTCUT_REFERENCE.map((group) => (
        <section key={group.en} className={styles.shortcutGroup}>
          <h3 className={styles.shortcutGroupTitle}>{isTr ? group.tr : group.en}</h3>
          <div className={styles.shortcutList}>
            {group.items.map((item) => {
              const isRecording = recordingAction === item.id
              return (
                <div key={item.id} className={styles.shortcutRow}>
                  <div className={styles.shortcutText}>
                    <div className={styles.shortcutLabel}>{isTr ? item.tr : item.en}</div>
                    {(isTr ? item.noteTr : item.noteEn) && (
                      <div className={styles.shortcutNote}>{isTr ? item.noteTr : item.noteEn}</div>
                    )}
                  </div>

                  <div className={styles.shortcutEditor}>
                    <div className={styles.shortcutKeySet} aria-label={bindings[item.id].join(' / ')}>
                      {bindings[item.id].map((binding, index) => (
                        <span key={binding} className={styles.shortcutKeyWrap}>
                          {index > 0 && <span className={styles.shortcutOr}>/</span>}
                          <kbd className={styles.shortcutKey}>
                            {formatBrowserShortcutBinding(binding)}
                          </kbd>
                        </span>
                      ))}
                    </div>
                    <div className={styles.shortcutActions}>
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${isRecording ? styles.shortcutRecordingBtn : ''}`}
                        onClick={() => {
                          setMessage(null)
                          setRecordingAction((current) => (current === item.id ? null : item.id))
                        }}
                      >
                        {isRecording
                          ? isTr
                            ? 'Tuşlara bas…'
                            : 'Press keys…'
                          : isTr
                            ? 'Değiştir'
                            : 'Change'}
                      </button>
                      <button
                        type="button"
                        className={styles.shortcutResetBtn}
                        onClick={() => {
                          setRecordingAction(null)
                          const ok = onResetBinding(item.id)
                          setMessage(
                            ok
                              ? null
                              : isTr
                                ? 'Varsayılan kombinasyon başka bir eylem tarafından kullanılıyor. Önce o kısayolu değiştir veya tümünü sıfırla.'
                                : 'The default combination is used by another action. Change that shortcut first or reset all.',
                          )
                        }}
                      >
                        {isTr ? 'Sıfırla' : 'Reset'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <div className={styles.shortcutFooter}>
        <div>
          <div className={styles.rowLabel}>{isTr ? 'Klavye navigasyonu' : 'Keyboard navigation'}</div>
          <div className={styles.rowHint}>
            {isTr
              ? 'Esc, Tab / Shift+Tab, Enter, Space, ok tuşları, Home ve End erişilebilirlik için sabit kalır.'
              : 'Esc, Tab / Shift+Tab, Enter, Space, arrow keys, Home, and End stay fixed for accessibility.'}
          </div>
        </div>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => {
            setRecordingAction(null)
            setMessage(null)
            onResetAll()
          }}
        >
          {isTr ? 'Tümünü varsayılana döndür' : 'Reset all to defaults'}
        </button>
      </div>
    </div>
  )
}

interface SettingsPanelProps {
  open: boolean
  anchor: SettingsAnchor | null
  onClose: () => void
  wallpaperConfig: WallpaperConfig
  onUpdateWallpaper: (patch: Partial<WallpaperConfig>) => void
  onPickWallpaper: () => void
  onPickVideoWallpaper: () => void
  onResetWallpaper: () => void
  onResetShortcuts: () => void
  onClearSavedSession: () => void
  onResetSemiLunarLayout: () => void
  onResetFolders: () => void
  shortcutBindings: BrowserShortcutBindings
  onSetShortcutBinding: (action: ConfigurableBrowserShortcutId, binding: string) => boolean
  onResetShortcutBinding: (action: ConfigurableBrowserShortcutId) => boolean
  onResetAllShortcutBindings: () => void
  settings: NebulaSettings
  onUpdate: <C extends keyof NebulaSettings, K extends keyof NebulaSettings[C]>(
    category: C,
    key: K,
    value: NebulaSettings[C][K],
  ) => void
  onResetCategory: (category: keyof NebulaSettings) => void
  onTogglePreviewOnHover: () => void
  onEnterHomeEdit: () => void
  onFactoryReset: () => void
  onClearBrowsingData: (kind?: BrowsingDataKind) => void | Promise<void>
  activeUrl?: string | null
  ublockVersion?: string | null
  ublockEnabled?: boolean
  account: NebulaAccount | null
  onAccountChange: (account: NebulaAccount) => void
  onAccountSignOut: () => void
  onReopenOnboarding: () => void
  onOpenBrowseUrl?: (url: string) => void
}

function CategoryContent({
  categoryId,
  wallpaperConfig,
  onUpdateWallpaper,
  onPickWallpaper,
  onPickVideoWallpaper,
  onResetWallpaper,
  onResetShortcuts,
  onClearSavedSession,
  onResetSemiLunarLayout,
  onResetFolders,
  shortcutBindings,
  onSetShortcutBinding,
  onResetShortcutBinding,
  onResetAllShortcutBindings,
  settings,
  onUpdate,
  onResetCategory,
  onTogglePreviewOnHover,
  onEnterHomeEdit,
  onFactoryReset,
  onClearBrowsingData,
  activeUrl,
  ublockVersion,
  ublockEnabled,
  account,
  onAccountChange,
  onAccountSignOut,
  onReopenOnboarding,
  onOpenBrowseUrl,
}: {
  categoryId: SettingsCategoryId
  wallpaperConfig: WallpaperConfig
  onUpdateWallpaper: (patch: Partial<WallpaperConfig>) => void
  onPickWallpaper: () => void
  onPickVideoWallpaper: () => void
  onResetWallpaper: () => void
  onResetShortcuts: () => void
  onClearSavedSession: () => void
  onResetSemiLunarLayout: () => void
  onResetFolders: () => void
  shortcutBindings: BrowserShortcutBindings
  onSetShortcutBinding: (action: ConfigurableBrowserShortcutId, binding: string) => boolean
  onResetShortcutBinding: (action: ConfigurableBrowserShortcutId) => boolean
  onResetAllShortcutBindings: () => void
  settings: NebulaSettings
  onUpdate: SettingsPanelProps['onUpdate']
  onResetCategory: SettingsPanelProps['onResetCategory']
  onTogglePreviewOnHover: () => void
  onEnterHomeEdit: () => void
  onFactoryReset: () => void
  onClearBrowsingData: (kind?: BrowsingDataKind) => void | Promise<void>
  activeUrl?: string | null
  ublockVersion?: string | null
  ublockEnabled?: boolean
  account: NebulaAccount | null
  onAccountChange: (account: NebulaAccount) => void
  onAccountSignOut: () => void
  onReopenOnboarding: () => void
  onOpenBrowseUrl?: (url: string) => void
}) {
  const { t, locale, setLocale } = useLocale()
  const clearingBrowsingDataRef = useRef(false)
  const [clearingBrowsingDataKind, setClearingBrowsingDataKind] =
    useState<BrowsingDataKind | null>(null)
  const [clearBrowsingDataStatus, setClearBrowsingDataStatus] =
    useState<'idle' | 'cleared' | 'failed'>('idle')
  const { appearance, home, semiLunar, browsing, privacy, notifications } = settings
  let activeHost = ''
  try {
    activeHost = activeUrl ? new URL(activeUrl).hostname.toLowerCase() : ''
  } catch {
    activeHost = ''
  }
  const exceptionHosts = privacy.siteExceptions.split(/[\s,;]+/).filter(Boolean)
  const permissionHosts = privacy.permissionExceptions.split(/[\s,;]+/).filter(Boolean)
  const activeSiteExcepted = activeHost
    ? exceptionHosts.some((host) => activeHost === host || activeHost.endsWith(`.${host}`))
    : false
  const toggleActiveSiteException = () => {
    if (!activeHost) return
    const next = activeSiteExcepted
      ? exceptionHosts.filter((host) => host !== activeHost)
      : [...exceptionHosts, activeHost]
    onUpdate('privacy', 'siteExceptions', next.join(', '))
  }
  const activeSitePermissionAllowed = activeHost
    ? permissionHosts.some((host) => activeHost === host || activeHost.endsWith(`.${host}`))
    : false
  const toggleActiveSitePermission = () => {
    if (!activeHost) return
    const next = activeSitePermissionAllowed
      ? permissionHosts.filter((host) => host !== activeHost)
      : [...permissionHosts, activeHost]
    onUpdate('privacy', 'permissionExceptions', next.join(', '))
  }
  const requestClearBrowsingData = async (kind: BrowsingDataKind) => {
    if (clearingBrowsingDataRef.current) return
    const accepted = await showAppConfirmation(
      t('clearBrowsingDataConfirm'),
      t('clearBrowsingData'),
    )
    if (!accepted) return

    clearingBrowsingDataRef.current = true
    setClearingBrowsingDataKind(kind)
    setClearBrowsingDataStatus('idle')
    try {
      await onClearBrowsingData(kind)
      setClearBrowsingDataStatus('cleared')
    } catch (error) {
      console.error('[nebula privacy] Failed to clear browsing data.', error)
      setClearBrowsingDataStatus('failed')
    } finally {
      clearingBrowsingDataRef.current = false
      setClearingBrowsingDataKind(null)
    }
  }

  switch (categoryId) {
    case 'appearance':
      return (
        <>
          <SettingSelectRow
            label={t('settingsLanguage')}
            hint={t('settingsLanguageHint')}
            value={locale}
            options={[
              { value: 'tr', label: t('languageTurkish') },
              { value: 'en', label: t('languageEnglish') },
            ]}
            onChange={(value) => setLocale(value as NebulaLocale)}
          />
          <WallpaperSettingsSection
            config={wallpaperConfig}
            onChange={onUpdateWallpaper}
            onPickImage={onPickWallpaper}
            onPickVideo={onPickVideoWallpaper}
            onReset={onResetWallpaper}
          />
          <SettingSelectRow
            label={t('theme')}
            hint={t('themeHint')}
            value={appearance.theme}
            options={[
              { value: 'forest', label: t('themeForest') },
              { value: 'dark', label: t('themeDark') },
              { value: 'light', label: t('themeLight') },
            ]}
            onChange={(v) =>
              onUpdate('appearance', 'theme', v as NebulaSettings['appearance']['theme'])
            }
          />
          <SettingRangeRow
            label={t('glassBlur')}
            hint={t('glassBlurHint')}
            value={appearance.glassBlurPx}
            min={0}
            max={80}
            step={1}
            unit=" px"
            onChange={(v) => onUpdate('appearance', 'glassBlurPx', v)}
          />
          <SettingRangeRow
            label={t('glassOpacity')}
            hint={t('glassOpacityHint')}
            value={appearance.glassOpacity}
            min={0}
            max={40}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('appearance', 'glassOpacity', v)}
          />
          <SettingRangeRow
            label={t('glassSaturate')}
            hint={t('glassSaturateHint')}
            value={Math.round(appearance.glassSaturate * 10)}
            min={5}
            max={30}
            step={1}
            unit="×0.1"
            onChange={(v) => onUpdate('appearance', 'glassSaturate', v / 10)}
          />
          <SettingColorRow
            label={t('accentColor')}
            hint={t('accentColorHint')}
            value={appearance.accentColor}
            onChange={(v) => onUpdate('appearance', 'accentColor', v)}
          />
          <SettingColorRow
            label={t('goldColor')}
            hint={t('goldColorHint')}
            value={appearance.goldColor}
            onChange={(v) => onUpdate('appearance', 'goldColor', v)}
          />
          <SettingRangeRow
            label={t('lunarGlassBlur')}
            hint={t('lunarGlassBlurHint')}
            value={appearance.lunarGlassBlurPx}
            min={0}
            max={160}
            step={1}
            unit=" px"
            onChange={(v) => onUpdate('appearance', 'lunarGlassBlurPx', v)}
          />
          <SettingRangeRow
            label={t('lunarGlassOpacity')}
            hint={t('lunarGlassOpacityHint')}
            value={appearance.lunarGlassOpacity}
            min={20}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('appearance', 'lunarGlassOpacity', v)}
          />
          <SettingResetRow
            label={t('appearanceReset')}
            hint={t('appearanceResetHint')}
            onReset={() => onResetCategory('appearance')}
          />
        </>
      )
    case 'home':
      return (
        <>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{t('editUi')}</div>
              <div className={styles.rowHint}>{t('editUiHint')}</div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onEnterHomeEdit}>
              {t('editBtn')}
            </button>
          </div>
          <SettingToggleRow
            label={t('toolbar')}
            hint={t('toolbarHint')}
            checked={home.showToolbar}
            onChange={() => onUpdate('home', 'showToolbar', !home.showToolbar)}
          />
          <SettingToggleRow
            label={t('systemWidgets')}
            hint={t('systemWidgetsHint')}
            checked={home.showSystemWidgets}
            onChange={() => onUpdate('home', 'showSystemWidgets', !home.showSystemWidgets)}
          />
          <SettingToggleRow
            label={t('ramWidget')}
            hint={t('ramWidgetHint')}
            checked={home.showRamWidget}
            onChange={() => onUpdate('home', 'showRamWidget', !home.showRamWidget)}
          />
          <SettingToggleRow
            label={t('cpuWidget')}
            hint={t('cpuWidgetHint')}
            checked={home.showCpuWidget}
            onChange={() => onUpdate('home', 'showCpuWidget', !home.showCpuWidget)}
          />
          <SettingToggleRow
            label={t('clock')}
            hint={t('clockHint')}
            checked={home.showClock}
            onChange={() => onUpdate('home', 'showClock', !home.showClock)}
          />
          {home.showClock && (
            <>
              <SettingRangeRow
                label={t('clockFontSize')}
                hint={t('clockFontSizeHint')}
                value={home.clockFontSize}
                min={24}
                max={72}
                step={2}
                unit=" px"
                onChange={(v) => onUpdate('home', 'clockFontSize', v)}
              />
              <SettingSelectRow
                label={t('clockFontWeight')}
                hint={t('clockFontWeightHint')}
                value={String(home.clockFontWeight)}
                options={[
                  { value: '300', label: t('clockFontWeight300') },
                  { value: '400', label: t('clockFontWeight400') },
                  { value: '500', label: t('clockFontWeight500') },
                  { value: '600', label: t('clockFontWeight600') },
                ]}
                onChange={(v) => onUpdate('home', 'clockFontWeight', Number(v))}
              />
              <SettingSelectRow
                label={t('clockFontFamily')}
                hint={t('clockFontFamilyHint')}
                value={home.clockFontFamily}
                options={[
                  { value: 'system', label: t('clockFontSystem') },
                  { value: 'light', label: t('clockFontLight') },
                  { value: 'serif', label: t('clockFontSerif') },
                  { value: 'mono', label: t('clockFontMono') },
                ]}
                onChange={(v) =>
                  onUpdate('home', 'clockFontFamily', v as NebulaSettings['home']['clockFontFamily'])
                }
              />
              <SettingToggleRow
                label={t('clockShowDate')}
                hint={t('clockShowDateHint')}
                checked={home.clockShowDate}
                onChange={() => onUpdate('home', 'clockShowDate', !home.clockShowDate)}
              />
            </>
          )}
          <SettingToggleRow
            label={t('pinnedSites')}
            hint={t('pinnedSitesHint')}
            checked={home.showPinnedStrip}
            onChange={() => onUpdate('home', 'showPinnedStrip', !home.showPinnedStrip)}
          />
          <SettingToggleRow
            label={t('greeting')}
            hint={t('greetingHint')}
            checked={home.showGreeting}
            onChange={() => onUpdate('home', 'showGreeting', !home.showGreeting)}
          />
          <SettingToggleRow
            label={t('profileAvatar')}
            hint={t('profileAvatarHint')}
            checked={home.showProfile}
            onChange={() => onUpdate('home', 'showProfile', !home.showProfile)}
          />
          <SettingTextRow
            label={t('username')}
            hint={t('usernameHint')}
            value={home.userDisplayName}
            onChange={(v) => onUpdate('home', 'userDisplayName', v)}
          />
          <SettingSelectRow
            label={t('searchEngine')}
            hint={t('searchEngineHint')}
            value={home.searchEngine}
            options={[
              { value: 'google', label: 'Google' },
              { value: 'duckduckgo', label: 'DuckDuckGo' },
              { value: 'bing', label: 'Bing' },
            ]}
            onChange={(v) =>
              onUpdate('home', 'searchEngine', v as NebulaSettings['home']['searchEngine'])
            }
          />
          <SettingToggleRow
            label={locale === 'tr' ? 'Son oturumdaki sekmeleri yeniden aç' : 'Reopen tabs from the last session'}
            hint={
              locale === 'tr'
                ? 'Nebula normal şekilde kapatıldığında açık sekmeleri bir sonraki açılışta geri getirir. Çökme kurtarma sistemi bundan bağımsız çalışır.'
                : 'Restores open tabs on the next launch after Nebula closes normally. Crash recovery remains independent.'
            }
            checked={browsing.restoreTabsOnStartup}
            onChange={() =>
              onUpdate('browsing', 'restoreTabsOnStartup', !browsing.restoreTabsOnStartup)
            }
          />
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>
                {locale === 'tr' ? 'Kaydedilmiş sekme oturumunu temizle' : 'Clear saved tab session'}
              </div>
              <div className={styles.rowHint}>
                {locale === 'tr'
                  ? 'Şu anda saklanan önceki oturum anlık olarak silinir. Açık sekmeler çalışmaya devam eder.'
                  : 'Deletes the currently saved previous-session snapshot. Open tabs keep running.'}
              </div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onClearSavedSession}>
              {locale === 'tr' ? 'Temizle' : 'Clear'}
            </button>
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{t('resetShortcuts')}</div>
              <div className={styles.rowHint}>{t('resetShortcutsHint')}</div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onResetShortcuts}>
              {t('reset')}
            </button>
          </div>
          <SettingResetRow
            label={t('homeReset')}
            hint={t('homeResetHint')}
            onReset={() => onResetCategory('home')}
          />
        </>
      )
    case 'semi-lunar':
      return (
        <>
          <SettingToggleRow
            label={t('slHomeAlwaysOpen')}
            hint={t('slHomeAlwaysOpenHint')}
            checked={semiLunar.homeAlwaysOpen}
            onChange={() => onUpdate('semiLunar', 'homeAlwaysOpen', !semiLunar.homeAlwaysOpen)}
          />
          <SettingToggleRow
            label={t('slBrowsingHover')}
            hint={t('slBrowsingHoverHint')}
            checked={semiLunar.browsingHoverOpen}
            onChange={() =>
              onUpdate('semiLunar', 'browsingHoverOpen', !semiLunar.browsingHoverOpen)
            }
          />
          <SettingRangeRow
            label={t('slBrowsingDelay')}
            hint={t('slBrowsingDelayHint')}
            value={semiLunar.browsingOpenDelayMs}
            min={0}
            max={5000}
            step={100}
            unit=" ms"
            disabled={!semiLunar.browsingHoverOpen}
            onChange={(v) => onUpdate('semiLunar', 'browsingOpenDelayMs', v)}
          />
          <SettingToggleRow
            label={t('slPreviewHover')}
            hint={t('slPreviewHoverHint')}
            checked={semiLunar.previewOnHover}
            onChange={onTogglePreviewOnHover}
          />
          <SettingToggleRow
            label={t('slReducedMotion')}
            hint={t('slReducedMotionHint')}
            checked={semiLunar.reducedMotion}
            onChange={() => onUpdate('semiLunar', 'reducedMotion', !semiLunar.reducedMotion)}
          />
          <SettingRangeRow
            label={t('slPreviewDelay')}
            hint={t('slPreviewDelayHint')}
            value={semiLunar.previewDelayMs}
            min={200}
            max={3000}
            step={100}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'previewDelayMs', v)}
          />
          <SettingRangeRow
            label={t('slCloseDelay')}
            hint={t('slCloseDelayHint')}
            value={semiLunar.closeDelayMs}
            min={0}
            max={800}
            step={50}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'closeDelayMs', v)}
          />
          <SettingRangeRow
            label={t('slOpenDuration')}
            hint={t('slOpenDurationHint')}
            value={semiLunar.openDurationMs}
            min={0}
            max={600}
            step={20}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'openDurationMs', v)}
          />
          <SettingRangeRow
            label={t('slCloseDuration')}
            hint={t('slCloseDurationHint')}
            value={semiLunar.closeDurationMs}
            min={0}
            max={400}
            step={10}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'closeDurationMs', v)}
          />
          <SettingRangeRow
            label={t('slScaleX')}
            hint={t('slScaleXHint')}
            value={Math.round(semiLunar.scaleX * 100)}
            min={5}
            max={50}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('semiLunar', 'scaleX', v / 100)}
          />
          <SettingRangeRow
            label={t('slScaleY')}
            hint={t('slScaleYHint')}
            value={Math.round(semiLunar.scaleY * 100)}
            min={5}
            max={50}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('semiLunar', 'scaleY', v / 100)}
          />
          <SettingRangeRow
            label={t('slCloseBtnDelay')}
            hint={t('slCloseBtnDelayHint')}
            value={semiLunar.closeBtnDelayMs}
            min={0}
            max={1200}
            step={50}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'closeBtnDelayMs', v)}
          />
          <SettingRangeRow
            label={t('slFolderMerge')}
            hint={t('slFolderMergeHint')}
            value={semiLunar.folderMergeHoldMs}
            min={200}
            max={2000}
            step={50}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'folderMergeHoldMs', v)}
          />
          <SettingRangeRow
            label={t('slMergeAnim')}
            hint={t('slMergeAnimHint')}
            value={semiLunar.mergeAnimMs}
            min={100}
            max={1200}
            step={20}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'mergeAnimMs', v)}
          />
          <SettingRangeRow
            label={t('slIconSize')}
            hint={t('slIconSizeHint')}
            value={semiLunar.iconSizePx}
            min={32}
            max={64}
            step={2}
            unit=" px"
            onChange={(v) => onUpdate('semiLunar', 'iconSizePx', v)}
          />
          <SettingRangeRow
            label={t('slLunarWidth')}
            hint={t('slLunarWidthHint')}
            value={semiLunar.lunarWidthPx}
            min={600}
            max={1400}
            step={20}
            unit=" px"
            onChange={(v) => onUpdate('semiLunar', 'lunarWidthPx', v)}
          />
          <SettingRangeRow
            label={t('slLunarHeight')}
            hint={t('slLunarHeightHint')}
            value={semiLunar.lunarHeightPx}
            min={100}
            max={220}
            step={4}
            unit=" px"
            onChange={(v) => onUpdate('semiLunar', 'lunarHeightPx', v)}
          />
          <SettingRangeRow
            label={t('overlayBlur')}
            hint={t('overlayBlurHint')}
            value={browsing.overlayBlurPx}
            min={0}
            max={40}
            step={1}
            unit=" px"
            onChange={(v) => onUpdate('browsing', 'overlayBlurPx', v)}
          />
          <SettingRangeRow
            label={t('overlayBrightness')}
            hint={t('overlayBrightnessHint')}
            value={browsing.overlayBrightnessPercent}
            min={20}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => onUpdate('browsing', 'overlayBrightnessPercent', v)}
          />
          <SettingToggleRow
            label={locale === 'tr' ? 'İkon yerleşimini hatırla' : 'Remember icon layout'}
            hint={
              locale === 'tr'
                ? 'Semi-Lunar ikon konumlarını normal kapanışlar arasında saklar.'
                : 'Keeps Semi-Lunar icon positions between normal restarts.'
            }
            checked={semiLunar.rememberLayout}
            onChange={() =>
              onUpdate('semiLunar', 'rememberLayout', !semiLunar.rememberLayout)
            }
          />
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>
                {locale === 'tr' ? 'Semi-Lunar yerleşimini sıfırla' : 'Reset Semi-Lunar layout'}
              </div>
              <div className={styles.rowHint}>
                {locale === 'tr'
                  ? 'Kaydedilmiş ikon konumlarını silip varsayılan yerleşime döner.'
                  : 'Clears saved icon positions and returns to the default layout.'}
              </div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onResetSemiLunarLayout}>
              {locale === 'tr' ? 'Sıfırla' : 'Reset'}
            </button>
          </div>
          <SettingToggleRow
            label={locale === 'tr' ? 'Klasörleri hatırla' : 'Remember folders'}
            hint={
              locale === 'tr'
                ? 'Semi-Lunar klasör yapısını normal kapanışlar arasında saklar.'
                : 'Keeps the Semi-Lunar folder structure between normal restarts.'
            }
            checked={semiLunar.rememberFolders}
            onChange={() =>
              onUpdate('semiLunar', 'rememberFolders', !semiLunar.rememberFolders)
            }
          />
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>
                {locale === 'tr' ? 'Klasörleri sıfırla' : 'Reset folders'}
              </div>
              <div className={styles.rowHint}>
                {locale === 'tr'
                  ? 'Tüm Semi-Lunar klasörlerini çözer; sekme ve site kısayollarını silmez.'
                  : 'Dissolves all Semi-Lunar folders without deleting tabs or site shortcuts.'}
              </div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onResetFolders}>
              {locale === 'tr' ? 'Sıfırla' : 'Reset'}
            </button>
          </div>
          <SettingResetRow
            label={t('slReset')}
            hint={t('slResetHint')}
            onReset={() => onResetCategory('semiLunar')}
          />
        </>
      )
    case 'shortcuts':
      return (
        <ShortcutReference
          locale={locale}
          bindings={shortcutBindings}
          onSetBinding={onSetShortcutBinding}
          onResetBinding={onResetShortcutBinding}
          onResetAll={onResetAllShortcutBindings}
        />
      )
    case 'account':
      return (
        <AccountSettingsSection
          account={account}
          userDisplayName={home.userDisplayName}
          onAccountChange={onAccountChange}
          onDisplayNameChange={(name) => onUpdate('home', 'userDisplayName', name)}
          onSignOut={onAccountSignOut}
          onReopenOnboarding={onReopenOnboarding}
          onOpenBrowseUrl={onOpenBrowseUrl}
        />
      )
    case 'privacy':
      return (
        <>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>uBlock Origin Lite</div>
              <div className={styles.rowHint}>{ublockVersion ? `${ublockEnabled ? t('ublockActive') : t('ublockReady')} · v${ublockVersion}` : t('ublockUnavailable')}</div>
            </div>
            <span className={ublockEnabled ? styles.statusActive : styles.statusInactive}>
              {ublockEnabled ? t('active') : ublockVersion ? t('ready') : t('unavailable')}
            </span>
          </div>
          <SettingSelectRow
            label={t('trackingLevel')}
            hint={t('trackingLevelHint')}
            value={privacy.trackingLevel}
            options={[
              { value: 'none', label: t('trackingNone') },
              { value: 'balanced', label: t('trackingBalanced') },
              { value: 'strict', label: t('trackingStrict') },
            ]}
            onChange={(value) => onUpdate('privacy', 'trackingLevel', value as NebulaSettings['privacy']['trackingLevel'])}
          />
          <SettingToggleRow
            label={t('blockTrackers')}
            hint={t('blockTrackersHint')}
            checked={privacy.blockTrackers}
            onChange={() => onUpdate('privacy', 'blockTrackers', !privacy.blockTrackers)}
          />
          <SettingToggleRow
            label={t('strictCookies')}
            hint={t('strictCookiesHint')}
            checked={privacy.strictCookies}
            onChange={() => onUpdate('privacy', 'strictCookies', !privacy.strictCookies)}
          />
          <SettingToggleRow
            label={t('httpsOnly')}
            hint={t('httpsOnlyHint')}
            checked={privacy.httpsOnly}
            onChange={() => onUpdate('privacy', 'httpsOnly', !privacy.httpsOnly)}
          />
          <SettingToggleRow
            label={t('globalPrivacyControl')}
            hint={t('globalPrivacyControlHint')}
            checked={privacy.globalPrivacyControl}
            onChange={() => onUpdate('privacy', 'globalPrivacyControl', !privacy.globalPrivacyControl)}
          />
          <SettingSelectRow
            label={t('permissionPolicy')}
            hint={t('permissionPolicyHint')}
            value={privacy.permissionPolicy}
            options={[
              { value: 'ask', label: t('permissionAsk') },
              { value: 'block', label: t('permissionBlock') },
            ]}
            onChange={(value) => onUpdate('privacy', 'permissionPolicy', value as NebulaSettings['privacy']['permissionPolicy'])}
          />
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{t('currentSitePermissions')}</div>
              <div className={styles.rowHint}>{activeHost ? `${activeHost} · ${activeSitePermissionAllowed ? t('permissionSiteAsk') : t('permissionSiteDefault')}` : t('siteShieldUnavailable')}</div>
            </div>
            <button type="button" className={styles.actionBtn} disabled={!activeHost} onClick={toggleActiveSitePermission}>
              {activeSitePermissionAllowed ? t('removePermissionException') : t('allowPermissionPrompts')}
            </button>
          </div>
          <SettingToggleRow
            label={t('cookieBannerBlocking')}
            hint={t('cookieBannerBlockingHint')}
            checked={privacy.cookieBannerBlocking}
            onChange={() => onUpdate('privacy', 'cookieBannerBlocking', !privacy.cookieBannerBlocking)}
          />
          <SettingTextRow
            label={t('permissionExceptions')}
            hint={t('permissionExceptionsHint')}
            value={privacy.permissionExceptions}
            onChange={(value) => onUpdate('privacy', 'permissionExceptions', value)}
          />
          <SettingToggleRow
            label={t('privateMode')}
            hint={t('privateModeHint')}
            checked={privacy.privateMode}
            onChange={() => onUpdate('privacy', 'privateMode', !privacy.privateMode)}
          />
          <SettingToggleRow
            label={t('clearOnExit')}
            hint={t('clearOnExitHint')}
            checked={privacy.clearOnExit}
            onChange={() => onUpdate('privacy', 'clearOnExit', !privacy.clearOnExit)}
          />
          <SettingTextRow
            label={t('privacyExceptions')}
            hint={t('privacyExceptionsHint')}
            value={privacy.siteExceptions}
            onChange={(value) => onUpdate('privacy', 'siteExceptions', value)}
          />
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{t('siteShield')}</div>
              <div className={styles.rowHint}>{activeHost ? `${activeHost} · ${activeSiteExcepted ? t('siteShieldOff') : t('siteShieldOn')}` : t('siteShieldUnavailable')}</div>
            </div>
            <button type="button" className={styles.actionBtn} disabled={!activeHost} onClick={toggleActiveSiteException}>
              {activeSiteExcepted ? t('enableForSite') : t('disableForSite')}
            </button>
          </div>
          <SettingTextRow
            label={t('customBlockList')}
            hint={t('customBlockListHint')}
            value={privacy.customBlockList}
            onChange={(value) => onUpdate('privacy', 'customBlockList', value)}
          />
          <div className={styles.row}>
            <div className={styles.rowText}><div className={styles.rowLabel}>{t('clearBrowsingData')}</div><div className={styles.rowHint}>{t('clearBrowsingDataHint')}</div></div>
            <div className={styles.privacyActionGrid}>
              {(['cookies', 'cache', 'history', 'permissions'] as const).map((kind) => (
                <button key={kind} type="button" className={styles.actionBtn} disabled={clearingBrowsingDataKind !== null} onClick={() => void requestClearBrowsingData(kind)}>{clearingBrowsingDataKind === kind ? t('clearBrowsingDataWorking') : t(`clear_${kind}`)}</button>
              ))}
              <button type="button" className={styles.dangerBtn} disabled={clearingBrowsingDataKind !== null} onClick={() => void requestClearBrowsingData('all')}>{clearingBrowsingDataKind === 'all' ? t('clearBrowsingDataWorking') : t('clearAll')}</button>
            </div>
            {clearBrowsingDataStatus !== 'idle' && (
              <div className={styles.rowHint} role="status" aria-live="polite">
                {t(clearBrowsingDataStatus === 'cleared' ? 'clearBrowsingDataSuccess' : 'clearBrowsingDataFailed')}
              </div>
            )}
          </div>
          <SettingResetRow
            label={t('privacyReset')}
            hint={t('privacyResetHint')}
            onReset={() => onResetCategory('privacy')}
          />
        </>
      )
    case 'notifications':
      return (
        <>
          <SettingToggleRow
            label={t('focusAlerts')}
            hint={t('focusAlertsHint')}
            checked={notifications.focusModeAlerts}
            onChange={() =>
              onUpdate('notifications', 'focusModeAlerts', !notifications.focusModeAlerts)
            }
          />
          <SettingToggleRow
            label={t('siteNotifications')}
            hint={t('siteNotificationsHint')}
            checked={notifications.siteNotifications}
            onChange={() =>
              onUpdate('notifications', 'siteNotifications', !notifications.siteNotifications)
            }
          />
          <SettingToggleRow
            label={t('toolbarBadge')}
            hint={t('toolbarBadgeHint')}
            checked={notifications.showToolbarBadge}
            onChange={() =>
              onUpdate('notifications', 'showToolbarBadge', !notifications.showToolbarBadge)
            }
          />
          <SettingResetRow
            label={t('notificationsReset')}
            hint={t('notificationsResetHint')}
            onReset={() => onResetCategory('notifications')}
          />
        </>
      )
    case 'about':
      return (
        <>
          <AboutUpdateSection />
          <SettingDangerRow
            label={t('factoryReset')}
            hint={t('factoryResetHint')}
            confirmMessage={t('factoryResetConfirm')}
            buttonLabel={t('factoryResetBtn')}
            onConfirm={onFactoryReset}
          />
        </>
      )
    default:
      return null
  }
}

export function SettingsPanel({
  open,
  anchor: _anchor,
  onClose,
  wallpaperConfig,
  onUpdateWallpaper,
  onPickWallpaper,
  onPickVideoWallpaper,
  onResetWallpaper,
  onResetShortcuts,
  onClearSavedSession,
  onResetSemiLunarLayout,
  onResetFolders,
  shortcutBindings,
  onSetShortcutBinding,
  onResetShortcutBinding,
  onResetAllShortcutBindings,
  settings,
  onUpdate,
  onResetCategory,
  onTogglePreviewOnHover,
  onEnterHomeEdit,
  onFactoryReset,
  onClearBrowsingData,
  activeUrl,
  ublockVersion,
  ublockEnabled,
  account,
  onAccountChange,
  onAccountSignOut,
  onReopenOnboarding,
  onOpenBrowseUrl,
}: SettingsPanelProps) {
  const { t, locale } = useLocale()
  const [activeId, setActiveId] = useState<SettingsCategoryId>('appearance')
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [entering, setEntering] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasOpenRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const activeNavRef = useRef<HTMLButtonElement>(null)

  const settingsCategories = getSettingsCategories(locale)
  const activeCategory = settingsCategories.find((c) => c.id === activeId)!

  const requestClose = useCallback(() => {
    if (closing) return
    onClose()
  }, [closing, onClose])

  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    if (open) {
      wasOpenRef.current = true
      setVisible(true)
      setClosing(false)
      setEntering(true)
      return
    }

    if (!wasOpenRef.current) return
    wasOpenRef.current = false

    setClosing(true)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setVisible(false)
      setClosing(false)
    }, 280)
  }, [open])

  useEffect(() => {
    if (!entering || closing) return
    const timer = setTimeout(() => setEntering(false), 360)
    return () => clearTimeout(timer)
  }, [entering, closing])

  useDialogFocusTrap({
    active: visible && !closing,
    containerRef: panelRef,
    initialFocusRef: activeNavRef,
    onEscape: requestClose,
  })

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  if (!visible) return null

  const panelAnimClass = closing
    ? styles.panelClosing
    : entering
      ? styles.panelEnter
      : styles.panelOpen

  const backdropAnimClass = closing
    ? styles.backdropClosing
    : entering
      ? styles.backdropEnter
      : styles.backdropSettled

  return createPortal(
    <>
      <div
        className={`${styles.backdrop} ${backdropAnimClass}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`${styles.panel} ${panelAnimClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('settingsTitle')}
        tabIndex={-1}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={requestClose}
          aria-label={t('settingsClose')}
        >
          ✕
        </button>

        <nav className={styles.nav} aria-label={t('settingsNavAria')}>
          <p className={styles.navTitle}>{t('settingsTitle')}</p>
          {settingsCategories.map((cat) => (
            <button
              key={cat.id}
              ref={activeId === cat.id ? activeNavRef : undefined}
              type="button"
              className={`${styles.navItem} ${activeId === cat.id ? styles.navItemActive : ''}`}
              onClick={() => setActiveId(cat.id)}
              aria-current={activeId === cat.id ? 'page' : undefined}
            >
              <span className={styles.navIcon} aria-hidden="true">
                {cat.icon}
              </span>
              {cat.label}
            </button>
          ))}
        </nav>

        <div className={styles.content}>
          <header className={styles.contentHeader}>
            <h2 className={styles.contentTitle}>{activeCategory.label}</h2>
            <p className={styles.contentDesc}>{activeCategory.description}</p>
          </header>
          <div className={styles.contentBody}>
            <CategoryContent
              categoryId={activeId}
              wallpaperConfig={wallpaperConfig}
              onUpdateWallpaper={onUpdateWallpaper}
              onPickWallpaper={onPickWallpaper}
              onPickVideoWallpaper={onPickVideoWallpaper}
              onResetWallpaper={onResetWallpaper}
              onResetShortcuts={onResetShortcuts}
              onClearSavedSession={onClearSavedSession}
              onResetSemiLunarLayout={onResetSemiLunarLayout}
              onResetFolders={onResetFolders}
              shortcutBindings={shortcutBindings}
              onSetShortcutBinding={onSetShortcutBinding}
              onResetShortcutBinding={onResetShortcutBinding}
              onResetAllShortcutBindings={onResetAllShortcutBindings}
              settings={settings}
              onUpdate={onUpdate}
              onResetCategory={onResetCategory}
              onTogglePreviewOnHover={onTogglePreviewOnHover}
              onEnterHomeEdit={onEnterHomeEdit}
              onFactoryReset={onFactoryReset}
              onClearBrowsingData={onClearBrowsingData}
              activeUrl={activeUrl}
              ublockVersion={ublockVersion}
              ublockEnabled={ublockEnabled}
              account={account}
              onAccountChange={onAccountChange}
              onAccountSignOut={onAccountSignOut}
              onReopenOnboarding={onReopenOnboarding}
              onOpenBrowseUrl={onOpenBrowseUrl}
            />
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
