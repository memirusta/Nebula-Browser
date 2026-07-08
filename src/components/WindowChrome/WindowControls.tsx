import { useEffect, useState, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../../platform/runtime'
import { useLocale } from '../../hooks/useLocale'
import {
  isMonitorCoverMaximized,
  toggleMonitorCoverMaximize,
} from '../../platform/windowMonitorCover'

interface WindowControlsProps {
  buttonClassName: string
}

export function WindowControls({ buttonClassName }: WindowControlsProps) {
  const { t } = useLocale()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri) return

    const appWindow = getCurrentWindow()
    let disposed = false
    let unlistenResize: (() => void) | undefined

    const syncMaximized = async () => {
      if (disposed) return
      setMaximized(await isMonitorCoverMaximized())
    }

    void syncMaximized()
    void appWindow.onResized(() => {
      void syncMaximized()
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      unlistenResize = unlisten
    })

    return () => {
      disposed = true
      unlistenResize?.()
    }
  }, [])

  if (!isTauri) return null

  const appWindow = getCurrentWindow()

  const stop = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onMouseDown={(event) => {
          stop(event)
          void appWindow.minimize()
        }}
        aria-label={t('titleMinimize')}
        title={t('titleMinimize')}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={buttonClassName}
        onMouseDown={(event) => {
          stop(event)
          void toggleMonitorCoverMaximize().then(setMaximized)
        }}
        aria-label={maximized ? t('titleRestore') : t('titleMaximize')}
        title={maximized ? t('titleRestore') : t('titleMaximize')}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              d="M2.5 3.5h4v4H2.5z M3.5 2.5h4v4H3.5z"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="1.5"
              y="1.5"
              width="7"
              height="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={buttonClassName}
        onMouseDown={(event) => {
          stop(event)
          void appWindow.close()
        }}
        aria-label={t('titleClose')}
        title={t('titleClose')}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path
            stroke="currentColor"
            strokeWidth="1.2"
            d="M2 2l6 6M8 2L2 8"
          />
        </svg>
      </button>
    </>
  )
}
