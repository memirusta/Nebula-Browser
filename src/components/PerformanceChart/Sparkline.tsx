interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  /** A colour or a variable such as var(--nebula-accent-ink); white was invisible on the light theme. */
  color?: string
}

export function Sparkline({ data, width = 160, height = 36, color = 'var(--nebula-accent-ink)' }: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data) - 5
  const max = Math.max(...data) + 5
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="sparkline"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
