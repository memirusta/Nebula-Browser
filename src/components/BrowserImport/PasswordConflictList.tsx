import { useMemo } from 'react'
import { tf } from '../../core/locale'
import type { ImportPicks, ImportPlan } from '../../core/passwordImportCompare'
import { useLocale } from '../../hooks/useLocale'
import styles from './BrowserImport.module.css'

interface PasswordConflictListProps {
  plan: ImportPlan
  picks: ImportPicks
  onPick: (key: string, index: number) => void
  /** Browser id to the name shown for it. */
  names: ReadonlyMap<string, string>
  disabled?: boolean
}

function recommendedIndex(choices: ImportPlan['conflicts'][number]['choices']): number {
  return Math.max(0, choices.findIndex((choice) => choice.recommended))
}

/**
 * The same account with different passwords in different places: the user picks the one to keep. Only where each
 * password was found and when it was used are shown, never the password itself.
 */
export function PasswordConflictList({ plan, picks, onPick, names, disabled = false }: PasswordConflictListProps) {
  const { locale, t } = useLocale()
  const dateFormat = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
    } catch {
      return new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
    }
  }, [locale])

  return (
    <>
      <h3 className={styles.conflictTitle}>{t('gsConflictsTitle')}</h3>
      <p className={styles.conflictLead}>{t('gsConflictsLead')}</p>

      <div className={styles.conflictList}>
        {plan.conflicts.map((conflict) => {
          const selected = picks[conflict.key] ?? recommendedIndex(conflict.choices)
          return (
            <fieldset key={conflict.key} className={styles.conflict} disabled={disabled}>
              <legend className={styles.conflictLegend}>
                <strong>{conflict.host}</strong>
                <span className={styles.conflictUser}>{conflict.username}</span>
              </legend>
              {conflict.choices.map((choice, index) => {
                const where = [
                  ...new Set(
                    choice.copies.map((copy) => {
                      const name = names.get(copy.browser) ?? copy.browser
                      return copy.profile ? `${name} (${copy.profile})` : name
                    }),
                  ),
                ].join(', ')
                return (
                  <label key={index} className={styles.choice}>
                    <input
                      type="radio"
                      name={conflict.key}
                      checked={selected === index}
                      onChange={() => onPick(conflict.key, index)}
                    />
                    <span className={styles.choiceText}>
                      <span>
                        {where}
                        {choice.recommended && <span className={styles.badge}>{t('gsConflictRecommended')}</span>}
                      </span>
                      <span className={styles.hint}>
                        {choice.timestampMs !== null
                          ? tf(locale, 'gsConflictLastUsed', {
                              date: dateFormat.format(new Date(choice.timestampMs)),
                            })
                          : t('gsConflictNoDate')}
                      </span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
          )
        })}
      </div>
    </>
  )
}
