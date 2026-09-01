import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  getSettingsCategories,
  type SettingsCategoryId,
} from '../../core/settingsCategories'
import { getLocaleCopy, LOCALE_MESSAGES, type LocaleMessageKey } from '../../core/locale'
import { DE_LOCALE_MESSAGES } from '../../core/localeMessages.de'
import { ES_LOCALE_MESSAGES } from '../../core/localeMessages.es'
import { FR_LOCALE_MESSAGES, ID_LOCALE_MESSAGES, RU_LOCALE_MESSAGES } from '../../core/localeMessages.additional'
import { IT_LOCALE_MESSAGES, JA_LOCALE_MESSAGES } from '../../core/localeMessages.it-ja'
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
  notificationHost,
  type SiteNotificationPermission,
  type SiteNotificationPermissions,
} from '../../core/notification'
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
  actionId: ConfigurableBrowserShortcutId
  tr: string
  en: string
  es: string
  de: string
  fr: string
  id: string
  ru: string
  it: string
  ja: string
  noteTr?: string
  noteEn?: string
  noteEs?: string
  noteDe?: string
  noteFr?: string
  noteId?: string
  noteRu?: string
  noteIt?: string
  noteJa?: string
}

interface ShortcutReferenceGroup {
  tr: string
  en: string
  es: string
  de: string
  fr: string
  id: string
  ru: string
  it: string
  ja: string
  items: ShortcutReferenceItem[]
}

