import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export interface WeatherCity {
  id: string
  name: string
  adminArea: string
  countryCode: string
  country: string
  latitude: number
  longitude: number
  timeZone: string
}

export interface WeatherSubdivision {
  id: string
  name: string
  city: string
  countryCode: string
  latitude: number
  longitude: number
  timeZone: string
  kind: string
}

interface OpenMeteoResult {
  id: number
  name: string
  latitude: number
  longitude: number
  timezone?: string
  feature_code?: string
  country_code?: string
  country?: string
  admin1?: string
  admin2?: string
  admin3?: string
  admin4?: string
}

interface OpenMeteoResponse {
  results?: OpenMeteoResult[]
}

function firstAdminArea(
  result: OpenMeteoResult,
): string {
  return [
    result.admin1,
    result.admin2,
    result.admin3,
    result.admin4,
  ].find(
    (value) =>
      Boolean(
        value?.trim() &&
        value.trim().toLocaleLowerCase() !==
          result.name.trim().toLocaleLowerCase(),
      ),
  )?.trim() ?? ''
}

export function weatherCityLabel(
  city: WeatherCity,
): string {
  const tail = [
    city.adminArea,
    city.country,
  ].filter(Boolean)

  return tail.length
    ? `${city.name}, ${tail.join(', ')}`
    : city.name
}

export async function searchWeatherCities(
  query: string,
  countryCode: string,
  language: string,
): Promise<WeatherCity[]> {
  const trimmed =
    query.trim()

  if (trimmed.length < 2) {
    return []
  }

  if (isTauri) {
    try {
      const results =
        await invoke<WeatherCity[]>(
          'weather_search_cities',
          {
            query:
              trimmed,
            countryCode,
            language,
          },
        )

      if (import.meta.env.DEV) {
        console.info(
          '[nebula weather] city search success',
          {
            query:
              trimmed,
            countryCode,
            language,
            count:
              results.length,
            results:
              results.map(
                (item) => ({
                  name:
                    item.name,
                  adminArea:
                    item.adminArea,
                  countryCode:
                    item.countryCode,
                  timeZone:
                    item.timeZone,
                }),
              ),
          },
        )
      }

      return results
    } catch (error) {
      console.error(
        '[nebula weather] city search failed',
        {
          query:
            trimmed,
          countryCode,
          language,
          error,
        },
      )

      throw error
    }
  }

  /*
   * Browser-dev fallback. Production uses the Rust command so CORS,
   * timeout and provider switching stay outside the React component.
   */
  const params =
    new URLSearchParams({
      name:
        trimmed,
      count:
        '8',
      format:
        'json',
      language:
        language.toLowerCase(),
      countryCode:
        countryCode.toUpperCase(),
    })

  let response: Response

  try {
    response =
      await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
      )
  } catch (error) {
    console.error(
      '[nebula weather] browser fallback request failed',
      {
        query:
          trimmed,
        countryCode,
        language,
        error,
      },
    )

    throw error
  }

  if (!response.ok) {
    const error =
      new Error(
        `Location search failed (${response.status})`,
      )

    console.error(
      '[nebula weather] browser fallback HTTP error',
      {
        query:
          trimmed,
        countryCode,
        language,
        status:
          response.status,
      },
    )

    throw error
  }

  const data =
    await response.json() as
      OpenMeteoResponse

  return (
    data.results ?? []
  )
    .filter((result) => {
      const featureCode =
        result.feature_code ?? ''

      return (
        !featureCode ||
        featureCode.startsWith('PPL') ||
        featureCode.startsWith('ADM')
      )
    })
    .sort((left, right) => {
      const rank = (featureCode?: string) => {
        if (!featureCode || featureCode.startsWith('PPL')) return 0
        if (featureCode.startsWith('ADM')) return 1
        return 2
      }

      return rank(left.feature_code) - rank(right.feature_code)
    })
    .map(
      (result) => ({
        id:
          `open-meteo:${result.id}`,
        name:
          result.name,
        adminArea:
          firstAdminArea(
            result,
          ),
        countryCode:
          (
            result.country_code ||
            countryCode
          ).toUpperCase(),
        country:
          result.country || '',
        latitude:
          result.latitude,
        longitude:
          result.longitude,
        timeZone:
          result.timezone ||
          Intl.DateTimeFormat()
            .resolvedOptions()
            .timeZone ||
          'UTC',
      }),
    )
}

export async function searchWeatherSubdivisions(
  city: WeatherCity,
  language: string,
): Promise<WeatherSubdivision[]> {
  if (!isTauri) {
    return []
  }

  return invoke<
    WeatherSubdivision[]
  >(
    'weather_search_subdivisions',
    {
      cityName:
        city.name,
      countryCode:
        city.countryCode,
      latitude:
        city.latitude,
      longitude:
        city.longitude,
      timeZone:
        city.timeZone,
      language,
    },
  )
}
