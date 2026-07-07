import type { ReactNode } from 'react'
import type { ModuleOffset } from '../../core/homeLayout'
import styles from './ModuleOffsetWrap.module.css'

interface ModuleOffsetWrapProps {
  offset: ModuleOffset
  children: ReactNode
}

export function ModuleOffsetWrap({ offset, children }: ModuleOffsetWrapProps) {
  if (offset.x === 0 && offset.y === 0) {
    return <>{children}</>
  }

  return (
    <div
      className={styles.wrap}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {children}
    </div>
  )
}
