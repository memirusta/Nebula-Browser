import { t, type NebulaLocale } from './locale'

export type SettingsCategoryId =
  | 'appearance'
  | 'home'
  | 'semi-lunar'
  | 'account'
  | 'privacy'
  | 'notifications'
  | 'about'

export interface SettingsCategory {
  id: SettingsCategoryId
  label: string
  icon: string
  description: string
}

export function getSettingsCategories(locale: NebulaLocale): SettingsCategory[] {
  return [
    {
      id: 'appearance',
      label: t(locale, 'catAppearance'),
      icon: '◐',
      description: t(locale, 'catAppearanceDesc'),
    },
    {
      id: 'home',
      label: t(locale, 'catHome'),
      icon: '⌂',
      description: t(locale, 'catHomeDesc'),
    },
    {
      id: 'semi-lunar',
      label: t(locale, 'catSemiLunar'),
      icon: '◠',
      description: t(locale, 'catSemiLunarDesc'),
    },
    {
      id: 'account',
      label: t(locale, 'catAccount'),
      icon: '◎',
      description: t(locale, 'catAccountDesc'),
    },
    {
      id: 'privacy',
      label: t(locale, 'catPrivacy'),
      icon: '⛨',
      description: t(locale, 'catPrivacyDesc'),
    },
    {
      id: 'notifications',
      label: t(locale, 'catNotifications'),
      icon: '🔔',
      description: t(locale, 'catNotificationsDesc'),
    },
    {
      id: 'about',
      label: t(locale, 'catAbout'),
      icon: '✦',
      description: t(locale, 'catAboutDesc'),
    },
  ]
}

/** @deprecated Use getSettingsCategories(locale) */
export const SETTINGS_CATEGORIES: SettingsCategory[] = getSettingsCategories('tr')
