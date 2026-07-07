export type SettingsCategoryId =
  | 'appearance'
  | 'home'
  | 'semi-lunar'
  | 'privacy'
  | 'notifications'
  | 'about'

export interface SettingsCategory {
  id: SettingsCategoryId
  label: string
  icon: string
  description: string
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'appearance',
    label: 'Görünüm',
    icon: '◐',
    description: 'Duvar kağıdı, tema ve cam efektleri',
  },
  {
    id: 'home',
    label: 'Ana Sayfa',
    icon: '⌂',
    description: 'Widget\'lar ve başlangıç düzeni',
  },
  {
    id: 'semi-lunar',
    label: 'Semi-Lunar',
    icon: '◠',
    description: 'Üst menü ve kısayol davranışı',
  },
  {
    id: 'privacy',
    label: 'Gizlilik',
    icon: '⛨',
    description: 'Takip engelleme ve veri koruması',
  },
  {
    id: 'notifications',
    label: 'Bildirimler',
    icon: '🔔',
    description: 'Uyarılar ve odak bildirimleri',
  },
  {
    id: 'about',
    label: 'Hakkında',
    icon: '✦',
    description: 'Sürüm ve yol haritası',
  },
]
