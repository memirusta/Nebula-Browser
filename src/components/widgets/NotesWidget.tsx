import styles from './widgets.module.css'

export function NotesWidget() {
  return (
    <div className={styles.notes}>
      <span className={styles.notesLabel}>Notlar</span>
      <div className={styles.notesStub}>Not defteri yakında eklenecek</div>
    </div>
  )
}
