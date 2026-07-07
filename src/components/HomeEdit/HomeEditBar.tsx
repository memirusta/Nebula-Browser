import { useLocale } from '../../hooks/useLocale'
import styles from './HomeEditBar.module.css'

interface HomeEditBarProps {
  onSave: () => void
  onCancel: () => void
}

export function HomeEditBar({ onSave, onCancel }: HomeEditBarProps) {
  const { t } = useLocale()

  return (
    <div className={styles.bar} role="toolbar" aria-label={t('editBarAria')}>
      <span className={styles.title}>{t('editUi')}</span>
      <button type="button" className={styles.btn} onClick={onCancel}>
        {t('cancel')}
      </button>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onSave}>
        {t('editDone')}
      </button>
    </div>
  )
}