const SHORTCUT_REFERENCE: ShortcutReferenceGroup[] = [
  {
    tr: 'Sekmeler',
    en: 'Tabs',
    es: 'Pestañas',
    de: 'Tabs',
    fr: 'Onglets',
    id: 'Tab',
    ru: 'Вкладки',
    it: 'Schede',
    ja: 'タブ',
    items: [
      { actionId: 'close-tab', tr: 'Aktif sekmeyi kapat', en: 'Close the active tab', es: 'Cerrar la pestaña activa', de: 'Aktiven Tab schließen', fr: 'Fermer l’onglet actif', id: 'Tutup tab aktif', ru: 'Закрыть активную вкладку', it: 'Chiudi la scheda attiva', ja: 'アクティブなタブを閉じる' },
      { actionId: 'reopen-tab', tr: 'Son kapatılan sekmeyi yeniden aç', en: 'Reopen the last closed tab', es: 'Volver a abrir la última pestaña cerrada', de: 'Zuletzt geschlossenen Tab wieder öffnen', fr: 'Rouvrir le dernier onglet fermé', id: 'Buka kembali tab terakhir yang ditutup', ru: 'Снова открыть последнюю закрытую вкладку', it: 'Riapri l’ultima scheda chiusa', ja: '最後に閉じたタブを開き直す' },
      { actionId: 'next-tab', tr: 'Sonraki sekmeye geç', en: 'Switch to the next tab', es: 'Cambiar a la pestaña siguiente', de: 'Zum nächsten Tab wechseln', fr: 'Passer à l’onglet suivant', id: 'Beralih ke tab berikutnya', ru: 'Перейти к следующей вкладке', it: 'Passa alla scheda successiva', ja: '次のタブに切り替える' },
      { actionId: 'prev-tab', tr: 'Önceki sekmeye geç', en: 'Switch to the previous tab', es: 'Cambiar a la pestaña anterior', de: 'Zum vorherigen Tab wechseln', fr: 'Passer à l’onglet précédent', id: 'Beralih ke tab sebelumnya', ru: 'Перейти к предыдущей вкладке', it: 'Passa alla scheda precedente', ja: '前のタブに切り替える' },
      { actionId: 'open-tab-search', tr: 'Sekmelerde ara', en: 'Search open tabs', es: 'Buscar en las pestañas abiertas', de: 'Geöffnete Tabs durchsuchen', fr: 'Rechercher dans les onglets ouverts', id: 'Cari tab terbuka', ru: 'Поиск открытых вкладок', it: 'Cerca nelle schede aperte', ja: '開いているタブを検索' },
      { actionId: 'switch-tab-1', tr: '1. sekmeye geç', en: 'Switch to tab 1', es: 'Cambiar a la pestaña 1', de: 'Zu Tab 1 wechseln', fr: 'Passer à l’onglet 1', id: 'Beralih ke tab 1', ru: 'Перейти к вкладке 1', it: 'Passa alla scheda 1', ja: 'タブ 1 に切り替える' },
      { actionId: 'switch-tab-2', tr: '2. sekmeye geç', en: 'Switch to tab 2', es: 'Cambiar a la pestaña 2', de: 'Zu Tab 2 wechseln', fr: 'Passer à l’onglet 2', id: 'Beralih ke tab 2', ru: 'Перейти к вкладке 2', it: 'Passa alla scheda 2', ja: 'タブ 2 に切り替える' },
      { actionId: 'switch-tab-3', tr: '3. sekmeye geç', en: 'Switch to tab 3', es: 'Cambiar a la pestaña 3', de: 'Zu Tab 3 wechseln', fr: 'Passer à l’onglet 3', id: 'Beralih ke tab 3', ru: 'Перейти к вкладке 3', it: 'Passa alla scheda 3', ja: 'タブ 3 に切り替える' },
      { actionId: 'switch-tab-4', tr: '4. sekmeye geç', en: 'Switch to tab 4', es: 'Cambiar a la pestaña 4', de: 'Zu Tab 4 wechseln', fr: 'Passer à l’onglet 4', id: 'Beralih ke tab 4', ru: 'Перейти к вкладке 4', it: 'Passa alla scheda 4', ja: 'タブ 4 に切り替える' },
      { actionId: 'switch-tab-5', tr: '5. sekmeye geç', en: 'Switch to tab 5', es: 'Cambiar a la pestaña 5', de: 'Zu Tab 5 wechseln', fr: 'Passer à l’onglet 5', id: 'Beralih ke tab 5', ru: 'Перейти к вкладке 5', it: 'Passa alla scheda 5', ja: 'タブ 5 に切り替える' },
      { actionId: 'switch-tab-6', tr: '6. sekmeye geç', en: 'Switch to tab 6', es: 'Cambiar a la pestaña 6', de: 'Zu Tab 6 wechseln', fr: 'Passer à l’onglet 6', id: 'Beralih ke tab 6', ru: 'Перейти к вкладке 6', it: 'Passa alla scheda 6', ja: 'タブ 6 に切り替える' },
      { actionId: 'switch-tab-7', tr: '7. sekmeye geç', en: 'Switch to tab 7', es: 'Cambiar a la pestaña 7', de: 'Zu Tab 7 wechseln', fr: 'Passer à l’onglet 7', id: 'Beralih ke tab 7', ru: 'Перейти к вкладке 7', it: 'Passa alla scheda 7', ja: 'タブ 7 に切り替える' },
      { actionId: 'switch-tab-8', tr: '8. sekmeye geç', en: 'Switch to tab 8', es: 'Cambiar a la pestaña 8', de: 'Zu Tab 8 wechseln', fr: 'Passer à l’onglet 8', id: 'Beralih ke tab 8', ru: 'Перейти к вкладке 8', it: 'Passa alla scheda 8', ja: 'タブ 8 に切り替える' },
      { actionId: 'switch-tab-last', tr: 'Son sekmeye geç', en: 'Switch to the last tab', es: 'Cambiar a la última pestaña', de: 'Zum letzten Tab wechseln', fr: 'Passer au dernier onglet', id: 'Beralih ke tab terakhir', ru: 'Перейти к последней вкладке', it: 'Passa all’ultima scheda', ja: '最後のタブに切り替える' },
    ],
  },
  {
    tr: 'Gezinme',
    en: 'Navigation',
    es: 'Navegación',
    de: 'Navigation',
    fr: 'Navigation',
    id: 'Navigasi',
    ru: 'Навигация',
    it: 'Navigazione',
    ja: 'ナビゲーション',
    items: [
      { actionId: 'go-home', tr: 'Ana sayfaya dön', en: 'Go to Home', es: 'Ir a Inicio', de: 'Zur Startseite wechseln', fr: 'Aller à l’accueil', id: 'Buka Beranda', ru: 'Перейти на главную', it: 'Vai alla Home', ja: 'ホームへ移動' },
      { actionId: 'open-history', tr: 'Geçmişi aç', en: 'Open History', es: 'Abrir el historial', de: 'Verlauf öffnen', fr: 'Ouvrir l’historique', id: 'Buka riwayat', ru: 'Открыть историю', it: 'Apri Cronologia', ja: '履歴を開く' },
      { actionId: 'focus-url-bar', tr: 'Adres çubuğuna odaklan', en: 'Focus the address bar', es: 'Enfocar la barra de direcciones', de: 'Adressleiste fokussieren', fr: 'Activer la barre d’adresse', id: 'Fokus ke kolom alamat', ru: 'Перейти к адресной строке', it: 'Attiva la barra degli indirizzi', ja: 'アドレスバーにフォーカス' },
      { actionId: 'go-back', tr: 'Geri git', en: 'Go back', es: 'Volver', de: 'Zurück', fr: 'Revenir en arrière', id: 'Kembali', ru: 'Назад', it: 'Indietro', ja: '戻る' },
      { actionId: 'go-forward', tr: 'İleri git', en: 'Go forward', es: 'Avanzar', de: 'Vorwärts', fr: 'Avancer', id: 'Maju', ru: 'Вперёд', it: 'Avanti', ja: '進む' },
      { actionId: 'reload', tr: 'Sayfayı yenile', en: 'Reload the page', es: 'Recargar la página', de: 'Seite neu laden', fr: 'Recharger la page', id: 'Muat ulang halaman', ru: 'Обновить страницу', it: 'Ricarica la pagina', ja: 'ページを再読み込み' },
    ],
  },
  {
    tr: 'Görünüm ve geliştirici',
    en: 'View and developer',
    es: 'Vista y desarrollo',
    de: 'Ansicht und Entwicklung',
    fr: 'Affichage et développement',
    id: 'Tampilan dan pengembang',
    ru: 'Вид и разработка',
    it: 'Visualizzazione e sviluppo',
    ja: '表示と開発者',
    items: [
      { actionId: 'zoom-in', tr: 'Yakınlaştır', en: 'Zoom in', es: 'Acercar', de: 'Vergrößern', fr: 'Zoom avant', id: 'Perbesar', ru: 'Увеличить', it: 'Aumenta zoom', ja: '拡大' },
      { actionId: 'zoom-out', tr: 'Uzaklaştır', en: 'Zoom out', es: 'Alejar', de: 'Verkleinern', fr: 'Zoom arrière', id: 'Perkecil', ru: 'Уменьшить', it: 'Riduci zoom', ja: '縮小' },
      { actionId: 'zoom-reset', tr: 'Yakınlaştırmayı sıfırla', en: 'Reset zoom', es: 'Restablecer el zoom', de: 'Zoom zurücksetzen', fr: 'Réinitialiser le zoom', id: 'Atur ulang zoom', ru: 'Сбросить масштаб', it: 'Reimposta zoom', ja: 'ズームをリセット' },
      { actionId: 'print', tr: 'Sayfayı yazdır', en: 'Print the current page', es: 'Imprimir la página actual', de: 'Aktuelle Seite drucken', fr: 'Imprimer la page actuelle', id: 'Cetak halaman saat ini', ru: 'Печать текущей страницы', it: 'Stampa la pagina corrente', ja: '現在のページを印刷' },
      { actionId: 'toggle-fullscreen', tr: 'Tam ekranı aç/kapat', en: 'Toggle fullscreen', es: 'Alternar pantalla completa', de: 'Vollbild umschalten', fr: 'Activer le plein écran', id: 'Aktifkan/nonaktifkan layar penuh', ru: 'Переключить полноэкранный режим', it: 'Attiva/disattiva schermo intero', ja: '全画面表示を切り替え' },
      { actionId: 'devtools', tr: 'Geliştirici araçlarını aç', en: 'Open Developer Tools', es: 'Abrir las herramientas para desarrolladores', de: 'Entwicklertools öffnen', fr: 'Ouvrir les outils de développement', id: 'Buka Alat Pengembang', ru: 'Открыть инструменты разработчика', it: 'Apri Strumenti per sviluppatori', ja: '開発者ツールを開く' },
    ],
  },
]

