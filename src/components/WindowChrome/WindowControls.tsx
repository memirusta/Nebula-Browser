import { useEffect, useState, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../../platform/runtime'
import { useLocale } from '../../hooks/useLocale'
import {
  getWindowPresentationState,
  toggleWindowMaximize,
  type WindowPresentationState,
} from '../../platform/windowMaximize'

interface WindowControlsProps {
  buttonClassName: string
}

const DEFAULT_PRESENTATION: WindowPresentationState = {
  browserFullscreen: false,
  siteFullscreen: false,
  maximized: false,
  focused: false,
}

export function WindowControls({ buttonClassName }: WindowControlsProps) {
  const { t } = useLocale()
  const [presentation, setPresentation] =
    useState<WindowPresentationState>(DEFAULT_PRESENTATION)

  useEffect(() => {
    if (!isTauri) return

    const appWindow = getCurrentWindow()
    let disposed = false
    let unlistenResize: (() => void) | undefined
    let unlistenFocus: (() => void) | undefined

    const syncPresentation = async () => {
      const next = await getWindowPresentationState()
      if (!disposed) setPresentation(next)
    }

    void syncPresentation()
    void appWindow.onResized(() => {
      void syncPresentation()
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      unlistenResize = unlisten
    })
    void appWindow.onFocusChanged(() => {
      void syncPresentation()
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      unlistenFocus = unlisten
    })

    return () => {
      disposed = true
      unlistenResize?.()
      unlistenFocus?.()
    }
  }, [])

  if (!isTauri) return null

  const appWindow = getCurrentWindow()
  const maximizeLocked =
    presentation.browserFullscreen || presentation.siteFullscreen

  const stop = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }

  const stopDrag = (event: MouseEvent) => {
    event.stopPropagation()
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onMouseDown={stopDrag}
        onClick={(event) => {
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
        onMouseDown={stopDrag}
        aria-disabled={maximizeLocked}
        onClick={(event) => {
          stop(event)
          void toggleWindowMaximize().then(() =>
            getWindowPresentationState().then(setPresentation),
          )
        }}
        aria-label={presentation.maximized ? t('titleRestore') : t('titleMaximize')}
        title={presentation.maximized ? t('titleRestore') : t('titleMaximize')}
      >
        {presentation.maximized ? (
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
        onMouseDown={stopDrag}
        onClick={(event) => {
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
