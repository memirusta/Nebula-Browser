import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { NebulaLocale } from '../../core/locale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import {
  getTutorialCopy,
  type TutorialTargetId,
} from '../../core/tutorial'
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

interface SpotlightRect {
  left: number
  top: number
  width: number
  height: number
  radius: number
}

type CardPlacement = 'above' | 'below' | 'left'

const VIEWPORT_MARGIN = 18
const TARGET_PADDING = 9
const CARD_GAP = 22
const CARD_HEIGHT_ESTIMATE = 286
const CARD_MAX_WIDTH = 390

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function fallbackTargetRect(target: TutorialTargetId): SpotlightRect {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  if (target === 'home-toolbar') {
    return {
      left: Math.max(VIEWPORT_MARGIN, viewportWidth - 78),
      top: 20,
      width: 60,
      height: Math.min(224, viewportHeight - 40),
      radius: 30,
    }
  }

  return {
    left: Math.max(VIEWPORT_MARGIN, (viewportWidth - Math.min(540, viewportWidth - 36)) / 2),
    top: Math.max(80, viewportHeight / 2 - 42),
    width: Math.min(540, viewportWidth - 36),
    height: 84,
    radius: 42,
  }
}

function elementTargetRect(target: TutorialTargetId): SpotlightRect | null {
  const element = document.querySelector<HTMLElement>(
    `[data-nebula-tutorial="${target}"]`,
  )
  if (!element) return null

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  return {
    left: Math.max(0, rect.left - TARGET_PADDING),
    top: Math.max(0, rect.top - TARGET_PADDING),
    width: Math.min(window.innerWidth, rect.width + TARGET_PADDING * 2),
    height: Math.min(window.innerHeight, rect.height + TARGET_PADDING * 2),
    radius: Math.min(34, rect.height / 2 + TARGET_PADDING),
  }
}

function resolveTargetRect(
  target: TutorialTargetId,
  lunarWidthPx: number,
  lunarHeightPx: number,
): SpotlightRect {
  const viewportWidth = window.innerWidth

  if (target === 'top-edge') {
    const width = Math.min(viewportWidth - 24, lunarWidthPx + 32)
    return {
      left: (viewportWidth - width) / 2,
      top: 0,
      width,
      height: 28,
      radius: 18,
    }
  }

  if (target === 'semi-lunar') {
    const width = Math.min(viewportWidth - 24, lunarWidthPx + 32)
    return {
      left: (viewportWidth - width) / 2,
      top: 0,
      width,
      height: Math.min(window.innerHeight * 0.42, lunarHeightPx + 18),
      radius: Math.min(96, lunarHeightPx * 0.62),
    }
  }

  return elementTargetRect(target) ?? fallbackTargetRect(target)
}

function cardPosition(
  rect: SpotlightRect,
  target: TutorialTargetId,
  lunarHeightPx: number,
): {
  left: number
  top: number
  width: number
  placement: CardPlacement
} {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(CARD_MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2)

  if (target === 'home-toolbar' && rect.left > width + CARD_GAP + VIEWPORT_MARGIN) {
    return {
      left: rect.left - width - CARD_GAP,
      top: clamp(
        rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2,
        VIEWPORT_MARGIN,
        viewportHeight - CARD_HEIGHT_ESTIMATE - VIEWPORT_MARGIN,
      ),
      width,
      placement: 'left',
    }
  }

  const placementRect = target === 'top-edge'
    ? {
        ...rect,
        height: Math.max(
          rect.height,
          Math.min(viewportHeight * 0.42, lunarHeightPx + 18),
        ),
      }
    : rect

  const centeredLeft = clamp(
    placementRect.left + placementRect.width / 2 - width / 2,
    VIEWPORT_MARGIN,
    viewportWidth - width - VIEWPORT_MARGIN,
  )
  const roomBelow = viewportHeight - placementRect.top - placementRect.height

  if (roomBelow >= CARD_HEIGHT_ESTIMATE + CARD_GAP) {
    return {
      left: centeredLeft,
      top: placementRect.top + placementRect.height + CARD_GAP,
      width,
      placement: 'below',
    }
  }

  return {
    left: centeredLeft,
    top: Math.max(
      VIEWPORT_MARGIN,
      placementRect.top - CARD_HEIGHT_ESTIMATE - CARD_GAP,
    ),
    width,
    placement: 'above',
  }
}