const SHORTCUT_LABELS = new Map(
  SHORTCUT_REFERENCE.flatMap((group) =>
    group.items.map((item) => [item.actionId, item] as const),
  ),
)

interface SettingsSearchEntry {
  categoryId: SettingsCategoryId
  tr: string
  en: string
  es: string
  de: string
  fr: string
  id: string
  ru: string
  it: string
  ja: string
  keywords: string
}

const SETTINGS_SEARCH_KEYS: Record<SettingsCategoryId, readonly LocaleMessageKey[]> = {
  appearance: [
    'settingsLanguage',
    'theme',
    'darkenWebpages',
    'glassBlur',
    'glassOpacity',
    'glassSaturate',
    'glassContrast',
    'accentColor',
    'goldColor',
    'lunarGlassBlur',
    'lunarGlassOpacity',
    'appearanceReset',
  ],
  home: [
    'editUi',
    'toolbar',
    'systemWidgets',
    'ramWidget',
    'cpuWidget',
    'clock',
    'clockFontSize',
    'clockFontWeight',
    'clockFontFamily',
    'clockShowDate',
    'pinnedSites',
    'greeting',
    'profileAvatar',
    'username',
    'searchEngine',
    'resetShortcuts',
    'homeReset',
  ],
  'semi-lunar': [
    'slHomeAlwaysOpen',
    'slBrowsingHover',
    'slBrowsingDelay',
    'slPreviewHover',
    'slReducedMotion',
    'slPreviewDelay',
    'slCloseDelay',
    'slOpenDuration',
    'slCloseDuration',
    'slScaleX',
    'slScaleY',
    'slCloseBtnDelay',
    'slFolderMerge',
    'slMergeAnim',
    'slIconSize',
    'slLunarWidth',
    'slLunarHeight',
    'overlayBlur',
    'overlayBrightness',
    'slReset',
  ],
  shortcuts: [],
  account: [
    'accountDisplayName',
    'accountSiteSession',
    'accountSignOutTitle',
    'accountReopenSetup',
    'accountPasswords',
    'accountImportCsv',
    'accountAddPassword',
  ],
  privacy: [
    'trackingLevel',
    'blockTrackers',
    'strictCookies',
    'httpsOnly',
    'globalPrivacyControl',
    'permissionPolicy',
    'currentSitePermissions',
    'cookieBannerBlocking',
    'permissionExceptions',
    'privateMode',
    'privacyExceptions',
    'siteShield',
    'customBlockList',
    'clearBrowsingData',
    'privacyReset',
  ],
  notifications: [
    'downloadNotifications',
    'siteNotifications',
    'showNotificationContent',
    'toolbarBadge',
    'notificationSitePermissions',
    'notificationsReset',
  ],
  about: ['updateProduct', 'updateSection', 'factoryReset'],
}

function localizedSettingsSearchEntry(
  categoryId: SettingsCategoryId,
  labelKey: LocaleMessageKey,
): SettingsSearchEntry {
  const label = LOCALE_MESSAGES[labelKey]
  const possibleHintKey = `${labelKey}Hint`
  const hint = possibleHintKey in LOCALE_MESSAGES
    ? LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey]
    : undefined

  return {
    categoryId,
    tr: label.tr,
    en: label.en,
    es: ES_LOCALE_MESSAGES[labelKey],
    de: DE_LOCALE_MESSAGES[labelKey],
    fr: FR_LOCALE_MESSAGES[labelKey],
    id: ID_LOCALE_MESSAGES[labelKey],
    ru: RU_LOCALE_MESSAGES[labelKey],
    it: IT_LOCALE_MESSAGES[labelKey],
    ja: JA_LOCALE_MESSAGES[labelKey],
    keywords: `${labelKey} ${hint?.tr ?? ''} ${hint?.en ?? ''} ${hint ? ES_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''} ${hint ? DE_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''} ${hint ? FR_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''} ${hint ? ID_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''} ${hint ? RU_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''} ${hint ? IT_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''} ${hint ? JA_LOCALE_MESSAGES[possibleHintKey as LocaleMessageKey] : ''}`,
  }
}

