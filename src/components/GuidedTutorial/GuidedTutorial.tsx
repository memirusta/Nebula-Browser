import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { NebulaLocale } from '../../core/locale'
import { computeViewportLunarSize } from '../../core/lunarSizing'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { getTutorialCopy, type TutorialTargetId } from '../../core/tutorial'
import { clipTutorialTarget, tutorialAvoidArea, tutorialCardPosition, tutorialCardsFit, tutorialStatementCard, tutorialStepIndex, TUTORIAL_BUBBLE_WIDTH, type TutorialRect } from '../../core/tutorialLayout'
import styles from './GuidedTutorial.module.css'

interface GuidedTutorialProps {
  open: boolean
  locale: NebulaLocale
  step: number
  lunarWidthPx: number
  lunarHeightPx: number
  onStepChange: (step: number) => void
  /** The first step's menu is open because its button was pressed (an alternative to hovering the top edge). */
  menuShown?: boolean
  onToggleMenu?: () => void
  /** The opening scene of the first tour: a dark screen with one sentence instead of the bubble (see tutorialMode.ts). */
  intro?: 'waiting' | 'opening' | null
  onSkip: () => void
  onComplete: () => void
}

const BUBBLE_WIDTH = TUTORIAL_BUBBLE_WIDTH

function StepIcon({ target }: { target: TutorialTargetId }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {target === 'top-edge' && <><path d="M3 5h18M12 20V10m-4 4 4-4 4 4" /><path d="M6 5a6 6 0 0 0 12 0" opacity=".45" /></>}
    {target === 'semi-lunar' && <><path d="M2 5c0 9 20 9 20 0H2Z" /><rect x="5" y="15" width="5" height="5" rx="1.5" /><rect x="14" y="15" width="5" height="5" rx="1.5" /></>}
    {target === 'home-search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {target === 'home-toolbar' && <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>}
    {target === 'home-widgets' && <><rect x="3" y="4" width="8" height="7" rx="2" /><rect x="3" y="14" width="8" height="6" rx="2" /><path d="M16 8v8M12.5 12h7" /></>}
    {target === 'shield' && <path d="M12 3 5 6v5c0 4.5 2.9 8.2 7 10 4.1-1.8 7-5.5 7-10V6l-7-3Zm-3 9 2.2 2.2L15.5 10" />}
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

type PlacedCard = { index: number; card: ReturnType<typeof tutorialCardPosition> }

/** The steps after the first are on the screen together, each by what it is about; the first is always alone. */
function stepsOnScreen(step: number, count: number): number[] {
  return step >= 1 ? Array.from({ length: count - 1 }, (_, index) => index + 1) : [step]
}

export function GuidedTutorial({ open, locale, step, lunarWidthPx, lunarHeightPx, onStepChange, menuShown = false, onToggleMenu, intro = null, onSkip, onComplete }: GuidedTutorialProps) {
  const copy = getTutorialCopy(locale)
  const safeStep = tutorialStepIndex(step, copy.steps.length)
  const current = copy.steps[safeStep]
  const finish = safeStep === copy.steps.length - 1
  const cardRef = useRef<HTMLElement | null>(null)
  const bubbleRefs = useRef<(HTMLElement | null)[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const introButtonRef = useRef<HTMLButtonElement>(null)
  const [layout, setLayout] = useState(() => ({
    spotlight: null as TutorialRect | null,
    cards: [] as PlacedCard[],
    together: false,
    /** Where a finger presses (the gear of Settings), for the step that says to press it. */
    tap: null as { x: number; y: number } | null,
  }))

  useDialogFocusTrap({ active: open, containerRef: cardRef, initialFocusRef: intro ? introButtonRef : nextRef, onEscape: onSkip })

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const lunar = computeViewportLunarSize(viewport.width, viewport.height, lunarWidthPx, lunarHeightPx)
      const place = (index: number) => {
        const target = copy.steps[index].target
        const rect = targetRect(target, lunar.width, lunar.height)
        const measured = bubbleRefs.current[index]?.offsetHeight ?? 300
        let card = tutorialCardPosition(rect, viewport, measured,
          target === 'top-edge' || target === 'semi-lunar' ? lunar.height : 0, BUBBLE_WIDTH,
          target === 'home-search' ? { prefer: 'below' } : {})
        // The statement about the shield points at nothing: it sits low and in the middle, out of the way of the others.
        if (target === 'shield') card = tutorialStatementCard(card, viewport, measured)
        return { index, rect, card }
      }
      const placed = stepsOnScreen(safeStep, copy.steps.length).map(place)
      // Where the bubbles would land on one another (a narrow window), only the current one is shown.
      const together = placed.length > 1 && tutorialCardsFit(placed.map(({ card, index }) => ({
        left: card.left, top: card.top, width: card.width,
        // Judged by the height of a lit bubble for all of them, so that going on never changes whether they fit.
        height: Math.min(Math.max(bubbleRefs.current[index]?.offsetHeight ?? 0, 270), card.maxHeight),
        avoid: placed.filter((other) => other.index !== index && other.rect).map((other) =>
          tutorialAvoidArea(other.rect as TutorialRect, copy.steps[other.index].target === 'semi-lunar')),
      })))
      const shown = together ? placed : placed.filter(({ index }) => index === safeStep)
      const gear = copy.steps[safeStep].target === 'home-toolbar'
        ? document.querySelector<HTMLElement>('[data-nebula-tutorial="home-settings"]')?.getBoundingClientRect()
        : undefined
      const next = {
        spotlight: (placed.find(({ index }) => index === safeStep) ?? place(safeStep)).rect,
        cards: shown.map(({ index, card }) => ({ index, card })),
        together,
        tap: gear && gear.width > 0 ? { x: gear.left + gear.width / 2, y: gear.top + gear.height / 2 } : null,
      }
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    update()
    const observer = new ResizeObserver(update)
    for (const element of bubbleRefs.current) if (element) observer.observe(element)
    for (const index of stepsOnScreen(safeStep, copy.steps.length)) {
      const target = document.querySelector('[data-nebula-tutorial="' + copy.steps[index].target + '"]')
      if (target) observer.observe(target)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, safeStep, intro, copy.steps, locale, lunarHeightPx, lunarWidthPx])

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = 0
    if (open && cardRef.current) cardRef.current.scrollTop = 0
  }, [open, safeStep])

  // The buttons live in the bubble of the current step, so going on gives them to the next bubble: focus follows, as soon as the
  // bubble is placed (a bubble that is not placed yet cannot take focus). A modal dialog never leaves focus outside itself.
  useEffect(() => {
    if (!open || intro === 'opening' || cardRef.current?.contains(document.activeElement)) return
    ;(intro ? introButtonRef : nextRef).current?.focus()
  }, [open, intro, safeStep, layout])

  if (!open) return null
  const { spotlight } = layout
  const practice = current.target === 'top-edge' || current.target === 'semi-lunar'
  const advance = () => finish ? onComplete() : onStepChange(safeStep + 1)
  const spotlightStyle = spotlight ? {
    left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height,
    borderRadius: spotlight.radius,
  } : undefined
  const onScreen = intro ? [] : stepsOnScreen(safeStep, copy.steps.length)

  // The screen is dimmed except for what the step is about. The bubbles of the other steps stay on it, dimmed with the rest,
  // and going on lights the next one. The first two steps are practice (the real menu has to open), so the pointer goes
  // through everything.
  return createPortal(
    <div className={[styles.overlay, practice ? styles.practiceOverlay : ''].join(' ')} data-intro={intro ?? undefined}>
      {/* Everything but the target is dimmed: the spotlight casts the dimming around itself; with no target the whole screen is. */}
      {/* The menu is a webview above the window and lights itself: a hole and a ring around it would only be drawn behind it. */}
      {spotlight && current.target !== 'semi-lunar'
        ? <div className={styles.spotlight} data-target={current.target} style={spotlightStyle} aria-hidden="true" />
        : <div className={styles.veil} aria-hidden="true" />}
      {layout.tap && !intro && (
        <div className={styles.tap} style={{ left: layout.tap.x, top: layout.tap.y }} aria-hidden="true">
          <span className={styles.tapDot} />
        </div>
      )}
      {intro ? (
        <section ref={cardRef} className={styles.intro} data-state={intro} role="dialog" aria-modal="true"
          aria-label={copy.introPrompt} tabIndex={-1}>
          <svg className={styles.introArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20V5m-6 6 6-6 6 6" />
          </svg>
          <p>{copy.introPrompt}</p>
          <div className={styles.introActions}>
            <button ref={introButtonRef} type="button" className={styles.showButton} onClick={onToggleMenu}>{copy.showMenu}</button>
            <button type="button" className={styles.skipButton} onClick={onSkip}>{copy.skipAll}<span aria-hidden="true">×</span></button>
          </div>
        </section>
      ) : onScreen.map((index) => {
        const item = copy.steps[index]
        const placed = layout.cards.find((entry) => entry.index === index)
        const active = index === safeStep
        // Until it is placed it is only measured; a bubble that does not fit beside the others is not shown at all.
        if (!placed && !active) return null
        const card = placed?.card
        const style = (card
          ? { left: card.left, top: card.top, width: card.width, maxHeight: card.maxHeight, '--pointer': card.arrow + 'px' }
          : { left: 0, top: 0, width: BUBBLE_WIDTH, visibility: 'hidden' }) as CSSProperties
        const ref = (element: HTMLElement | null) => {
          bubbleRefs.current[index] = element
          if (active) cardRef.current = element
        }
        if (!active) {
          return (
            <section key={item.target} ref={ref} className={styles.bubble} style={style} data-side={card?.side}
              data-active="false" aria-hidden="true">
              <div className={styles.body}>
                <span className={styles.eyebrow}>{item.eyebrow}</span>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
              </div>
            </section>
          )
        }
        return (
          <section key={item.target} ref={ref} className={styles.bubble} style={style} data-side={card?.side}
            data-active="true" data-compact={(card?.maxHeight ?? 999) < 260 || undefined}
            role="dialog" aria-modal="true" aria-labelledby="nebula-guided-tutorial-title"
            aria-describedby="nebula-guided-tutorial-body" tabIndex={-1} data-tutorial-step={safeStep}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
              if (event.key === 'ArrowLeft' && safeStep > 0) { event.preventDefault(); onStepChange(safeStep - 1) }
              if (event.key === 'ArrowRight' && !event.repeat) { event.preventDefault(); advance() }
            }}>
            <header className={styles.header}>
              <span className={styles.progress}>{copy.progress} {safeStep + 1} / {copy.steps.length}</span>
              <button type="button" className={styles.skipButton} onClick={onSkip}>{copy.skipAll}<span aria-hidden="true">×</span></button>
            </header>
            <div ref={bodyRef} className={styles.body}>
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
                {current.target === 'top-edge' && onToggleMenu && (
                  <button type="button" className={styles.showButton} aria-pressed={menuShown} onClick={onToggleMenu}>{copy.showMenu}</button>
                )}
              </div>
            </div>
            <footer className={styles.footer}>
              <button type="button" className={styles.backButton} disabled={safeStep === 0} onClick={() => onStepChange(safeStep - 1)}>
                <span aria-hidden="true">←</span>{copy.previous}
              </button>
              <nav className={styles.dots} aria-label={copy.progress}>
                {copy.steps.map((dot, dotIndex) => <button key={dot.target} type="button"
                  aria-label={copy.progress + ' ' + (dotIndex + 1) + ': ' + dot.eyebrow}
                  aria-current={dotIndex === safeStep ? 'step' : undefined} onClick={() => onStepChange(dotIndex)} />)}
              </nav>
              <button ref={nextRef} type="button" className={styles.nextButton} onClick={advance}>
                {finish ? copy.finish : copy.next}<span aria-hidden="true">{finish ? '✓' : '→'}</span>
              </button>
            </footer>
          </section>
        )
      })}
    </div>, document.body,
  )
}
