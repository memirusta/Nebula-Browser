import { useEffect, useState, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../../platform/runtime'
import { useLocale } from '../../hooks/useLocale'
import styles from './TitleBar.module.css'

export function TitleBar() {
  const { t } = useLocale()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri) return

    document.documentElement.dataset.nebulaTitlebar = 'true'

    const appWindow = getCurrentWindow()
    let disposed = false
    let unlistenResize: (() => void) | undefined

    const syncMaximized = async () => {
      if (disposed) return
      setMaximized(await appWindow.isMaximized())
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
      delete document.documentElement.dataset.nebulaTitlebar
    }
  }, [])

  if (!isTauri) {
    return null
  }

  const appWindow = getCurrentWindow()

  const onDragMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    void appWindow.startDragging()
  }

  const onMinimize = (event: MouseEvent) => {
    event.stopPropagation()
    void appWindow.minimize()
  }

  const onToggleMaximize = (event: MouseEvent) => {
    event.stopPropagation()
    void appWindow.toggleMaximize()
  }

  const onClose = (event: MouseEvent) => {
    event.stopPropagation()
    void appWindow.close()
  }

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.brandDot} aria-hidden="true" />
        <span>Nebula</span>
      </div>

      <div className={styles.drag} onMouseDown={onDragMouseDown} aria-hidden="true" />

      <div className={styles.controls} onMouseDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={styles.control}
          onMouseDown={onMinimize}
          aria-label={t('titleMinimize')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={[styles.control, styles.controlMax].join(' ')}
          onMouseDown={onToggleMaximize}
          aria-label={maximized ? t('titleRestore') : t('titleMaximize')}
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
          className={[styles.control, styles.controlClose].join(' ')}
          onMouseDown={onClose}
          aria-label={t('titleClose')}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path
              stroke="currentColor"
              strokeWidth="1.2"
              d="M2 2l6 6M8 2L2 8"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