const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  ...Object.entries(SETTINGS_SEARCH_KEYS).flatMap(([categoryId, keys]) =>
    keys.map((key) => localizedSettingsSearchEntry(categoryId as SettingsCategoryId, key)),
  ),
  {
    categoryId: 'appearance',
    tr: 'Duvar kağıdı',
    en: 'Wallpaper',
    es: 'Fondo de pantalla',
    de: 'Hintergrundbild',
    fr: 'Fond d’écran',
    id: 'Wallpaper',
    ru: 'Обои',
    it: 'Sfondo',
    ja: '壁紙',
    keywords: 'görsel image imagen bild bewegtes animiert hareketli animated animado video ambient ambiente arka plan background fondo hintergrund yerleşim fit ajuste anpassung konum position posición yoğunluk intensity intensidad intensität hız speed velocidad geschwindigkeit',
  },
  {
    categoryId: 'home',
    tr: 'Son oturumu geri yükle',
    en: 'Restore the last session',
    es: 'Restaurar la última sesión',
    de: 'Letzte Sitzung wiederherstellen',
    fr: 'Restaurer la dernière session',
    id: 'Pulihkan sesi terakhir',
    ru: 'Восстановить последний сеанс',
    it: 'Ripristina l’ultima sessione',
    ja: '前回のセッションを復元',
    keywords: 'sekme tab pestaña registerkarte session sesión sitzung oturum restore restaurar wiederherstellen başlangıç startup inicio start klasör folder carpeta ordner ikon icono symbol layout diseño',
  },
  {
    categoryId: 'home',
    tr: 'Kaydedilmiş sekme oturumunu temizle',
    en: 'Clear saved tab session',
    es: 'Borrar la sesión de pestañas guardada',
    de: 'Gespeicherte Tabsitzung löschen',
    fr: 'Effacer la session d’onglets enregistrée',
    id: 'Hapus sesi tab tersimpan',
    ru: 'Удалить сохранённый сеанс вкладок',
    it: 'Cancella la sessione di schede salvata',
    ja: '保存済みタブセッションを消去',
    keywords: 'sekme tab pestaña registerkarte snapshot oturum session sesión sitzung temizle clear borrar löschen',
  },
  {
    categoryId: 'semi-lunar',
    tr: 'Semi-Lunar yerleşimini sıfırla',
    en: 'Reset Semi-Lunar layout',
    es: 'Restablecer la disposición de Semi-Lunar',
    de: 'Semi-Lunar-Layout zurücksetzen',
    fr: 'Réinitialiser la disposition Semi-Lunar',
    id: 'Atur ulang tata letak Semi-Lunar',
    ru: 'Сбросить компоновку Semi-Lunar',
    it: 'Reimposta il layout Semi-Lunar',
    ja: 'Semi-Lunar のレイアウトをリセット',
    keywords: 'ikon icon icono symbol konum position posición varsayılan default predeterminado standard diseño layout disposición anordnung',
  },
  {
    categoryId: 'semi-lunar',
    tr: 'Klasörleri sıfırla',
    en: 'Reset folders',
    es: 'Restablecer carpetas',
    de: 'Ordner zurücksetzen',
    fr: 'Réinitialiser les dossiers',
    id: 'Atur ulang folder',
    ru: 'Сбросить папки',
    it: 'Reimposta cartelle',
    ja: 'フォルダーをリセット',
    keywords: 'semi lunar folder carpeta ordner dissolve disolver auflösen çöz dağıt',
  },
  {
    categoryId: 'account',
    tr: 'Nebula hesabı ve Google Sync',
    en: 'Nebula account and Google Sync',
    es: 'Cuenta de Nebula y Google Sync',
    de: 'Nebula-Konto und Google Sync',
    fr: 'Compte Nebula et Google Sync',
    id: 'Akun Nebula dan Google Sync',
    ru: 'Аккаунт Nebula и Google Sync',
    it: 'Account Nebula e Google Sync',
    ja: 'Nebula アカウントと Google Sync',
    keywords: 'hesap account cuenta konto google sync eşitleme sincronización synchronisierung profil perfil oturum sesión sitzung parola password contraseña passwort csv içe aktar import importar importieren',
  },
  {
    categoryId: 'privacy',
    tr: 'uBlock Origin Lite',
    en: 'uBlock Origin Lite',
    es: 'uBlock Origin Lite',
    de: 'uBlock Origin Lite',
    fr: 'uBlock Origin Lite',
    id: 'uBlock Origin Lite',
    ru: 'uBlock Origin Lite',
    it: 'uBlock Origin Lite',
    ja: 'uBlock Origin Lite',
    keywords: 'reklam ad anuncio werbung blocker bloqueador engelleme blockierung tracker rastreador izleyici',
  },
  {
    categoryId: 'about',
    tr: 'Sürüm ve güncellemeler',
    en: 'Version and updates',
    es: 'Versión y actualizaciones',
    de: 'Version und Updates',
    fr: 'Version et mises à jour',
    id: 'Versi dan pembaruan',
    ru: 'Версия и обновления',
    it: 'Versione e aggiornamenti',
    ja: 'バージョンとアップデート',
    keywords: 'hakkında about acerca über version versión sürüm update actualización aktualisierung güncelleme check comprobar prüfen install instalar installieren yükle',
  },
  ...SHORTCUT_REFERENCE.flatMap((group) =>
    group.items.map((item) => ({
      categoryId: 'shortcuts' as const,
      tr: item.tr,
      en: item.en,
      es: item.es,
      de: item.de,
      fr: item.fr,
      id: item.id,
      ru: item.ru,
      it: item.it,
      ja: item.ja,
      keywords: `${item.actionId} ${group.tr} ${group.en} ${group.es} ${group.de} ${group.fr} ${group.id} ${group.ru} ${group.it} ${group.ja} klavye keyboard teclado tastatur clavier papan ketik клавиатура tastiera キーボード shortcut atajo tastenkürzel raccourci pintasan сочетание scorciatoia ショートカット kısayol`,
    })),
  ),
]

function localizedValue<T extends Record<NebulaLocale, string>>(
  value: T,
  locale: NebulaLocale,
): string {
  return value[locale]
}

