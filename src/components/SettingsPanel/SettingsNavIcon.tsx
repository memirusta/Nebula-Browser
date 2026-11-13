import type { SettingsCategoryId } from '../../core/settingsCategories'

/** One line icon per category of the Settings menu: the same weight and size, drawn in the colour of the text. */
const PATHS: Record<SettingsCategoryId, string> = {
  appearance: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18M12 8h0',
  home: 'M4 11l8-7 8 7M6 10v9h12v-9',
  'semi-lunar': 'M4 10a8 8 0 0 1 16 0M7 14a5 5 0 0 1 10 0',
  shortcuts: 'M3 7h18v10H3zM7 11h1M11 11h1M15 11h1M8 14h8',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20c1-4 4-6 8-6s7 2 8 6',
  privacy: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  extensions: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15 14v6M12 17h6',
  notifications: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  about: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5M12 8h0',
}

export function SettingsNavIcon({ id }: { id: SettingsCategoryId }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[id]} />
    </svg>
  )
}
