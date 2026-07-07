import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

export function BlankWidget() {
  const { t } = useLocale()

  return (
    <div className={styles.blank}>
      <span className={styles.blankIcon}>◇</span>
      <span className={styles.blankText}>{t('blankPlaceholder')}</span>
    </div>
  )
}
