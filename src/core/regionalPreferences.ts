export type WeatherLocationSource =
  | 'system'
  | 'device'
  | 'search'

export interface WeatherLocation {
  id: string
  label: string
  countryCode: string
  adminArea?: string
  city?: string
  district?: string
  latitude: number
  longitude: number
  timeZone: string
  source: WeatherLocationSource
}

export interface RegionalPreferences {
  language: string
  regionCode: string
  timeZone: string
  weatherLocation?: WeatherLocation
}

const STORAGE_KEY =
  'nebula-regional-preferences-v1'

function regionFromTimeZone(
  timeZone: string,
): string | null {
  switch (timeZone) {
    case 'Europe/Istanbul':
      return 'TR'
    case 'Europe/London':
      return 'GB'
    case 'Europe/Berlin':
      return 'DE'
    case 'Europe/Paris':
      return 'FR'
    case 'Asia/Tokyo':
      return 'JP'
    case 'Asia/Seoul':
      return 'KR'
    default:
      return null
  }
}

export function detectSystemRegionalPreferences():
  RegionalPreferences {
  const locale =
    navigator.languages?.[0] ||
    navigator.language ||
    'en-US'

  const parsed =
    new Intl.Locale(locale)

  const timeZone =
    Intl.DateTimeFormat()
      .resolvedOptions()
      .timeZone || 'UTC'

  /*
   * Timezone is a stronger signal than browser UI language for machines
   * whose browser language is English. This fixes en-US + Europe/Istanbul
   * incorrectly defaulting Nebula to the United States.
   */
  const regionCode =
    regionFromTimeZone(timeZone) ||
    parsed.region ||
    'US'

  return {
    language:
      parsed.language || 'en',
    regionCode,
    timeZone,
  }
}

export function loadRegionalPreferences():
  RegionalPreferences {
  try {
    const raw =
      localStorage.getItem(
        STORAGE_KEY,
      )

    if (raw) {
      const parsed =
        JSON.parse(
          raw,
        ) as RegionalPreferences

      if (
        parsed &&
        typeof parsed.regionCode ===
          'string' &&
        typeof parsed.timeZone ===
          'string'
      ) {
        return parsed
      }
    }
  } catch {
    // Ignore corrupt preference data and fall back to system values.
  }

  return detectSystemRegionalPreferences()
}

export function saveRegionalPreferences(
  preferences: RegionalPreferences,
): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(preferences),
  )

  window.dispatchEvent(
    new CustomEvent(
      'nebula-regional-preferences-changed',
      {
        detail:
          preferences,
      },
    ),
  )
}
