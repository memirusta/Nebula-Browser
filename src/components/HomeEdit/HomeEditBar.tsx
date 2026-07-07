import styles from './HomeEditBar.module.css'

interface HomeEditBarProps {
  onSave: () => void
  onCancel: () => void
}

export function HomeEditBar({ onSave, onCancel }: HomeEditBarProps) {
  return (
    <div className={styles.bar} role="toolbar" aria-label="Arayüz düzenleme">
      <span className={styles.title}>Arayüzü düzenle</span>
      <button type="button" className={styles.btn} onClick={onCancel}>
        İptal
      </button>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onSave}>
        Bitti
      </button>
    </div>
  )
}
