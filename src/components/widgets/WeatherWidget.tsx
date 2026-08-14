import { useEffect, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import {
  loadRegionalPreferences,
  type RegionalPreferences,
} from '../../core/regionalPreferences'
import styles from './widgets.module.css'

interface WeatherValue {
  location: string
  latitude: number
  longitude: number
}

interface CurrentWeather {
  temperature: number
  apparentTemperature: number
  humidity: number
  weatherCode: number
}

function weatherSymbol(code: number): string {
  if (code === 0) return '☀'
  if (code <= 3) return '☁'
  if (code === 45 || code === 48) return '≋'
  if (code >= 51 && code <= 67) return '☂'
  if (code >= 71 && code <= 77) return '❄'
  if (code >= 80 && code <= 82) return '☂'
  if (code >= 95) return 'ϟ'
  return '◌'
}

function regionalWeatherValue(
  preferences: RegionalPreferences,
): WeatherValue | null {
  const weatherLocation =
    preferences.weatherLocation

  if (
    !weatherLocation ||
    !Number.isFinite(weatherLocation.latitude) ||
    !Number.isFinite(weatherLocation.longitude)
  ) {
    return null
  }

  const location =
    weatherLocation.label?.trim() ||
    [
      weatherLocation.district,
      weatherLocation.city,
    ]
      .filter(Boolean)
      .join(', ') ||
    preferences.regionCode

  return {
    location,
    latitude:
      weatherLocation.latitude,
    longitude:
      weatherLocation.longitude,
  }
}

function sameWeatherValue(
  left: WeatherValue | undefined,
  right: WeatherValue,
): boolean {
  return Boolean(
    left &&
    left.location === right.location &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude,
  )
}

export function WeatherWidget({
  value,
  onChange,
}: {
  value?: WeatherValue
  onChange: (value: WeatherValue) => void
}) {
  const { t, locale } = useLocale()
  const [query, setQuery] = useState(value?.location ?? '')
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const location = value?.location ?? ''
  const latitude = value?.latitude
  const longitude = value?.longitude

  useEffect(() => {
    setQuery(location)
  }, [location])

  /*
   * Onboarding stores the canonical weather location in regional preferences.
   * A newly-added/existing Weather widget with no location adopts it once and
   * persists it through its normal onChange -> widget layout state path.
   */
  useEffect(() => {
    if (value) return

    const regional =
      regionalWeatherValue(
        loadRegionalPreferences(),
      )

    if (regional) {
      onChange(regional)
    }
  }, [onChange, value])

  /*
   * Keep an already-mounted Home weather widget in sync while onboarding is
   * still covering the app. saveRegionalPreferences dispatches this event when
   * the user presses Continue on the Welcome step.
   */
  useEffect(() => {
    const handleRegionalChange = (
      event: Event,
    ) => {
      const preferences =
        (
          event as CustomEvent<RegionalPreferences>
        ).detail

      const regional =
        regionalWeatherValue(
          preferences,
        )

      if (
        regional &&
        !sameWeatherValue(
          value,
          regional,
        )
      ) {
        onChange(regional)
      }
    }

    window.addEventListener(
      'nebula-regional-preferences-changed',
      handleRegionalChange,
    )

    return () => {
      window.removeEventListener(
        'nebula-regional-preferences-changed',
        handleRegionalChange,
      )
    }
  }, [onChange, value])

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) {
      setWeather(null)
      setLoading(false)
      setError(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(false)

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',
      timezone: 'auto',
    })

    fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error('weather request failed')
        return res.json()
      })
      .then((data: { current?: Record<string, number> }) => {
        if (cancelled || !data.current) return
        setWeather({
          temperature: data.current.temperature_2m,
          apparentTemperature: data.current.apparent_temperature,
          humidity: data.current.relative_humidity_2m,
          weatherCode: data.current.weather_code,
        })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [latitude, longitude])

  const search = async () => {
    const text = query.trim()
    if (!text) return
    setLoading(true)
    setError(false)

    try {
      const params = new URLSearchParams({
        name: text,
        count: '1',
        language: locale,
        format: 'json',
      })
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?${params}`,
      )
      if (!res.ok) throw new Error('geocoding failed')
      const data = await res.json() as {
        results?: Array<{
          name: string
          admin1?: string
          country?: string
          latitude: number
          longitude: number
        }>
      }
      const match = data.results?.[0]
      if (!match) throw new Error('no location')
      const nextLocation = [
        match.name,
        match.admin1,
        match.country,
      ]
        .filter(Boolean)
        .filter(
          (part, index, all) =>
            all.indexOf(part) === index,
        )
        .join(', ')

      onChange({
        location: nextLocation,
        latitude: match.latitude,
        longitude: match.longitude,
      })
      setQuery(nextLocation)
    } catch {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <div className={styles.weather}>
      <div className={styles.weatherSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
          placeholder={t('weatherLocationPlaceholder')}
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading || !query.trim()}
        >
          {t('weatherSearch')}
        </button>
      </div>

      {loading && !weather && (
        <p className={styles.widgetHint}>{t('weatherLoading')}</p>
      )}
      {error && (
        <p className={styles.widgetHint}>{t('weatherError')}</p>
      )}
      {!value && !loading && !error && (
        <p className={styles.widgetHint}>{t('weatherNoLocation')}</p>
      )}
      {value && weather && (
        <div className={styles.weatherCurrent}>
          <div className={styles.weatherTop}>
            <span className={styles.weatherIcon}>
              {weatherSymbol(weather.weatherCode)}
            </span>
            <div>
              <strong>{Math.round(weather.temperature)}°</strong>
              <span>{value.location}</span>
            </div>
          </div>
          <div className={styles.weatherMeta}>
            <span>
              {t('weatherFeelsLike')}{' '}
              <b>{Math.round(weather.apparentTemperature)}°</b>
            </span>
            <span>
              {t('weatherHumidity')}{' '}
              <b>{Math.round(weather.humidity)}%</b>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