function shortcutNote(item: ShortcutReferenceItem, locale: NebulaLocale): string | undefined {
  switch (locale) {
    case 'tr': return item.noteTr
    case 'es': return item.noteEs
    case 'de': return item.noteDe
    case 'fr': return item.noteFr
    case 'id': return item.noteId
    case 'ru': return item.noteRu
    case 'it': return item.noteIt
    case 'ja': return item.noteJa
    default: return item.noteEn
  }
}

function normalizeSettingsSearchText(value: string, locale: NebulaLocale): string {
  return value
    .toLocaleLowerCase(locale)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
}

const SHORTCUT_UI_COPY = {
  tr: {
    reserved: 'Bu kombinasyon Windows veya Nebula tarafından ayrılmış.',
    needsModifier: 'Harf, sayı ve gezinme tuşları için Ctrl veya Alt kullan.',
    unsupported: 'Bu tuş kombinasyonu site WebView’larında güvenilir biçimde desteklenmiyor.',
    conflict: '{binding} zaten “{action}” için kullanılıyor.',
    changeFailed: 'Kısayol değiştirilemedi; çakışma olup olmadığını kontrol et.',
    saved: '{binding} kaydedildi.',
    intro: 'Bir eylemde Değiştir’e basıp yeni kombinasyona bas. Değişiklikler Home, Semi-Lunar ve site sekmeleri arasında anında eşitlenir.',
    pressKeys: 'Tuşlara bas…',
    change: 'Değiştir',
    resetConflict: 'Varsayılan kombinasyon başka bir eylem tarafından kullanılıyor. Önce o kısayolu değiştir veya tümünü sıfırla.',
    reset: 'Sıfırla',
    keyboardNavigation: 'Klavye navigasyonu',
    keyboardHint: 'Esc, Tab / Shift+Tab, Enter, Space, ok tuşları, Home ve End erişilebilirlik için sabit kalır.',
    resetAll: 'Tümünü varsayılana döndür',
  },
  en: {
    reserved: 'This combination is reserved by Windows or Nebula.',
    needsModifier: 'Use Ctrl or Alt with letters, numbers, and navigation keys.',
    unsupported: 'This key combination is not reliably supported inside site WebViews.',
    conflict: '{binding} is already used by “{action}”.',
    changeFailed: 'The shortcut could not be changed; check for a conflict.',
    saved: '{binding} saved.',
    intro: 'Choose Change on an action, then press the new combination. Changes sync immediately across Home, Semi-Lunar, and site tabs.',
    pressKeys: 'Press keys…',
    change: 'Change',
    resetConflict: 'The default combination is used by another action. Change that shortcut first or reset all.',
    reset: 'Reset',
    keyboardNavigation: 'Keyboard navigation',
    keyboardHint: 'Esc, Tab / Shift+Tab, Enter, Space, arrow keys, Home, and End stay fixed for accessibility.',
    resetAll: 'Reset all to defaults',
  },
  es: {
    reserved: 'Esta combinación está reservada por Windows o Nebula.',
    needsModifier: 'Usa Ctrl o Alt con letras, números y teclas de navegación.',
    unsupported: 'Esta combinación no funciona de forma fiable dentro de las vistas web de los sitios.',
    conflict: '{binding} ya se usa para “{action}”.',
    changeFailed: 'No se pudo cambiar el atajo; comprueba si existe un conflicto.',
    saved: 'Se guardó {binding}.',
    intro: 'Elige Cambiar en una acción y pulsa la nueva combinación. Los cambios se sincronizan de inmediato entre Inicio, Semi-Lunar y las pestañas de sitios.',
    pressKeys: 'Pulsa las teclas…',
    change: 'Cambiar',
    resetConflict: 'Otra acción usa la combinación predeterminada. Cambia primero ese atajo o restablécelos todos.',
    reset: 'Restablecer',
    keyboardNavigation: 'Navegación con teclado',
    keyboardHint: 'Esc, Tab / Mayús+Tab, Enter, Espacio, las flechas, Inicio y Fin permanecen fijos por accesibilidad.',
    resetAll: 'Restablecer todos',
  },
  de: {
    reserved: 'Diese Kombination ist von Windows oder Nebula reserviert.',
    needsModifier: 'Verwende Strg oder Alt zusammen mit Buchstaben, Zahlen und Navigationstasten.',
    unsupported: 'Diese Tastenkombination wird in Website-WebViews nicht zuverlässig unterstützt.',
    conflict: '{binding} wird bereits für „{action}“ verwendet.',
    changeFailed: 'Das Tastenkürzel konnte nicht geändert werden. Prüfe, ob ein Konflikt vorliegt.',
    saved: '{binding} wurde gespeichert.',
    intro: 'Wähle bei einer Aktion Ändern und drücke dann die neue Kombination. Änderungen werden sofort zwischen Startseite, Semi-Lunar und Website-Tabs synchronisiert.',
    pressKeys: 'Tasten drücken…',
    change: 'Ändern',
    resetConflict: 'Die Standardkombination wird von einer anderen Aktion verwendet. Ändere zuerst dieses Tastenkürzel oder setze alle zurück.',
    reset: 'Zurücksetzen',
    keyboardNavigation: 'Tastaturnavigation',
    keyboardHint: 'Esc, Tab / Umschalt+Tab, Eingabe, Leertaste, Pfeiltasten, Pos1 und Ende bleiben aus Gründen der Barrierefreiheit festgelegt.',
    resetAll: 'Alle auf Standard zurücksetzen',
  },
  fr: {
    reserved: 'Cette combinaison est réservée par Windows ou Nebula.',
    needsModifier: 'Utilisez Ctrl ou Alt avec les lettres, les chiffres et les touches de navigation.',
    unsupported: 'Cette combinaison de touches n’est pas prise en charge de façon fiable dans les WebViews des sites.',
    conflict: '{binding} est déjà utilisé pour « {action} ».',
    changeFailed: 'Le raccourci n’a pas pu être modifié ; vérifiez s’il existe un conflit.',
    saved: '{binding} a été enregistré.',
    intro: 'Choisissez Modifier pour une action, puis appuyez sur la nouvelle combinaison. Les changements sont immédiatement synchronisés entre l’Accueil, Semi-Lunar et les onglets de sites.',
    pressKeys: 'Appuyez sur les touches…',
    change: 'Modifier',
    resetConflict: 'La combinaison par défaut est utilisée par une autre action. Modifiez d’abord ce raccourci ou réinitialisez-les tous.',
    reset: 'Réinitialiser',
    keyboardNavigation: 'Navigation au clavier',
    keyboardHint: 'Échap, Tab / Maj+Tab, Entrée, Espace, les flèches, Début et Fin restent fixes pour l’accessibilité.',
    resetAll: 'Tout réinitialiser',
  },
  id: {
    reserved: 'Kombinasi ini dicadangkan oleh Windows atau Nebula.',
    needsModifier: 'Gunakan Ctrl atau Alt bersama huruf, angka, dan tombol navigasi.',
    unsupported: 'Kombinasi tombol ini tidak didukung secara andal di WebView situs.',
    conflict: '{binding} sudah digunakan untuk “{action}”.',
    changeFailed: 'Pintasan tidak dapat diubah; periksa apakah ada konflik.',
    saved: '{binding} disimpan.',
    intro: 'Pilih Ubah pada suatu tindakan, lalu tekan kombinasi baru. Perubahan langsung disinkronkan antara Beranda, Semi-Lunar, dan tab situs.',
    pressKeys: 'Tekan tombol…',
    change: 'Ubah',
    resetConflict: 'Kombinasi bawaan digunakan oleh tindakan lain. Ubah pintasan tersebut terlebih dahulu atau atur ulang semuanya.',
    reset: 'Atur ulang',
    keyboardNavigation: 'Navigasi keyboard',
    keyboardHint: 'Esc, Tab / Shift+Tab, Enter, Spasi, tombol panah, Home, dan End tetap digunakan untuk aksesibilitas.',
    resetAll: 'Atur ulang semua',
  },
  ru: {
    reserved: 'Эта комбинация зарезервирована Windows или Nebula.',
    needsModifier: 'Используйте Ctrl или Alt вместе с буквами, цифрами и клавишами навигации.',
    unsupported: 'Эта комбинация клавиш ненадёжно поддерживается в WebView сайтов.',
    conflict: '{binding} уже используется для действия «{action}».',
    changeFailed: 'Не удалось изменить сочетание клавиш; проверьте наличие конфликта.',
    saved: '{binding} сохранено.',
    intro: 'Нажмите «Изменить» у действия, затем введите новое сочетание. Изменения сразу синхронизируются между главной страницей, Semi-Lunar и вкладками сайтов.',
    pressKeys: 'Нажмите клавиши…',
    change: 'Изменить',
    resetConflict: 'Сочетание по умолчанию используется другим действием. Сначала измените его или сбросьте все сочетания.',
    reset: 'Сбросить',
    keyboardNavigation: 'Навигация с клавиатуры',
    keyboardHint: 'Esc, Tab / Shift+Tab, Enter, пробел, стрелки, Home и End остаются закреплёнными для специальных возможностей.',
    resetAll: 'Сбросить все',
  },
  it: {
    reserved: 'Questa combinazione è riservata da Windows o Nebula.',
    needsModifier: 'Usa Ctrl o Alt con lettere, numeri e tasti di navigazione.',
    unsupported: 'Questa combinazione di tasti non è supportata in modo affidabile nelle WebView dei siti.',
    conflict: '{binding} è già usata per “{action}”.',
    changeFailed: 'Impossibile modificare la scorciatoia; verifica la presenza di conflitti.',
    saved: '{binding} salvata.',
    intro: 'Scegli Cambia su un’azione, quindi premi la nuova combinazione. Le modifiche vengono sincronizzate subito tra Home, Semi-Lunar e le schede dei siti.',
    pressKeys: 'Premi i tasti…',
    change: 'Cambia',
    resetConflict: 'La combinazione predefinita è usata da un’altra azione. Modifica prima quella scorciatoia o reimpostale tutte.',
    reset: 'Reimposta',
    keyboardNavigation: 'Navigazione da tastiera',
    keyboardHint: 'Esc, Tab / Maiusc+Tab, Invio, Spazio, frecce, Home e Fine restano fissi per l’accessibilità.',
    resetAll: 'Ripristina tutte le impostazioni predefinite',
  },
  ja: {
    reserved: 'このキーの組み合わせは Windows または Nebula によって予約されています。',
    needsModifier: '文字、数字、ナビゲーションキーには Ctrl または Alt を組み合わせてください。',
    unsupported: 'このキーの組み合わせはサイトの WebView 内で安定してサポートされていません。',
    conflict: '{binding} はすでに「{action}」で使用されています。',
    changeFailed: 'ショートカットを変更できませんでした。競合を確認してください。',
    saved: '{binding} を保存しました。',
    intro: 'アクションの「変更」を選び、新しいキーの組み合わせを押してください。変更はホーム、Semi-Lunar、サイトのタブにすぐ同期されます。',
    pressKeys: 'キーを押してください…',
    change: '変更',
    resetConflict: '既定の組み合わせが別のアクションで使用されています。先にそのショートカットを変更するか、すべてリセットしてください。',
    reset: 'リセット',
    keyboardNavigation: 'キーボード操作',
    keyboardHint: 'アクセシビリティのため、Esc、Tab / Shift+Tab、Enter、Space、矢印キー、Home、End は固定されています。',
    resetAll: 'すべて既定に戻す',
  },
} as const

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
  const copy = getLocaleCopy(SHORTCUT_UI_COPY, locale)
  const [recordingAction, setRecordingAction] =
    useState<ConfigurableBrowserShortcutId | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const actionLabel = useCallback(
    (action: ConfigurableBrowserShortcutId) => {
      const item = SHORTCUT_LABELS.get(action)
      return item ? localizedValue(item, locale) : action
    },
    [locale],
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
            ? copy.reserved
            : validation.reason === 'needs-modifier'
              ? copy.needsModifier
              : copy.unsupported,
        )
        return
      }

      const conflict = findBrowserShortcutConflict(bindings, binding, recordingAction)
      if (conflict) {
        setMessage(
          copy.conflict
            .replace('{binding}', formatBrowserShortcutBinding(binding))
            .replace('{action}', actionLabel(conflict)),
        )
        return
      }

      if (!onSetBinding(recordingAction, binding)) {
        setMessage(copy.changeFailed)
        return
      }

      setRecordingAction(null)
      setMessage(copy.saved.replace('{binding}', formatBrowserShortcutBinding(binding)))
    },
    [actionLabel, bindings, copy, onSetBinding, recordingAction, stopRecording],
  )

  return (
    <div className={styles.shortcutGroups} onKeyDownCapture={handleRecordingKeyDown}>
      <p className={styles.shortcutIntro}>
        {copy.intro}
      </p>

      {message && (
        <div className={styles.shortcutMessage} role="status" aria-live="polite">
          {message}
        </div>
      )}

      {SHORTCUT_REFERENCE.map((group) => (
        <section key={group.en} className={styles.shortcutGroup}>
          <h3 className={styles.shortcutGroupTitle}>{localizedValue(group, locale)}</h3>
          <div className={styles.shortcutList}>
            {group.items.map((item) => {
              const isRecording = recordingAction === item.actionId
              const note = shortcutNote(item, locale)
              return (
                <div key={item.actionId} className={styles.shortcutRow}>
                  <div className={styles.shortcutText}>
                    <div className={styles.shortcutLabel}>{localizedValue(item, locale)}</div>
                    {note && <div className={styles.shortcutNote}>{note}</div>}
                  </div>

                  <div className={styles.shortcutEditor}>
                    <div className={styles.shortcutKeySet} aria-label={bindings[item.actionId].join(' / ')}>
                      {bindings[item.actionId].map((binding, index) => (
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
                          setRecordingAction((current) => (current === item.actionId ? null : item.actionId))
                        }}
                      >
                        {isRecording ? copy.pressKeys : copy.change}
                      </button>
                      <button
                        type="button"
                        className={styles.shortcutResetBtn}
                        onClick={() => {
                          setRecordingAction(null)
                          const ok = onResetBinding(item.actionId)
                          setMessage(
                            ok
                              ? null
                              : copy.resetConflict,
                          )
                        }}
                      >
                        {copy.reset}
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
          <div className={styles.rowLabel}>{copy.keyboardNavigation}</div>
          <div className={styles.rowHint}>{copy.keyboardHint}</div>
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
          {copy.resetAll}
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
  notificationSites: string[]
  notificationSitePermissions: SiteNotificationPermissions
  onSetNotificationSitePermission: (
    origin: string,
    permission: SiteNotificationPermission | null,
  ) => void
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
  notificationSites,
  notificationSitePermissions,
  onSetNotificationSitePermission,
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
  notificationSites: string[]
  notificationSitePermissions: SiteNotificationPermissions
  onSetNotificationSitePermission: SettingsPanelProps['onSetNotificationSitePermission']
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
              { value: 'es', label: t('languageSpanish') },
              { value: 'de', label: t('languageGerman') },
              { value: 'fr', label: t('languageFrench') },
              { value: 'id', label: t('languageIndonesian') },
              { value: 'ru', label: t('languageRussian') },
              { value: 'it', label: t('languageItalian') },
              { value: 'ja', label: t('languageJapanese') },
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
          <SettingSelectRow
            label={t('darkenWebpages')}
            hint={t('darkenWebpagesHint')}
            value={appearance.darkenWebpages}
            options={[
              { value: 'off', label: t('darkenWebpagesOff') },
              { value: 'auto', label: t('darkenWebpagesAuto') },
              { value: 'always', label: t('darkenWebpagesAlways') },
            ]}
            onChange={(value) =>
              onUpdate(
                'appearance',
                'darkenWebpages',
                value as NebulaSettings['appearance']['darkenWebpages'],
              )
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
            value={Math.round(appearance.glassSaturate * 100)}
            min={50}
            max={200}
            step={5}
            unit="%"
            onChange={(v) => onUpdate('appearance', 'glassSaturate', v / 100)}
          />
          <SettingRangeRow
            label={t('glassContrast')}
            hint={t('glassContrastHint')}
            value={Math.round(appearance.glassContrast * 100)}
            min={60}
            max={120}
            step={2}
            unit="%"
            onChange={(v) => onUpdate('appearance', 'glassContrast', v / 100)}
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
            label={t('settingsRestoreSession')}
            hint={t('settingsRestoreSessionHint')}
            checked={browsing.restoreTabsOnStartup}
            onChange={() =>
              onUpdate('browsing', 'restoreTabsOnStartup', !browsing.restoreTabsOnStartup)
            }
          />
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>
                {t('settingsClearSession')}
              </div>
              <div className={styles.rowHint}>{t('settingsClearSessionHint')}</div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onClearSavedSession}>
              {t('settingsClear')}
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
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>
                {t('settingsResetLunarLayout')}
              </div>
              <div className={styles.rowHint}>{t('settingsResetLunarLayoutHint')}</div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onResetSemiLunarLayout}>
              {t('reset')}
            </button>
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>
                {t('settingsResetFolders')}
              </div>
              <div className={styles.rowHint}>{t('settingsResetFoldersHint')}</div>
            </div>
            <button type="button" className={styles.actionBtn} onClick={onResetFolders}>
              {t('reset')}
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
            label={t('downloadNotifications')}
            hint={t('downloadNotificationsHint')}
            checked={notifications.downloadNotifications}
            onChange={() =>
              onUpdate(
                'notifications',
                'downloadNotifications',
                !notifications.downloadNotifications,
              )
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
            label={t('showNotificationContent')}
            hint={t('showNotificationContentHint')}
            checked={notifications.showNotificationContent}
            disabled={!notifications.siteNotifications}
            onChange={() =>
              onUpdate(
                'notifications',
                'showNotificationContent',
                !notifications.showNotificationContent,
              )
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
          <div className={styles.notificationPermissions}>
            <div className={styles.rowText}>
              <div className={styles.rowLabel}>{t('notificationSitePermissions')}</div>
              <div className={styles.rowHint}>
                {notifications.siteNotifications
                  ? t('notificationSitePermissionsHint')
                  : t('notificationSitesDisabled')}
              </div>
            </div>
            {notificationSites.length === 0 ? (
              <p className={styles.notificationNoSites}>{t('notificationNoSites')}</p>
            ) : (
              <div className={styles.notificationSiteList}>
                {notificationSites.map((origin) => {
                  const permission = notificationSitePermissions[origin]
                  return (
                    <div key={origin} className={styles.notificationSiteRow}>
                      <span title={origin}>{notificationHost(origin)}</span>
                      <div className={styles.notificationPermissionButtons}>
                        <button
                          type="button"
                          className={permission === 'allow' ? styles.notificationAllowActive : ''}
                          disabled={!notifications.siteNotifications}
                          onClick={() => onSetNotificationSitePermission(origin, 'allow')}
                        >
                          {t('notificationAllow')}
                        </button>
                        <button
                          type="button"
                          className={permission === 'block' ? styles.notificationBlockActive : ''}
                          disabled={!notifications.siteNotifications}
                          onClick={() => onSetNotificationSitePermission(origin, 'block')}
                        >
                          {t('notificationBlock')}
                        </button>
                        <button
                          type="button"
                          disabled={!permission || !notifications.siteNotifications}
                          onClick={() => onSetNotificationSitePermission(origin, null)}
                        >
                          {t('notificationDefault')}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
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
  notificationSites,
  notificationSitePermissions,
  onSetNotificationSitePermission,
}: SettingsPanelProps) {
  const { t, locale } = useLocale()
  const [activeId, setActiveId] = useState<SettingsCategoryId>('appearance')
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [entering, setEntering] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasOpenRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const activeNavRef = useRef<HTMLButtonElement>(null)

  const settingsCategories = getSettingsCategories(locale)
  const activeCategory = settingsCategories.find((c) => c.id === activeId)!
  const settingsSearchResults = useMemo(() => {
    const tokens = normalizeSettingsSearchText(searchQuery.trim(), locale)
      .split(/\s+/)
      .filter(Boolean)
    if (tokens.length === 0) return []

    return SETTINGS_SEARCH_INDEX.map((entry, order) => {
      const category = settingsCategories.find((item) => item.id === entry.categoryId)
      const localizedLabel = normalizeSettingsSearchText(
        localizedValue(entry, locale),
        locale,
      )
      const searchable = normalizeSettingsSearchText([
        entry.tr,
        entry.en,
        entry.es,
        entry.de,
        entry.fr,
        entry.id,
        entry.ru,
        entry.keywords,
        category?.label,
        category?.description,
      ].filter(Boolean).join(' '), locale)

      if (!tokens.every((token) => searchable.includes(token))) return null

      const labelMatches = tokens.every((token) => localizedLabel.includes(token))
      const score = localizedLabel.startsWith(tokens.join(' '))
        ? 0
        : labelMatches
          ? 1
          : 2
      return { entry, order, score }
    })
      .filter((result): result is { entry: SettingsSearchEntry; order: number; score: number } => result !== null)
      .sort((left, right) => left.score - right.score || left.order - right.order)
      .slice(0, 12)
      .map(({ entry }) => entry)
  }, [locale, searchQuery, settingsCategories])

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
          <label className={styles.settingsSearch}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" />
            </svg>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('settingsSearchPlaceholder')}
              aria-label={t('settingsSearchAria')}
            />
          </label>
          {searchQuery.trim() ? (
            <div className={styles.settingsSearchResults}>
              {settingsSearchResults.length === 0 ? (
                <p className={styles.settingsSearchEmpty}>
                  {t('settingsSearchEmpty')}
                </p>
              ) : settingsSearchResults.map((entry) => {
                const category = settingsCategories.find((item) => item.id === entry.categoryId)!
                return (
                  <button
                    key={`${entry.categoryId}-${entry.en}`}
                    type="button"
                    className={styles.settingsSearchResult}
                    onClick={() => setActiveId(entry.categoryId)}
                  >
                    <span>{localizedValue(entry, locale)}</span>
                    <small>{category.label}</small>
                  </button>
                )
              })}
            </div>
          ) : settingsCategories.map((cat) => (
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
              notificationSites={notificationSites}
              notificationSitePermissions={notificationSitePermissions}
              onSetNotificationSitePermission={onSetNotificationSitePermission}
            />
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
