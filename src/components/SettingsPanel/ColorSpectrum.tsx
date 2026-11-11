import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { hexToRgb, rgbToHex } from '../../core/accentPalette'
import styles from './ColorSpectrum.module.css'

interface Props {
  value: string
  /** The chosen colour: when a drag ends, or at once for a key, the hex or a swatch. */
  onChange: (hex: string) => void
  /**
   * The colour while it is dragged, at most once per frame. Meant for something cheap, such as showing it on the page;
   * saving it is left to onChange, which follows when the drag ends. Without it, onChange gets every frame.
   */
  onPreview?: (hex: string) => void
  /** Names for assistive technology, in the person's language. */
  labels: { shade: string; hue: string; hex: string }
}

type Hsv = { h: number; s: number; v: number }

function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * A colour picker: a square of shades (saturation across, brightness up), a rainbow bar for the hue, and the hex.
 * The colour is applied as it is dragged, at most once per frame, so the whole app shows it as it changes.
 */
export function ColorSpectrum({ value, onChange, onPreview, labels }: Props) {
  const [picked, setPicked] = useState<Hsv>(() => hexToHsv(value))
  // While a drag is going the colour has not been saved yet, so the value is behind the picker: the picker is right.
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const latest = useRef<Hsv>(picked)
  // What the picker shows: what was picked, unless the colour was changed from outside (a swatch), then that colour -
  // with the hue kept when it is grey or black, which have none. Worked out here, not in an effect.
  const hsv: Hsv = (() => {
    if (dragging || hsvToHex(picked).toLowerCase() === value.toLowerCase()) return picked
    const outside = hexToHsv(value)
    return { ...outside, h: outside.s === 0 ? picked.h : outside.h }
  })()
  const [typed, setTyped] = useState<string | null>(null)
  const hexText = typed ?? value
  const areaRef = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)
  const pending = useRef<string | null>(null)

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])

  const emit = useCallback(
    (next: Hsv, commit = false) => {
      setPicked(next)
      latest.current = next
      const hex = hsvToHex(next)
      if (commit) {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
        pending.current = null
        onChange(hex)
        return
      }
      pending.current = hex
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const hex = pending.current
        if (hex !== null) (onPreview ?? onChange)(hex)
        pending.current = null
      })
    },
    [onChange, onPreview],
  )

  const startDrag = () => {
    draggingRef.current = true
    setDragging(true)
  }

  /** The drag is over: save the colour it ended on. */
  const endDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    emit(latest.current, true)
  }

  /** A drag is previewed; anything else (a key, the hex) is saved at once. */
  const emitMove = (next: Hsv) => emit(next, !draggingRef.current)

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = areaRef.current?.getBoundingClientRect()
    if (!rect) return
    emitMove({
      h: hsv.h,
      s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1),
    })
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    if (event.key === 'ArrowLeft') emit({ ...hsv, s: clamp(hsv.s - step, 0, 1) }, true)
    else if (event.key === 'ArrowRight') emit({ ...hsv, s: clamp(hsv.s + step, 0, 1) }, true)
    else if (event.key === 'ArrowUp') emit({ ...hsv, v: clamp(hsv.v + step, 0, 1) }, true)
    else if (event.key === 'ArrowDown') emit({ ...hsv, v: clamp(hsv.v - step, 0, 1) }, true)
    else return
    event.preventDefault()
  }

  return (
    <div className={styles.spectrum}>
      <div
        ref={areaRef}
        className={styles.area}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))` }}
        role="slider"
        data-peek
        tabIndex={0}
        aria-label={labels.shade}
        aria-valuetext={hsvToHex(hsv)}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        onKeyDown={onKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          startDrag()
          fromPointer(event)
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event)
        }}
      >
        <span className={styles.thumb} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <input
        type="range"
        className={styles.hue}
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv.h)}
        aria-label={labels.hue}
        onPointerDown={startDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onChange={(event) => emitMove({ ...hsv, h: Number(event.target.value) })}
      />
      <div className={styles.hexRow}>
        <span className={styles.preview} style={{ background: hsvToHex(hsv) }} aria-hidden="true" />
        <input
          className={styles.hexInput}
          value={hexText}
          maxLength={7}
          spellCheck={false}
          aria-label={labels.hex}
          onFocus={() => setTyped(value)}
          onBlur={() => setTyped(null)}
          onChange={(event) => {
            const text = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`
            setTyped(text)
            if (/^#[0-9a-fA-F]{6}$/.test(text)) emit(hexToHsv(text), true)
          }}
        />
      </div>
    </div>
  )
}
