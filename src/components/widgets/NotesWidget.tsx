import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

export function NotesWidget() {
  const { t } = useLocale()

  return (
    <div className={styles.notes}>
      <span className={styles.notesLabel}>{t('widgetNotes')}</span>
      <div className={styles.notesStub}>{t('notesComingSoon')}</div>
    </div>
  )
}
