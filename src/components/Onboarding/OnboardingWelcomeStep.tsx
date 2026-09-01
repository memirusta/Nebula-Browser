import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  loadRegionalPreferences,
  saveRegionalPreferences,
  type RegionalPreferences,
} from '../../core/regionalPreferences'
import { getIntlLocale, getLocaleCopy, LOCALE_OPTIONS } from '../../core/locale'
import type { NebulaLocale } from '../../hooks/useLocale'
import {
  searchWeatherCities,
  searchWeatherSubdivisions,
  weatherCityLabel,
  type WeatherCity,
  type WeatherSubdivision,
} from '../../platform/weatherLocationSearch'
import { ensureMainPermissionUi } from '../../platform/mainPermissionUi'
import styles from './OnboardingWizard.module.css'

interface Props {
  locale: NebulaLocale
  onLocaleChange: (locale: NebulaLocale) => void
  onContinue: () => void
}

const LANGUAGES = LOCALE_OPTIONS.map(({ value, nativeLabel }) => ({
  value,
  label: nativeLabel,
}))

const COUNTRY_CODES = [
'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW'
] as const

const COPY = {
  en: {
    subtitle: 'A browser that feels like yours.',
    language: 'Language',
    region: 'Region',
    weather: 'Weather location',
    cityPlaceholder: 'Type a city…',
    searchingCities: 'Searching cities…',
    noCities: 'No matching cities found.',
    citySearchFailed: 'Couldn’t reach location search. Check the logs and try again.',
    districtsIn: (city: string) => `Districts and neighbourhoods in ${city}`,
    searchDistrict: 'Filter districts…',
    loadingDistricts: 'Finding districts and neighbourhoods…',
    noDistricts: 'No smaller areas were returned. The city itself will be used.',
    changeCity: 'Change city',
    currentLocation: 'Use precise location',
    locating: 'Locating…',
    preciseSelected: 'Using precise location',
    preciseFailed: 'Precise location could not be detected.',
    preciseUnavailable: 'Location is not available on this device.',
    detected: 'Detected',
    preferencesHint: 'You can change these anytime in Settings.',
    continue: 'Continue',
  },
  tr: {
    subtitle: 'Sana ait hissettiren bir tarayıcı.',
    language: 'Dil',
    region: 'Bölge',
    weather: 'Hava durumu konumu',
    cityPlaceholder: 'Bir şehir yaz…',
    searchingCities: 'Şehirler aranıyor…',
    noCities: 'Eşleşen şehir bulunamadı.',
    citySearchFailed: 'Konum aramasına ulaşılamadı. Logları kontrol edip tekrar dene.',
    districtsIn: (city: string) => `${city} içindeki ilçe ve semtler`,
    searchDistrict: 'İlçe veya semt filtrele…',
    loadingDistricts: 'İlçe ve semtler bulunuyor…',
    noDistricts: 'Daha küçük bir bölge bulunamadı. Şehrin kendisi kullanılacak.',
    changeCity: 'Şehri değiştir',
    currentLocation: 'Hassas konumu kullan',
    locating: 'Konum alınıyor…',
    preciseSelected: 'Hassas konum kullanılıyor',
    preciseFailed: 'Hassas konum alınamadı.',
    preciseUnavailable: 'Bu cihazda konum kullanılamıyor.',
    detected: 'Algılandı',
    preferencesHint: 'Bunları daha sonra Ayarlar’dan değiştirebilirsin.',
    continue: 'Devam et',
  },
  es: {
    subtitle: 'Un navegador que se siente tuyo.',
    language: 'Idioma',
    region: 'Región',
    weather: 'Ubicación meteorológica',
    cityPlaceholder: 'Escribe una ciudad…',
    searchingCities: 'Buscando ciudades…',
    noCities: 'No se encontraron ciudades coincidentes.',
    citySearchFailed: 'No se pudo acceder a la búsqueda de ubicaciones. Revisa los registros y vuelve a intentarlo.',
    districtsIn: (city: string) => `Distritos y barrios de ${city}`,
    searchDistrict: 'Filtrar distritos…',
    loadingDistricts: 'Buscando distritos y barrios…',
    noDistricts: 'No se encontraron zonas más pequeñas. Se utilizará la propia ciudad.',
    changeCity: 'Cambiar ciudad',
    currentLocation: 'Usar ubicación precisa',
    locating: 'Localizando…',
    preciseSelected: 'Usando ubicación precisa',
    preciseFailed: 'No se pudo detectar la ubicación precisa.',
    preciseUnavailable: 'La ubicación no está disponible en este dispositivo.',
    detected: 'Detectado',
    preferencesHint: 'Puedes cambiar estas opciones en cualquier momento desde Ajustes.',
    continue: 'Continuar',
  },
  de: {
    subtitle: 'Ein Browser, der sich wie deiner anfühlt.',
    language: 'Sprache',
    region: 'Region',
    weather: 'Wetterstandort',
    cityPlaceholder: 'Stadt eingeben…',
    searchingCities: 'Städte werden gesucht…',
    noCities: 'Keine passenden Städte gefunden.',
    citySearchFailed: 'Die Standortsuche ist nicht erreichbar. Prüfe die Protokolle und versuche es erneut.',
    districtsIn: (city: string) => `Bezirke und Stadtteile in ${city}`,
    searchDistrict: 'Bezirke filtern…',
    loadingDistricts: 'Bezirke und Stadtteile werden gesucht…',
    noDistricts: 'Es wurden keine kleineren Gebiete gefunden. Die Stadt selbst wird verwendet.',
    changeCity: 'Stadt ändern',
    currentLocation: 'Genauen Standort verwenden',
    locating: 'Standort wird ermittelt…',
    preciseSelected: 'Genauer Standort wird verwendet',
    preciseFailed: 'Der genaue Standort konnte nicht ermittelt werden.',
    preciseUnavailable: 'Der Standort ist auf diesem Gerät nicht verfügbar.',
    detected: 'Erkannt',
    preferencesHint: 'Du kannst diese Einstellungen jederzeit in den Einstellungen ändern.',
    continue: 'Weiter',
  },
  fr: {
    subtitle: 'Un navigateur qui vous ressemble.',
    language: 'Langue',
    region: 'Région',
    weather: 'Lieu pour la météo',
    cityPlaceholder: 'Saisissez une ville…',
    searchingCities: 'Recherche de villes…',
    noCities: 'Aucune ville correspondante.',
    citySearchFailed: 'La recherche de lieux est inaccessible. Consultez les journaux et réessayez.',
    districtsIn: (city: string) => `Arrondissements et quartiers de ${city}`,
    searchDistrict: 'Filtrer les quartiers…',
    loadingDistricts: 'Recherche des arrondissements et quartiers…',
    noDistricts: 'Aucune zone plus précise n’a été trouvée. La ville sera utilisée.',
    changeCity: 'Changer de ville',
    currentLocation: 'Utiliser la localisation précise',
    locating: 'Localisation…',
    preciseSelected: 'Localisation précise utilisée',
    preciseFailed: 'La localisation précise n’a pas pu être détectée.',
    preciseUnavailable: 'La localisation n’est pas disponible sur cet appareil.',
    detected: 'Détecté',
    preferencesHint: 'Vous pourrez modifier ces choix à tout moment dans les Paramètres.',
    continue: 'Continuer',
  },
  id: {
    subtitle: 'Browser yang terasa milik Anda.',
    language: 'Bahasa',
    region: 'Wilayah',
    weather: 'Lokasi cuaca',
    cityPlaceholder: 'Ketik nama kota…',
    searchingCities: 'Mencari kota…',
    noCities: 'Tidak ada kota yang cocok.',
    citySearchFailed: 'Pencarian lokasi tidak dapat dijangkau. Periksa log lalu coba lagi.',
    districtsIn: (city: string) => `Kecamatan dan lingkungan di ${city}`,
    searchDistrict: 'Filter kecamatan…',
    loadingDistricts: 'Mencari kecamatan dan lingkungan…',
    noDistricts: 'Tidak ada wilayah yang lebih kecil. Kota tersebut akan digunakan.',
    changeCity: 'Ubah kota',
    currentLocation: 'Gunakan lokasi akurat',
    locating: 'Mencari lokasi…',
    preciseSelected: 'Menggunakan lokasi akurat',
    preciseFailed: 'Lokasi akurat tidak dapat dideteksi.',
    preciseUnavailable: 'Lokasi tidak tersedia di perangkat ini.',
    detected: 'Terdeteksi',
    preferencesHint: 'Anda dapat mengubahnya kapan saja di Setelan.',
    continue: 'Lanjutkan',
  },
  ru: {
    subtitle: 'Браузер, который ощущается вашим.',
    language: 'Язык',
    region: 'Регион',
    weather: 'Местоположение для погоды',
    cityPlaceholder: 'Введите город…',
    searchingCities: 'Поиск городов…',
    noCities: 'Подходящие города не найдены.',
    citySearchFailed: 'Не удалось выполнить поиск местоположения. Проверьте журнал и повторите попытку.',
    districtsIn: (city: string) => `Районы и кварталы города ${city}`,
    searchDistrict: 'Фильтр районов…',
    loadingDistricts: 'Поиск районов и кварталов…',
    noDistricts: 'Более точные районы не найдены. Будет использован сам город.',
    changeCity: 'Изменить город',
    currentLocation: 'Использовать точное местоположение',
    locating: 'Определение местоположения…',
    preciseSelected: 'Используется точное местоположение',
    preciseFailed: 'Не удалось определить точное местоположение.',
    preciseUnavailable: 'Местоположение недоступно на этом устройстве.',
    detected: 'Определено',
    preferencesHint: 'Эти параметры можно изменить в любой момент в Настройках.',
    continue: 'Продолжить',
  },
  it: {
    subtitle: 'Un browser che senti tuo.',
    language: 'Lingua',
    region: 'Regione',
    weather: 'Località meteo',
    cityPlaceholder: 'Digita una città…',
    searchingCities: 'Ricerca città…',
    noCities: 'Nessuna città corrispondente.',
    citySearchFailed: 'Impossibile raggiungere la ricerca delle località. Controlla i log e riprova.',
    districtsIn: (city: string) => `Distretti e quartieri di ${city}`,
    searchDistrict: 'Filtra distretti…',
    loadingDistricts: 'Ricerca di distretti e quartieri…',
    noDistricts: 'Non sono state trovate aree più piccole. Verrà usata la città.',
    changeCity: 'Cambia città',
    currentLocation: 'Usa posizione precisa',
    locating: 'Localizzazione…',
    preciseSelected: 'Posizione precisa in uso',
    preciseFailed: 'Impossibile rilevare la posizione precisa.',
    preciseUnavailable: 'La posizione non è disponibile su questo dispositivo.',
    detected: 'Rilevata',
    preferencesHint: 'Puoi modificare queste opzioni in qualsiasi momento nelle Impostazioni.',
    continue: 'Continua',
  },
  ja: {
    subtitle: '自分らしく使えるブラウザー。',
    language: '言語',
    region: '地域',
    weather: '天気の地域',
    cityPlaceholder: '都市を入力…',
    searchingCities: '都市を検索中…',
    noCities: '一致する都市が見つかりませんでした。',
    citySearchFailed: '地域検索に接続できませんでした。ログを確認して再試行してください。',
    districtsIn: (city: string) => `${city} の地区と近隣地域`,
    searchDistrict: '地区を絞り込む…',
    loadingDistricts: '地区と近隣地域を検索中…',
    noDistricts: 'より小さい地域は見つかりませんでした。都市自体を使用します。',
    changeCity: '都市を変更',
    currentLocation: '正確な位置情報を使用',
    locating: '位置情報を取得中…',
    preciseSelected: '正確な位置情報を使用中',
    preciseFailed: '正確な位置情報を取得できませんでした。',
    preciseUnavailable: 'このデバイスでは位置情報を利用できません。',
    detected: '検出済み',
    preferencesHint: 'これらはいつでも設定から変更できます。',
    continue: '続行',
  },
} as const

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function OnboardingWelcomeStep({
  locale,
  onLocaleChange,
  onContinue,
}: Props) {
  const copy = getLocaleCopy(COPY, locale)
  const initial = useMemo(() => loadRegionalPreferences(), [])
  const [preferences, setPreferences] =
    useState<RegionalPreferences>(initial)
  const [cityQuery, setCityQuery] = useState('')
  const [cityResults, setCityResults] = useState<WeatherCity[]>([])
  const [citySearching, setCitySearching] = useState(false)
  const [citySearchError, setCitySearchError] = useState(false)
  const [selectedCity, setSelectedCity] = useState<WeatherCity | null>(null)
  const [subdivisions, setSubdivisions] =
    useState<WeatherSubdivision[]>([])
  const [subdivisionLoading, setSubdivisionLoading] = useState(false)
  const [subdivisionFilter, setSubdivisionFilter] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const citySearchSequence = useRef(0)
  const subdivisionSequence = useRef(0)

  const regionNames = useMemo(
    () =>
      new Intl.DisplayNames(
        [getIntlLocale(locale)],
        { type: 'region' },
      ),
    [locale],
  )

  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({
        code,
        label: regionNames.of(code) || code,
      })).sort((a, b) =>
        a.label.localeCompare(
          b.label,
          getIntlLocale(locale),
        ),
      ),
    [locale, regionNames],
  )

  const selectedCountry = countries.find(
    (country) => country.code === preferences.regionCode,
  )

  const filteredSubdivisions = useMemo(() => {
    const needle = normalize(subdivisionFilter.trim())
    if (!needle) return subdivisions

    return subdivisions.filter((item) =>
      normalize(item.name).includes(needle),
    )
  }, [subdivisionFilter, subdivisions])

  useEffect(() => {
    if (selectedCity || cityQuery.trim().length < 2) {
      setCityResults([])
      setCitySearching(false)
      setCitySearchError(false)
      return
    }

    const sequence = ++citySearchSequence.current

    const timer = window.setTimeout(() => {
      setCitySearching(true)
      setCitySearchError(false)

      void searchWeatherCities(
        cityQuery,
        preferences.regionCode,
        locale,
      )
        .then(
          (results) => {
            if (citySearchSequence.current !== sequence) return
            setCityResults(results)
            setCitySearchError(false)
          },
          (error) => {
            if (citySearchSequence.current !== sequence) return

            console.error(
              '[nebula onboarding] weather city search rejected',
              {
                query:
                  cityQuery,
                countryCode:
                  preferences.regionCode,
                locale,
                error,
              },
            )

            setCityResults([])
            setCitySearchError(true)
          },
        )
        .finally(() => {
          if (citySearchSequence.current === sequence) {
            setCitySearching(false)
          }
        })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    cityQuery,
    locale,
    preferences.regionCode,
    selectedCity,
  ])

  function updateRegion(regionCode: string) {
    setPreferences((current) => ({
      ...current,
      regionCode,
      weatherLocation: undefined,
    }))

    setSelectedCity(null)
    setCityQuery('')
    setCityResults([])
    setSubdivisions([])
    setSubdivisionFilter('')
    setLocationError(null)
  }

  async function selectCity(city: WeatherCity) {
    const sequence = ++subdivisionSequence.current

    setSelectedCity(city)
    setCityQuery(weatherCityLabel(city))
    setCityResults([])
    setSubdivisions([])
    setSubdivisionFilter('')
    setSubdivisionLoading(true)

    setPreferences((current) => ({
      ...current,
      regionCode: city.countryCode,
      timeZone: city.timeZone,
      weatherLocation: {
        id: city.id,
        label: weatherCityLabel(city),
        countryCode: city.countryCode,
        adminArea: city.adminArea || undefined,
        city: city.name,
        latitude: city.latitude,
        longitude: city.longitude,
        timeZone: city.timeZone,
        source: 'search',
      },
    }))

    try {
      const results = await searchWeatherSubdivisions(city, locale)

      if (subdivisionSequence.current === sequence) {
        setSubdivisions(results)
      }
    } catch {
      if (subdivisionSequence.current === sequence) {
        setSubdivisions([])
      }
    } finally {
      if (subdivisionSequence.current === sequence) {
        setSubdivisionLoading(false)
      }
    }
  }

  function selectSubdivision(item: WeatherSubdivision) {
    setPreferences((current) => ({
      ...current,
      regionCode: item.countryCode,
      timeZone: item.timeZone,
      weatherLocation: {
        id: item.id,
        label: `${item.name}, ${item.city}`,
        countryCode: item.countryCode,
        city: item.city,
        district: item.name,
        latitude: item.latitude,
        longitude: item.longitude,
        timeZone: item.timeZone,
        source: 'search',
      },
    }))
  }

  function resetCity() {
    subdivisionSequence.current += 1
    setSelectedCity(null)
    setCityQuery('')
    setCityResults([])
    setSubdivisions([])
    setSubdivisionFilter('')

    setPreferences((current) => ({
      ...current,
      weatherLocation: undefined,
    }))
  }

  async function requestPreciseLocation() {
    if (!navigator.geolocation) {
      setLocationError(copy.preciseUnavailable)
      return
    }

    setLocating(true)
    setLocationError(null)

    try {
      await ensureMainPermissionUi()
    } catch {
      setLocating(false)
      setLocationError(copy.preciseFailed)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          preferences.timeZone ||
          'UTC'

        setPreferences((current) => ({
          ...current,
          timeZone,
          weatherLocation: {
            id: 'device-current',
            label: copy.preciseSelected,
            countryCode: current.regionCode,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timeZone,
            source: 'device',
          },
        }))

        setSelectedCity(null)
        setCityQuery('')
        setCityResults([])
        setSubdivisions([])
        setSubdivisionFilter('')
        setLocating(false)
      },
      () => {
        setLocationError(copy.preciseFailed)
        setLocating(false)
      },
      {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 15 * 60 * 1000,
      },
    )
  }

  function handleContinue() {
    saveRegionalPreferences({
      ...preferences,
      language: locale,
    })

    onContinue()
  }

  const hasCityDropdown =
    !selectedCity && cityQuery.trim().length >= 2

  const locationBusy =
    citySearching ||
    subdivisionLoading ||
    locating

  return (
    <div className={styles.welcomeSetup}>
      <div className={styles.welcomeHero}>
        <img
          className={styles.nebulaLogo}
          src="/nebula-app-logo.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />

        <div>
          <h1 id="onboarding-title" className={styles.welcomeTitle}>
            Welcome to Nebula
          </h1>
          <p className={styles.welcomeSubtitle}>{copy.subtitle}</p>
        </div>
      </div>

      <div className={styles.welcomeSettingsCard}>
        <label className={styles.setupField}>
          <span>{copy.language}</span>
          <select
            value={locale}
            onChange={(event) =>
              onLocaleChange(event.target.value as NebulaLocale)
            }
          >
            {LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.setupField}>
          <span>{copy.region}</span>
          <select
            value={preferences.regionCode}
            onChange={(event) => updateRegion(event.target.value)}
          >
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className={styles.weatherToolbox}>
        <div className={styles.weatherHeader}>
          <div>
            <span className={styles.weatherLabel}>{copy.weather}</span>
            <small>
              {selectedCountry
                ? `${copy.detected}: ${selectedCountry.label}`
                : preferences.regionCode}
            </small>
          </div>

          <button
            type="button"
            className={styles.locationButton}
            onClick={() => void requestPreciseLocation()}
            disabled={locating}
          >
            {locating ? copy.locating : copy.currentLocation}
          </button>
        </div>

        {preferences.weatherLocation?.source === 'device' ? (
          <div className={styles.preciseLocationCard}>
            <span className={styles.locationPulse} aria-hidden="true" />
            <strong>{copy.preciseSelected}</strong>
          </div>
        ) : !selectedCity ? (
          <div className={styles.locationSearch}>
            <input
              className={styles.locationSearchInput}
              value={cityQuery}
              onChange={(event) => setCityQuery(event.target.value)}
              placeholder={copy.cityPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />

            {hasCityDropdown && (
              <div className={styles.locationResults}>
                {citySearching ? (
                  <div className={styles.locationState}>
                    {copy.searchingCities}
                  </div>
                ) : citySearchError ? (
                  <div className={styles.locationState}>
                    {copy.citySearchFailed}
                  </div>
                ) : cityResults.length > 0 ? (
                  cityResults.map((city) => (
                    <button
                      type="button"
                      key={city.id}
                      className={styles.locationResult}
                      onClick={() => void selectCity(city)}
                    >
                      <strong>{city.name}</strong>
                      <span>
                        {[city.adminArea, city.country]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className={styles.locationState}>
                    {copy.noCities}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.districtPicker}>
            <div className={styles.selectedCityRow}>
              <div>
                <strong>{selectedCity.name}</strong>
                <span>{copy.districtsIn(selectedCity.name)}</span>
              </div>

              <button
                type="button"
                className={styles.changeCityButton}
                onClick={resetCity}
              >
                {copy.changeCity}
              </button>
            </div>

            {subdivisionLoading ? (
              <div className={styles.locationState}>
                {copy.loadingDistricts}
              </div>
            ) : subdivisions.length > 0 ? (
              <>
                <input
                  className={styles.locationSearchInput}
                  value={subdivisionFilter}
                  onChange={(event) =>
                    setSubdivisionFilter(event.target.value)
                  }
                  placeholder={copy.searchDistrict}
                  autoComplete="off"
                />

                <div className={styles.districtResults}>
                  {filteredSubdivisions.map((item) => {
                    const active =
                      preferences.weatherLocation?.id === item.id

                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={[
                          styles.districtResult,
                          active ? styles.districtResultActive : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => selectSubdivision(item)}
                      >
                        <span>{item.name}</span>
                        <small>{item.kind}</small>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className={styles.locationState}>
                {copy.noDistricts}
              </div>
            )}
          </div>
        )}

        {locationError && (
          <p className={styles.error}>{locationError}</p>
        )}
      </section>

      <div className={styles.welcomeFooter}>
        <p className={styles.preferencesHint}>
          {copy.preferencesHint}
        </p>

        <button
          type="button"
          className={styles.welcomeContinue}
          onClick={handleContinue}
          disabled={locationBusy}
          aria-busy={locationBusy}
        >
          {copy.continue}
        </button>
      </div>
    </div>
  )
}
