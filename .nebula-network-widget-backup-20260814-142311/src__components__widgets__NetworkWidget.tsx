import { useEffect, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

type NavigatorConnection = {
  effectiveType?: string
  downlink?: number
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function getConnection(): NavigatorConnection | undefined {
  return (navigator as Navigator & { connection?: NavigatorConnection }).connection
}

export function NetworkWidget() {
  const { t } = useLocale()
  const [, refresh] = useState(0)

  useEffect(() => {
    const update = () => refresh((value) => value + 1)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const connection = getConnection()
    connection?.addEventListener?.('change', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      connection?.removeEventListener?.('change', update)
    }
  }, [])

  const connection = getConnection()
  return (
    <div className={styles.network}>
      <div className={styles.networkStatus} data-online={navigator.onLine}>
        <span className={styles.networkDot} />
        <strong>{navigator.onLine ? t('networkOnline') : t('networkOffline')}</strong>
      </div>
      {connection ? (
        <div className={styles.networkRows}>
          <div><span>{t('networkConnection')}</span><b>{connection.effectiveType?.toUpperCase() ?? '—'}</b></div>
          <div><span>{t('networkDownlink')}</span><b>{typeof connection.downlink === 'number' ? `${connection.downlink} Mbps` : '—'}</b></div>
        </div>
      ) : (
        <p className={styles.widgetHint}>{t('networkUnavailable')}</p>
      )}
    </div>
  )
}