export function GuidedTutorial({
  open,
  locale,
  step,
  lunarWidthPx,
  lunarHeightPx,
  onStepChange,
  onSkip,
  onComplete,
}: GuidedTutorialProps) {
  const copy = getTutorialCopy(locale)
  const safeStep = clamp(step, 0, copy.steps.length - 1)
  const current = copy.steps[safeStep]
  const cardRef = useRef<HTMLElement>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const [spotlight, setSpotlight] = useState<SpotlightRect>(() =>
    resolveTargetRect(current.target, lunarWidthPx, lunarHeightPx),
  )

  useDialogFocusTrap({
    active: open,
    containerRef: cardRef,
    initialFocusRef: nextButtonRef,
    onEscape: onSkip,
  })

  useEffect(() => {
    if (!open) return

    const update = () => {
      setSpotlight(resolveTargetRect(current.target, lunarWidthPx, lunarHeightPx))
    }
    const frame = window.requestAnimationFrame(update)
    window.addEventListener('resize', update)

    const observed = document.querySelector<HTMLElement>(
      `[data-nebula-tutorial="${current.target}"]`,
    )
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update)
    if (observed) observer?.observe(observed)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [current.target, lunarHeightPx, lunarWidthPx, open])

  useEffect(() => {
    if (!open) return
    nextButtonRef.current?.focus()
  }, [open, safeStep])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && safeStep > 0) {
        event.preventDefault()
        onStepChange(safeStep - 1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (safeStep === copy.steps.length - 1) onComplete()
        else onStepChange(safeStep + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [copy.steps.length, onComplete, onStepChange, open, safeStep])

  const card = cardPosition(spotlight, current.target, lunarHeightPx)

  if (!open) return null

  const spotlightStyle = {
    '--tutorial-target-left': `${spotlight.left}px`,
    '--tutorial-target-top': `${spotlight.top}px`,
    '--tutorial-target-width': `${spotlight.width}px`,
    '--tutorial-target-height': `${spotlight.height}px`,
    '--tutorial-target-radius': `${spotlight.radius}px`,
  } as CSSProperties

  const cardStyle = {
    left: `${card.left}px`,
    top: `${card.top}px`,
    width: `${card.width}px`,
  } as CSSProperties

  const finish = safeStep === copy.steps.length - 1

  return createPortal(
    <div
      className={[
        styles.overlay,
        current.target === 'top-edge' ? styles.hoverPracticeOverlay : '',
      ].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nebula-guided-tutorial-title"
    >
      <div
        className={styles.spotlight}
        data-target={current.target}
        style={spotlightStyle}
        aria-hidden="true"
      />

      <section
        ref={cardRef}
        key={current.target}
        className={styles.card}
        style={cardStyle}
        data-placement={card.placement}
      >
        <div className={styles.cardGlow} aria-hidden="true" />
        <header className={styles.header}>
          <div className={styles.orbitMark} aria-hidden="true">
            <span />
          </div>
          <div>
            <span className={styles.eyebrow}>{current.eyebrow}</span>
            <span className={styles.progress}>
              {copy.progress} {safeStep + 1} / {copy.steps.length}
            </span>
          </div>
        </header>

        <h2 id="nebula-guided-tutorial-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className={styles.actionHint}>{current.action}</div>

        <footer className={styles.footer}>
          <button type="button" className={styles.skipButton} onClick={onSkip}>
            {copy.skipAll}
          </button>

          <div className={styles.dots} aria-hidden="true">
            {copy.steps.map((item, index) => (
              <span
                key={item.target}
                className={index === safeStep ? styles.dotActive : ''}
              />
            ))}
          </div>

          <div className={styles.navigation}>
            {safeStep > 0 && (
              <button
                type="button"
                className={styles.backButton}
                onClick={() => onStepChange(safeStep - 1)}
              >
                {copy.previous}
              </button>
            )}
            <button
              ref={nextButtonRef}
              type="button"
              className={styles.nextButton}
              onClick={() => {
                if (finish) onComplete()
                else onStepChange(safeStep + 1)
              }}
            >
              {finish ? copy.finish : copy.next}
              <span aria-hidden="true">{finish ? '✓' : '→'}</span>
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
