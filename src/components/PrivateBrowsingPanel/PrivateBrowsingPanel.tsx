import { useEffect, useRef, useState } from 'react'
import type { BrowserTab } from '../../core/browserTab'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { PRIVATE_BROWSING_COPY } from './privateBrowsingCopy'
import styles from './PrivateBrowsingPanel.module.css'

interface Props {
  tabs: BrowserTab[]
  top: number
  onClose: () => void
  onEnd: () => void
}

export function PrivateBrowsingPanel({ tabs, top, onClose, onEnd }: Props) {
  const { locale, t } = useLocale()
  const copy = PRIVATE_BROWSING_COPY[locale]
  const panelRef = useRef<HTMLElement>(null)
  const [resolvedTop, setResolvedTop] = useState(12)
  useDialogFocusTrap({ active: true, containerRef: panelRef, onEscape: onClose })

  useEffect(() => {
    const position = () => setResolvedTop(Math.max(12, Math.min(top, window.innerHeight - 420)))
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [top])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-nebula-private-toggle]')) return
      if (target instanceof Node && !panelRef.current?.contains(target)) onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <section id="nebula-private-panel" ref={panelRef} className={styles.panel}
      style={{ top: resolvedTop, maxHeight: `calc(100dvh - ${resolvedTop + 12}px)` }}
      role="dialog" aria-modal="true" aria-labelledby="nebula-private-title" tabIndex={-1}>
      <header className={styles.header}>
        <h2 id="nebula-private-title">{copy.title}</h2>
        <button type="button" onClick={onClose} aria-label={t('close')} className={styles.close}>×</button>
      </header>
      <div className={styles.content}>
        <h3 className={styles.tabsTitle}>{copy.tabs} <span>{tabs.length}</span></h3>
        {tabs.length === 0 ? <p>{copy.empty}</p> : (
          <ul className={styles.tabs}>
            {tabs.map((tab) => <li key={tab.shortcutId} title={tab.url}>
              <span aria-hidden="true">◈</span><span>{tab.title || tab.url}</span>
            </li>)}
          </ul>
        )}
        <ul className={styles.protections}>
          <li>{copy.history}</li><li>{copy.notifications}</li><li>{copy.cookies}</li>
        </ul>
        <p>{copy.retained}</p>
        <p>{copy.visibility}</p>
      </div>
      <footer className={styles.footer}>
        <p>{copy.scope}</p>
        <button type="button" onClick={onEnd} className={styles.end}>{copy.end}</button>
      </footer>
    </section>
  )
}
