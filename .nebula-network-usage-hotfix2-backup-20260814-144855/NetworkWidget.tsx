import {
  useEffect,
  useState,
} from 'react'
import { useLocale } from '../../hooks/useLocale'
import {
  fetchNetworkStats,
  type NetworkStatsSnapshot,
} from '../../platform/networkStats'
import styles from './widgets.module.css'


const COPY = {
  en: {
    online: 'Online',
    offline: 'Offline',
    download: 'Download',
    upload: 'Upload',
    usage: 'Usage',
    measuring: 'Measuring network traffic…',
    unavailable: 'Network counters are unavailable.',
  },
  tr: {
    online: 'Çevrimiçi',
    offline: 'Çevrimdışı',
    download: 'İndirme',
    upload: 'Yükleme',
    usage: 'Kullanım',
    measuring: 'Ağ trafiği ölçülüyor…',
    unavailable: 'Ağ sayaçları kullanılamıyor.',
  },
} as const

function formatMbps(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0.00'
  }

  if (value < 10) {
    return value.toFixed(2)
  }

  if (value < 100) {
    return value.toFixed(1)
  }

  return Math.round(value).toString()
}

export function NetworkWidget() {
  const { locale } = useLocale()
  const copy = COPY[locale]

  const [
    online,
    setOnline,
  ] = useState(
    navigator.onLine,
  )

  const [
    snapshot,
    setSnapshot,
  ] =
    useState<NetworkStatsSnapshot | null>(
      null,
    )

  const [
    history,
    setHistory,
  ] =
    useState<TrafficPoint[]>(
      [],
    )

  useEffect(() => {
    let disposed = false
    let polling = false

    const updateOnline = () => {
      if (!disposed) {
        setOnline(
          navigator.onLine,
        )
      }
    }

    const poll = async () => {
      if (
        disposed ||
        polling
      ) {
        return
      }

      polling = true

      try {
        const next =
          await fetchNetworkStats()

        if (
          disposed ||
          !next
        ) {
          return
        }

        setSnapshot(
          next,
        )

        setHistory(
          (current) => [
            ...current,
            {
              download:
                next.downloadMbps,
              upload:
                next.uploadMbps,
            },
          ].slice(
            -HISTORY_LENGTH,
          ),
        )
      } finally {
        polling = false
      }
    }

    window.addEventListener(
      'online',
      updateOnline,
    )
    window.addEventListener(
      'offline',
      updateOnline,
    )

    void poll()

    const interval =
      window.setInterval(
        () => {
          void poll()
        },
        1000,
      )

    return () => {
      disposed = true
      window.clearInterval(
        interval,
      )
      window.removeEventListener(
        'online',
        updateOnline,
      )
      window.removeEventListener(
        'offline',
        updateOnline,
      )
    }
  }, [])

  const chart = useMemo(() => {
    const downloads =
      history.map(
        (point) =>
          point.download,
      )

    const uploads =
      history.map(
        (point) =>
          point.upload,
      )

    const maxValue =
      Math.max(
        0.1,
        ...downloads,
        ...uploads,
      )

    return {
      download:
        chartPoints(
          downloads,
          maxValue,
        ),
      upload:
        chartPoints(
          uploads,
          maxValue,
        ),
    }
  }, [history])

  const available =
    Boolean(
      snapshot?.available,
    )

  return (
    <div
      className={
        styles.networkNative
      }
    >
      <div
        className={
          styles.networkTop
        }
      >
        <div
          className={
            styles.networkStatus
          }
          data-online={
            online
          }
        >
          <span
            className={
              styles.networkDot
            }
          />

          <strong>
            {online
              ? copy.online
              : copy.offline}
          </strong>
        </div>

        {snapshot?.interfaceName && (
          <div
            className={
              styles.networkAdapter
            }
            title={
              snapshot.interfaceName
            }
          >
            <span>
              {
                snapshot.connectionType
              }
            </span>

            <small>
              {
                snapshot.interfaceName
              }
            </small>
          </div>
        )}
      </div>

      {!snapshot ? (
        <p
          className={
            styles.widgetHint
          }
        >
          {copy.measuring}
        </p>
      ) : !available ? (
        <p
          className={
            styles.widgetHint
          }
        >
          {copy.unavailable}
        </p>
      ) : (
        <>
          <div
            className={
              styles.networkUsageLabel
            }
          >
            {copy.usage}
          </div>

          <div
            className={
              styles.networkSpeeds
            }
          >
            <div
              className={
                styles.networkSpeedCard
              }
            >
              <span
                className={
                  styles.networkSpeedHeader
                }
              >
                <b
                  className={
                    styles.networkArrowDown
                  }
                >
                  ↓
                </b>
                {copy.download}
              </span>

              <div>
                <strong>
                  {formatMbps(
                    snapshot.downloadMbps,
                  )}
                </strong>
                <small>
                  Mbps
                </small>
              </div>
            </div>

            <div
              className={
                styles.networkSpeedCard
              }
            >
              <span
                className={
                  styles.networkSpeedHeader
                }
              >
                <b
                  className={
                    styles.networkArrowUp
                  }
                >
                  ↑
                </b>
                {copy.upload}
              </span>

              <div>
                <strong>
                  {formatMbps(
                    snapshot.uploadMbps,
                  )}
                </strong>
                <small>
                  Mbps
                </small>
              </div>
            </div>
          </div>

          <div
            className={
              styles.networkChart
            }
            aria-label={
              copy.liveTraffic
            }
          >
            <svg
              viewBox="0 0 100 34"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="33"
                x2="100"
                y2="33"
                className={
                  styles.networkChartBaseline
                }
              />

              {chart.download && (
                <polyline
                  points={
                    chart.download
                  }
                  className={
                    styles.networkDownloadLine
                  }
                />
              )}

              {chart.upload && (
                <polyline
                  points={
                    chart.upload
                  }
                  className={
                    styles.networkUploadLine
                  }
                />
              )}
            </svg>
          </div>

          <div
            className={
              styles.networkLegend
            }
          >
            <span>
              <i
                className={
                  styles.networkLegendDownload
                }
              />
              {copy.download}
            </span>

            <span>
              <i
                className={
                  styles.networkLegendUpload
                }
              />
              {copy.upload}
            </span>

            <small>
              {
                copy.liveTraffic
              }
            </small>
          </div>
        </>
      )}
    </div>
  )
}
