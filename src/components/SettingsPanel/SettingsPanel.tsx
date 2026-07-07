import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getSettingsCategories,
  type SettingsCategoryId,
} from '../../core/settingsCategories'
import { useLocale, type NebulaLocale } from '../../hooks/useLocale'
import type { NebulaSettings } from '../../core/nebulaSettings'
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

export interface SettingsAnchor {
  x: number
  y: number
}

interface SettingsPanelProps {
  open: boolean
  anchor: SettingsAnchor | null
  onClose: () => void
  onPickWallpaper: () => void
  onResetWallpaper: () => void
  onResetShortcuts: () => void
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
  account: NebulaAccount | null
  onAccountChange: (account: NebulaAccount) => void
  onAccountSignOut: () => void
  onReopenOnboarding: () => void
  onOpenBrowseUrl?: (url: string) => void
}

function CategoryContent({
  categoryId,
  onPickWallpaper,
  onResetWallpaper,
  onResetShortcuts,
  settings,
  onUpdate,
  onResetCategory,
  onTogglePreviewOnHover,
  onEnterHomeEdit,
  onFactoryReset,
  account,
  onAccountChange,
  onAccountSignOut,
  onReopenOnboarding,
  onOpenBrowseUrl,
}: {
  categoryId: SettingsCategoryId
  onPickWallpaper: () => void
  onResetWallpaper: () => void
  onResetShortcuts: () => void
  settings: NebulaSettings
  onUpdate: SettingsPanelProps['onUpdate']
  onResetCategory: SettingsPanelProps['onResetCategory']
  onTogglePreviewOnHover: () => void
  onEnterHomeEdit: () => void
  onFactoryReset: () => void
  account: NebulaAccount | null
  onAccountChange: (account: NebulaAccount) => void
  onAccountSignOut: () => void
  onReopenOnboarding: () => void
  onOpenBrowseUrl?: (url: string) => void
}) {
  const { t, locale, setLocale } = useLocale()
  const { appearance, home, semiLunar, browsing, privacy, notifications } = settings

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
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{t('wallpaper')}</div>
              <div className={styles.rowHint}>{t('wallpaperHint')}</div>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={styles.actionBtn} onClick={onPickWallpaper}>
                {t('select')}
              </button>
              <button type="button" className={styles.actionBtn} onClick={onResetWallpaper}>
                {t('reset')}
              </button>
            </div>
          </div>
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
          <SettingResetRow
            label={t('slReset')}
            hint={t('slResetHint')}
            onReset={() => onResetCategory('semiLunar')}
          />
        </>
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
          <SettingRangeRow
            label={t('badgeCount')}
            hint={t('badgeCountHint')}
            value={notifications.toolbarBadgeCount}
            min={0}
            max={99}
            step={1}
            unit=""
            onChange={(v) => onUpdate('notifications', 'toolbarBadgeCount', v)}
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
  onPickWallpaper,
  onResetWallpaper,
  onResetShortcuts,
  settings,
  onUpdate,
  onResetCategory,
  onTogglePreviewOnHover,
  onEnterHomeEdit,
  onFactoryReset,
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

  useEffect(() => {
    if (!visible || closing) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible, closing, requestClose])

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
        className={`${styles.panel} ${panelAnimClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('settingsTitle')}
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
              type="button"
              className={`${styles.navItem} ${activeId === cat.id ? styles.navItemActive : ''}`}
              onClick={() => setActiveId(cat.id)}
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
              onPickWallpaper={onPickWallpaper}
              onResetWallpaper={onResetWallpaper}
              onResetShortcuts={onResetShortcuts}
              settings={settings}
              onUpdate={onUpdate}
              onResetCategory={onResetCategory}
              onTogglePreviewOnHover={onTogglePreviewOnHover}
              onEnterHomeEdit={onEnterHomeEdit}
              onFactoryReset={onFactoryReset}
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
