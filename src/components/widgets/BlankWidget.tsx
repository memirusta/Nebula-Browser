import styles from './widgets.module.css'

export function BlankWidget() {
  return (
    <div className={styles.blank}>
      <span className={styles.blankIcon}>◇</span>
      <span className={styles.blankText}>Boş alan — yakında özelleştirilebilir</span>
    </div>
  )
}
