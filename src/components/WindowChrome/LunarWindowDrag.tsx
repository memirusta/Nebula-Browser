import type { MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '../../platform/runtime'
import { useLocale } from '../../hooks/useLocale'

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
    void appWindow.startDragging()
  }

  const onDoubleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    void appWindow.toggleMaximize()
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
