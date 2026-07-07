import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from '../../core/settingsCategories'
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
import styles from './SettingsPanel.module.css'

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
}) {
  const { appearance, home, semiLunar, browsing, privacy, notifications } = settings

  switch (categoryId) {
    case 'appearance':
      return (
        <>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>Duvar kağıdı</div>
              <div className={styles.rowHint}>Kendi görselini yükle</div>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={styles.actionBtn} onClick={onPickWallpaper}>
                Seç…
              </button>
              <button type="button" className={styles.actionBtn} onClick={onResetWallpaper}>
                Sıfırla
              </button>
            </div>
          </div>
          <SettingSelectRow
            label="Tema"
            hint="Arayüz renk paleti"
            value={appearance.theme}
            options={[
              { value: 'forest', label: 'Forest (varsayılan)' },
              { value: 'dark', label: 'Koyu' },
              { value: 'light', label: 'Açık' },
            ]}
            onChange={(v) =>
              onUpdate('appearance', 'theme', v as NebulaSettings['appearance']['theme'])
            }
          />
          <SettingRangeRow
            label="Cam blur"
            hint="Panel ve widget bulanıklığı"
            value={appearance.glassBlurPx}
            min={0}
            max={80}
            step={1}
            unit=" px"
            onChange={(v) => onUpdate('appearance', 'glassBlurPx', v)}
          />
          <SettingRangeRow
            label="Cam opaklığı"
            hint="Yarı saydam cam yüzey yoğunluğu"
            value={appearance.glassOpacity}
            min={0}
            max={40}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('appearance', 'glassOpacity', v)}
          />
          <SettingRangeRow
            label="Cam doygunluk"
            hint="Backdrop saturate çarpanı"
            value={Math.round(appearance.glassSaturate * 10)}
            min={5}
            max={30}
            step={1}
            unit="×0.1"
            onChange={(v) => onUpdate('appearance', 'glassSaturate', v / 10)}
          />
          <SettingColorRow
            label="Accent rengi"
            hint="Vurgu ve odak renkleri"
            value={appearance.accentColor}
            onChange={(v) => onUpdate('appearance', 'accentColor', v)}
          />
          <SettingColorRow
            label="Altın rengi"
            hint="İkon ve vurgu detayları"
            value={appearance.goldColor}
            onChange={(v) => onUpdate('appearance', 'goldColor', v)}
          />
          <SettingRangeRow
            label="Semi-lunar cam blur"
            hint="Üst menü cam bulanıklığı"
            value={appearance.lunarGlassBlurPx}
            min={0}
            max={160}
            step={1}
            unit=" px"
            onChange={(v) => onUpdate('appearance', 'lunarGlassBlurPx', v)}
          />
          <SettingRangeRow
            label="Semi-lunar opaklık"
            hint="Üst menü cam yoğunluğu"
            value={appearance.lunarGlassOpacity}
            min={20}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('appearance', 'lunarGlassOpacity', v)}
          />
          <SettingResetRow
            label="Görünüm varsayılanları"
            hint="Tema ve cam ayarlarını sıfırla"
            onReset={() => onResetCategory('appearance')}
          />
        </>
      )
    case 'home':
      return (
        <>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>Arayüzü düzenle</div>
              <div className={styles.rowHint}>
                Ana sayfa modüllerini sürükleyerek ve boyutlandırarak özelleştir
              </div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onEnterHomeEdit}>
              Düzenle…
            </button>
          </div>
          <SettingToggleRow
            label="Sağ araç çubuğu"
            hint="Ayarlar ve bildirim ikonları"
            checked={home.showToolbar}
            onChange={() => onUpdate('home', 'showToolbar', !home.showToolbar)}
          />
          <SettingToggleRow
            label="Sistem widget'ları"
            hint="Sol kenar çubuğunu göster"
            checked={home.showSystemWidgets}
            onChange={() => onUpdate('home', 'showSystemWidgets', !home.showSystemWidgets)}
          />
          <SettingToggleRow
            label="RAM widget"
            hint="Bellek kullanım grafiği"
            checked={home.showRamWidget}
            onChange={() => onUpdate('home', 'showRamWidget', !home.showRamWidget)}
          />
          <SettingToggleRow
            label="CPU widget"
            hint="İşlemci kullanım grafiği"
            checked={home.showCpuWidget}
            onChange={() => onUpdate('home', 'showCpuWidget', !home.showCpuWidget)}
          />
          <SettingToggleRow
            label="Saat"
            hint="Sol altta saat ve tarih"
            checked={home.showClock}
            onChange={() => onUpdate('home', 'showClock', !home.showClock)}
          />
          {home.showClock && (
            <>
              <SettingRangeRow
                label="Saat yazı boyutu"
                hint="Sol alttaki saat metni"
                value={home.clockFontSize}
                min={24}
                max={72}
                step={2}
                unit=" px"
                onChange={(v) => onUpdate('home', 'clockFontSize', v)}
              />
              <SettingSelectRow
                label="Saat yazı kalınlığı"
                hint="Font weight değeri"
                value={String(home.clockFontWeight)}
                options={[
                  { value: '300', label: 'İnce (300)' },
                  { value: '400', label: 'Normal (400)' },
                  { value: '500', label: 'Orta (500)' },
                  { value: '600', label: 'Kalın (600)' },
                ]}
                onChange={(v) => onUpdate('home', 'clockFontWeight', Number(v))}
              />
              <SettingSelectRow
                label="Saat yazı tipi"
                hint="Saat metni font ailesi"
                value={home.clockFontFamily}
                options={[
                  { value: 'system', label: 'Sistem' },
                  { value: 'light', label: 'İnce sans' },
                  { value: 'serif', label: 'Serif' },
                  { value: 'mono', label: 'Monospace' },
                ]}
                onChange={(v) =>
                  onUpdate('home', 'clockFontFamily', v as NebulaSettings['home']['clockFontFamily'])
                }
              />
              <SettingToggleRow
                label="Tarih göster"
                hint="Saatin altında tarih satırı"
                checked={home.clockShowDate}
                onChange={() => onUpdate('home', 'clockShowDate', !home.clockShowDate)}
              />
            </>
          )}
          <SettingToggleRow
            label="Sabitlenen siteler"
            hint="Arama çubuğunun üstündeki pin şeridi"
            checked={home.showPinnedStrip}
            onChange={() => onUpdate('home', 'showPinnedStrip', !home.showPinnedStrip)}
          />
          <SettingToggleRow
            label="Karşılama mesajı"
            hint="Ana sayfada hoş geldin metni"
            checked={home.showGreeting}
            onChange={() => onUpdate('home', 'showGreeting', !home.showGreeting)}
          />
          <SettingToggleRow
            label="Profil avatarı"
            hint="Arama altında profil alanı"
            checked={home.showProfile}
            onChange={() => onUpdate('home', 'showProfile', !home.showProfile)}
          />
          <SettingTextRow
            label="Kullanıcı adı"
            hint="Karşılama mesajında görünen isim"
            value={home.userDisplayName}
            onChange={(v) => onUpdate('home', 'userDisplayName', v)}
          />
          <SettingSelectRow
            label="Arama motoru"
            hint="URL olmayan aramalar için"
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
              <div className={styles.rowLabel}>Kısayolları sıfırla</div>
              <div className={styles.rowHint}>Semi-lunar ikonlarını varsayılana döndür</div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onResetShortcuts}>
              Sıfırla
            </button>
          </div>
          <SettingResetRow
            label="Ana sayfa varsayılanları"
            hint="Widget ve arama ayarlarını sıfırla"
            onReset={() => onResetCategory('home')}
          />
        </>
      )
    case 'semi-lunar':
      return (
        <>
          <SettingToggleRow
            label="Ana sayfada her zaman açık"
            hint="Home modunda menü sürekli açık kalır"
            checked={semiLunar.homeAlwaysOpen}
            onChange={() => onUpdate('semiLunar', 'homeAlwaysOpen', !semiLunar.homeAlwaysOpen)}
          />
          <SettingToggleRow
            label="Browsing'de hover ile aç"
            hint="Site gezerken üste gelince menü açılır"
            checked={semiLunar.browsingHoverOpen}
            onChange={() =>
              onUpdate('semiLunar', 'browsingHoverOpen', !semiLunar.browsingHoverOpen)
            }
          />
          <SettingRangeRow
            label="Browsing hover açılış gecikmesi"
            hint="Üst şeritte bu süre kadar bekleyince menü açılır"
            value={semiLunar.browsingOpenDelayMs}
            min={0}
            max={5000}
            step={100}
            unit=" ms"
            disabled={!semiLunar.browsingHoverOpen}
            onChange={(v) => onUpdate('semiLunar', 'browsingOpenDelayMs', v)}
          />
          <SettingToggleRow
            label="Hover önizleme"
            hint="Kısayol üzerinde bekleyince site önizlemesi"
            checked={semiLunar.previewOnHover}
            onChange={onTogglePreviewOnHover}
          />
          <SettingToggleRow
            label="Animasyonları azalt"
            hint="Menü geçişlerini neredeyse anında yap"
            checked={semiLunar.reducedMotion}
            onChange={() => onUpdate('semiLunar', 'reducedMotion', !semiLunar.reducedMotion)}
          />
          <SettingRangeRow
            label="Önizleme gecikmesi"
            hint="Hover sonrası önizlemenin başlaması"
            value={semiLunar.previewDelayMs}
            min={200}
            max={3000}
            step={100}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'previewDelayMs', v)}
          />
          <SettingRangeRow
            label="Kapanma gecikmesi"
            hint="Menüden çıkınca bekleme süresi"
            value={semiLunar.closeDelayMs}
            min={0}
            max={800}
            step={50}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'closeDelayMs', v)}
          />
          <SettingRangeRow
            label="Açılış animasyonu"
            hint="Menünün büyüme süresi"
            value={semiLunar.openDurationMs}
            min={0}
            max={600}
            step={20}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'openDurationMs', v)}
          />
          <SettingRangeRow
            label="Kapanış animasyonu"
            hint="Menünün küçülme süresi"
            value={semiLunar.closeDurationMs}
            min={0}
            max={400}
            step={10}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'closeDurationMs', v)}
          />
          <SettingRangeRow
            label="Açılış scale X"
            hint="Başlangıç genişlik oranı"
            value={Math.round(semiLunar.scaleX * 100)}
            min={5}
            max={50}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('semiLunar', 'scaleX', v / 100)}
          />
          <SettingRangeRow
            label="Açılış scale Y"
            hint="Başlangıç yükseklik oranı"
            value={Math.round(semiLunar.scaleY * 100)}
            min={5}
            max={50}
            step={1}
            unit="%"
            onChange={(v) => onUpdate('semiLunar', 'scaleY', v / 100)}
          />
          <SettingRangeRow
            label="Kapat butonu gecikmesi"
            hint="Kısayol üzerinde ✕ görünmesi"
            value={semiLunar.closeBtnDelayMs}
            min={0}
            max={1200}
            step={50}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'closeBtnDelayMs', v)}
          />
          <SettingRangeRow
            label="Klasör birleştirme"
            hint="İki ikonu üst üste tutma süresi"
            value={semiLunar.folderMergeHoldMs}
            min={200}
            max={2000}
            step={50}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'folderMergeHoldMs', v)}
          />
          <SettingRangeRow
            label="Birleştirme animasyonu"
            hint="Klasör oluşurken animasyon süresi"
            value={semiLunar.mergeAnimMs}
            min={100}
            max={1200}
            step={20}
            unit=" ms"
            onChange={(v) => onUpdate('semiLunar', 'mergeAnimMs', v)}
          />
          <SettingRangeRow
            label="İkon boyutu"
            hint="Dock kısayol çapı"
            value={semiLunar.iconSizePx}
            min={32}
            max={64}
            step={2}
            unit=" px"
            onChange={(v) => onUpdate('semiLunar', 'iconSizePx', v)}
          />
          <SettingRangeRow
            label="Hilal genişliği"
            hint="Semi-lunar menü genişliği"
            value={semiLunar.lunarWidthPx}
            min={600}
            max={1400}
            step={20}
            unit=" px"
            onChange={(v) => onUpdate('semiLunar', 'lunarWidthPx', v)}
          />
          <SettingRangeRow
            label="Hilal yüksekliği"
            hint="Semi-lunar menü yüksekliği"
            value={semiLunar.lunarHeightPx}
            min={100}
            max={220}
            step={4}
            unit=" px"
            onChange={(v) => onUpdate('semiLunar', 'lunarHeightPx', v)}
          />
          <SettingRangeRow
            label="Overlay blur"
            hint="Hızlı menüde arka plan bulanıklığı"
            value={browsing.overlayBlurPx}
            min={0}
            max={40}
            step={1}
            unit=" px"
            onChange={(v) => onUpdate('browsing', 'overlayBlurPx', v)}
          />
          <SettingRangeRow
            label="Overlay parlaklık"
            hint="Bulanık arka plan karartma"
            value={browsing.overlayBrightnessPercent}
            min={20}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => onUpdate('browsing', 'overlayBrightnessPercent', v)}
          />
          <SettingResetRow
            label="Semi-Lunar varsayılanları"
            hint="Menü ve kısayol davranışlarını sıfırla"
            onReset={() => onResetCategory('semiLunar')}
          />
        </>
      )
    case 'privacy':
      return (
        <>
          <SettingToggleRow
            label="Takip engelleme"
            hint="Bilinen izleyicileri engelle (Gecko sonrası)"
            checked={privacy.blockTrackers}
            onChange={() => onUpdate('privacy', 'blockTrackers', !privacy.blockTrackers)}
          />
          <SettingToggleRow
            label="Sıkı çerez politikası"
            hint="Üçüncü taraf çerezleri kısıtla"
            checked={privacy.strictCookies}
            onChange={() => onUpdate('privacy', 'strictCookies', !privacy.strictCookies)}
          />
          <SettingToggleRow
            label="HTTPS zorunlu"
            hint="Güvensiz bağlantıları engelle"
            checked={privacy.httpsOnly}
            onChange={() => onUpdate('privacy', 'httpsOnly', !privacy.httpsOnly)}
          />
          <SettingResetRow
            label="Gizlilik varsayılanları"
            hint="Gizlilik tercihlerini sıfırla"
            onReset={() => onResetCategory('privacy')}
          />
        </>
      )
    case 'notifications':
      return (
        <>
          <SettingToggleRow
            label="Odak modu uyarıları"
            hint="Dikkat dağıtıcı bildirimleri filtrele"
            checked={notifications.focusModeAlerts}
            onChange={() =>
              onUpdate('notifications', 'focusModeAlerts', !notifications.focusModeAlerts)
            }
          />
          <SettingToggleRow
            label="Site bildirimleri"
            hint="Web push bildirimlerine izin ver"
            checked={notifications.siteNotifications}
            onChange={() =>
              onUpdate('notifications', 'siteNotifications', !notifications.siteNotifications)
            }
          />
          <SettingToggleRow
            label="Toolbar rozeti"
            hint="Bildirim ikonunda sayı göster"
            checked={notifications.showToolbarBadge}
            onChange={() =>
              onUpdate('notifications', 'showToolbarBadge', !notifications.showToolbarBadge)
            }
          />
          <SettingRangeRow
            label="Rozet sayısı"
            hint="Sağ toolbar bildirim sayısı"
            value={notifications.toolbarBadgeCount}
            min={0}
            max={99}
            step={1}
            unit=""
            onChange={(v) => onUpdate('notifications', 'toolbarBadgeCount', v)}
          />
          <SettingResetRow
            label="Bildirim varsayılanları"
            hint="Bildirim tercihlerini sıfırla"
            onReset={() => onResetCategory('notifications')}
          />
        </>
      )
    case 'about':
      return (
        <>
          <div className={styles.placeholder}>
            <strong>Nebula Browser</strong>
            <div className={styles.version}>UI Prototype · v0.1</div>
            <p style={{ marginTop: 16 }}>
              Dikkat dağıtmayan, gizlilik odaklı tarayıcı kabuğu. Gecko motoru ve Tauri
              native shell yol haritasında.
            </p>
          </div>
          <SettingDangerRow
            label="Uygulamayı sıfırla"
            hint="Profil, kurulum, yer işaretleri, ayarlar ve duvar kağıdı — ilk yükleme haline döner"
            confirmMessage="Tüm Nebula verileri silinecek ve kurulum baştan başlayacak. Emin misin?"
            buttonLabel="Tamamen sıfırla"
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
}: SettingsPanelProps) {
  const [activeId, setActiveId] = useState<SettingsCategoryId>('appearance')
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [entering, setEntering] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasOpenRef = useRef(false)

  const activeCategory = SETTINGS_CATEGORIES.find((c) => c.id === activeId)!

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
        aria-label="Ayarlar"
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={requestClose}
          aria-label="Ayarları kapat"
        >
          ✕
        </button>

        <nav className={styles.nav} aria-label="Ayar kategorileri">
          <p className={styles.navTitle}>Ayarlar</p>
          {SETTINGS_CATEGORIES.map((cat) => (
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
            />
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
