import { useCallback, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import styles from './PopupChromeApp.module.css'

export function PopupChromeApp() {
  const popupWindow = getCurrentWindow()

  const startDragging = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('button')) return
      void popupWindow.startDragging()
    },
    [popupWindow],
  )

  const close = useCallback(() => {
    void popupWindow.close()
  }, [popupWindow])

  return (
    <div
      className={styles.titlebar}
      onMouseDown={startDragging}
      role="toolbar"
      aria-label="Popup window controls"
    >
      <div
        className={styles.dragArea}
        data-tauri-drag-region
        aria-hidden="true"
      />
      <button
        className={`${styles.controlButton} ${styles.closeButton}`}
        type="button"
        aria-label="Close"
        title="Close"
        onClick={close}
      >
        <span className={styles.closeIcon} aria-hidden="true" />
      </button>
    </div>
  )
}
