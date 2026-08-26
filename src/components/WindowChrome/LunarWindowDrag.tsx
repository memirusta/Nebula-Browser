import type { MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../../platform/runtime'
import { useLocale } from '../../hooks/useLocale'
import {
  isWindowInteractionLocked,
  toggleWindowMaximize,
} from '../../platform/windowMaximize'

interface LunarWindowDragProps {
  className?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onClick?: () => void
}

/** Drag handle on the semi-lunar cap — subtle tint, not a full-width bar. */
export function LunarWindowDrag({
  className,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: LunarWindowDragProps) {
  const { t } = useLocale()

  if (!isTauri) return null

  const appWindow = getCurrentWindow()

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()

    void (async () => {
      // The Chrome WebView cannot infer custom F11/site fullscreen from Tauri's
      // isMaximized/isFullscreen flags. Ask the Rust window owner instead.
      if (await isWindowInteractionLocked()) return
      await appWindow.startDragging()
    })().catch(() => undefined)
  }

  const onDoubleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    void toggleWindowMaximize()
  }

  return (
    <div
      className={className}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      title={t('windowDragHint')}
      aria-label={t('windowDragAria')}
    />
  )
}
