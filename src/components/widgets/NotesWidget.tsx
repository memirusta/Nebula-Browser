import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

export function NotesWidget({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLocale()

  return (
    <div className={styles.notes}>
      <span className={styles.notesLabel}>{t('widgetNotes')}</span>
      <textarea
        className={styles.notesEditor}
        value={value}
        maxLength={20_000}
        placeholder={t('notesPlaceholder')}
        onChange={(event) => onChange(event.target.value)}
        aria-label={t('widgetNotes')}
      />
    </div>
  )
}
