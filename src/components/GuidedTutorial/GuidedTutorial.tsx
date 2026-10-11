import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NebulaLocale } from '../../core/locale'
import { computeViewportLunarSize } from '../../core/lunarSizing'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { getTutorialCopy, type TutorialTargetId } from '../../core/tutorial'
import { clipTutorialTarget, tutorialCardPosition, tutorialStepIndex, type TutorialRect } from '../../core/tutorialLayout'
import styles from './GuidedTutorial.module.css'

interface GuidedTutorialProps {
  open: boolean
  locale: NebulaLocale
  step: number
  lunarWidthPx: number
  lunarHeightPx: number
  onStepChange: (step: number) => void
  onSkip: () => void
  onComplete: () => void
}

function StepIcon({ target }: { target: TutorialTargetId }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {target === 'top-edge' && <><path d="M3 5h18M12 20V10m-4 4 4-4 4 4" /><path d="M6 5a6 6 0 0 0 12 0" opacity=".45" /></>}
    {target === 'semi-lunar' && <><path d="M2 5c0 9 20 9 20 0H2Z" /><rect x="5" y="15" width="5" height="5" rx="1.5" /><rect x="14" y="15" width="5" height="5" rx="1.5" /></>}
    {target === 'home-search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {target === 'home-toolbar' && <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>}
  </svg>
}

function targetRect(target: TutorialTargetId, lunarWidth: number, lunarHeight: number): TutorialRect | null {
  const width = window.innerWidth
  const height = window.innerHeight
  if (target === 'top-edge' || target === 'semi-lunar') {
    const targetWidth = Math.min(width, lunarWidth)
    return clipTutorialTarget({
      left: (width - targetWidth) / 2, top: 0, width: targetWidth,
      height: target === 'top-edge' ? 28 : lunarHeight, radius: target === 'top-edge' ? 12 : 60,
    }, width, height)
  }
  const element = document.querySelector<HTMLElement>('[data-nebula-tutorial="' + target + '"]')
  if (!element || element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden') return null
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return clipTutorialTarget({
    left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16,
    radius: Math.min(26, rect.height / 2 + 8),
  }, width, height)
}

export function GuidedTutorial({ open, locale, step, lunarWidthPx, lunarHeightPx, onStepChange, onSkip, onComplete }: GuidedTutorialProps) {
  const copy = getTutorialCopy(locale)
  const safeStep = tutorialStepIndex(step, copy.steps.length)
  const current = copy.steps[safeStep]
  const finish = safeStep === copy.steps.length - 1
  const cardRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [layout, setLayout] = useState(() => ({
    spotlight: null as TutorialRect | null,
    card: tutorialCardPosition(null, { width: window.innerWidth, height: window.innerHeight }, 350),
  }))

  useDialogFocusTrap({ active: open, containerRef: cardRef, initialFocusRef: nextRef, onEscape: onSkip })

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const lunar = computeViewportLunarSize(window.innerWidth, window.innerHeight, lunarWidthPx, lunarHeightPx)
      const spotlight = targetRect(current.target, lunar.width, lunar.height)
      const card = tutorialCardPosition(spotlight, { width: window.innerWidth, height: window.innerHeight },
        cardRef.current?.offsetHeight ?? 350,
        current.target === 'top-edge' || current.target === 'semi-lunar' ? lunar.height : 0)
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify({ spotlight, card }) ? previous : { spotlight, card })
    }
    update()
    const observer = new ResizeObserver(update)
    if (cardRef.current) observer.observe(cardRef.current)
    const target = document.querySelector('[data-nebula-tutorial="' + current.target + '"]')
    if (target) observer.observe(target)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, current.target, locale, lunarHeightPx, lunarWidthPx])

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = 0
    if (open && cardRef.current) cardRef.current.scrollTop = 0
  }, [open, safeStep])

  if (!open) return null
  const { spotlight, card } = layout
  const practice = current.target === 'top-edge' || current.target === 'semi-lunar'
  const advance = () => finish ? onComplete() : onStepChange(safeStep + 1)
  const spotlightStyle = spotlight ? {
    left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height,
    borderRadius: spotlight.radius,
  } : undefined

  return createPortal(
    <div className={[styles.overlay, practice ? styles.practiceOverlay : ''].join(' ')}>
      {spotlight
        ? <div className={styles.spotlight} data-target={current.target} style={spotlightStyle} aria-hidden="true" />
        : <div className={styles.scrim} aria-hidden="true" />}
      <section ref={cardRef} className={styles.card} style={card} data-compact={card.maxHeight < 300 || undefined}
        role="dialog" aria-modal="true" aria-labelledby="nebula-guided-tutorial-title"
        aria-describedby="nebula-guided-tutorial-body" tabIndex={-1} data-tutorial-step={safeStep}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
          if (event.key === 'ArrowLeft' && safeStep > 0) { event.preventDefault(); onStepChange(safeStep - 1) }
          if (event.key === 'ArrowRight' && !event.repeat) { event.preventDefault(); advance() }
        }}>
        <header className={styles.header}>
          <span className={styles.brand}>{copy.categoryLabel}</span>
          <button type="button" className={styles.skipButton} onClick={onSkip}>{copy.skipAll}<span aria-hidden="true">×</span></button>
        </header>
        <nav className={styles.steps} aria-label={copy.progress}>
          {copy.steps.map((item, index) => <button key={item.target} type="button"
            aria-label={copy.progress + ' ' + (index + 1) + ': ' + item.eyebrow}
            aria-current={index === safeStep ? 'step' : undefined} onClick={() => onStepChange(index)}>
            <span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span>
            <span>{item.eyebrow}</span>
          </button>)}
        </nav>
        <div ref={bodyRef} className={styles.body}>
          <div className={styles.stepHeading}>
            <span className={styles.progress}>{copy.progress} {safeStep + 1} / {copy.steps.length}</span>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <h2 id="nebula-guided-tutorial-title">{current.title}</h2>
            <p id="nebula-guided-tutorial-body">{current.body}</p>
          </div>
          <div className={styles.actionHint}>
            {current.target === 'home-search'
              ? <StepIcon target="semi-lunar" />
              : <StepIcon target={current.target} />}
            <span>{current.action}</span>
            {current.target === 'home-search' && <kbd>Ctrl + L</kbd>}
          </div>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.backButton} disabled={safeStep === 0} onClick={() => onStepChange(safeStep - 1)}>
            <span aria-hidden="true">←</span>{copy.previous}
          </button>
          <button ref={nextRef} type="button" className={styles.nextButton} onClick={advance}>
            {finish ? copy.finish : copy.next}<span aria-hidden="true">{finish ? '✓' : '→'}</span>
          </button>
        </footer>
      </section>
    </div>, document.body,
  )
}
