import { t, type NebulaLocale } from './locale'
import { EXTENSION_COPY } from './extensionCatalog'

export type SettingsCategoryId =
  | 'appearance'
  | 'home'
  | 'semi-lunar'
  | 'account'
  | 'extensions'
  | 'privacy'
  | 'notifications'
  | 'about'
  | 'shortcuts'

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
      id: 'shortcuts',
      label: t(locale, 'catShortcuts'),
      icon: '⌨',
      description: t(locale, 'catShortcutsDesc'),
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
      id: 'extensions',
      label: EXTENSION_COPY[locale].title,
      icon: '⊞',
      description: EXTENSION_COPY[locale].subtitle,
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
