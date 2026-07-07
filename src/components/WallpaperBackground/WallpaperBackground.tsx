import styles from './WallpaperBackground.module.css'

interface WallpaperBackgroundProps {
  imageUrl?: string | null
  hidden?: boolean
}

export function WallpaperBackground({ imageUrl, hidden = false }: WallpaperBackgroundProps) {
  return (
    <div
      className={[styles.root, hidden ? styles.hidden : ''].filter(Boolean).join(' ')}
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      data-custom={!!imageUrl}
      aria-hidden={hidden}
    >
      <div className={styles.overlay} />
    </div>
  )
}
