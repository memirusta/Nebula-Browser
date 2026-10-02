import { useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { EditPinnedShortcutResult } from '../../core/pinnedShortcuts'
import type { Shortcut } from '../../core/types'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useLocale } from '../../hooks/useLocale'
import styles from './PinnedShortcutEditor.module.css'

interface PinnedShortcutEditorProps {
  shortcut: Shortcut
  onClose: () => void
  onSave: (id: string, title: string, url: string) => EditPinnedShortcutResult
}

export function PinnedShortcutEditor({
  shortcut,
  onClose,
  onSave,
}: PinnedShortcutEditorProps) {
  const { t } = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(shortcut.label)
  const [url, setUrl] = useState(shortcut.url)
  const [error, setError] = useState<
    'invalid-url' | 'duplicate-url' | 'not-found' | null
  >(null)

  useDialogFocusTrap({
    active: true,
    containerRef: panelRef,
    initialFocusRef: titleInputRef,
    onEscape: onClose,
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = onSave(shortcut.id, title, url)
    if (result.accepted) {
      onClose()
      return
    }
    setError(result.reason)
  }

  const errorMessage = error === 'duplicate-url'
    ? t('pinnedEditDuplicateUrl')
    : error === 'not-found'
      ? t('pinnedEditMissing')
      : error === 'invalid-url'
        ? t('pinnedEditInvalidUrl')
        : null

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      data-semi-lunar-safe=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinned-shortcut-editor-title"
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.icon} aria-hidden="true">
              {shortcut.favicon ? (
                <img src={shortcut.favicon} alt="" draggable={false} />
              ) : (
                shortcut.label.charAt(0).toUpperCase()
              )}
            </span>
            <div>
              <h2 id="pinned-shortcut-editor-title">{t('pinnedEditTitle')}</h2>
              <p>{t('pinnedEditNameHint')}</p>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t('close')}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" />
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className={styles.fields}>
            <label>
              <span>{t('pinnedEditNameLabel')}</span>
              <input
                ref={titleInputRef}
                value={title}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setTitle(event.currentTarget.value)
                  setError(null)
                }}
              />
            </label>
            <label>
              <span>{t('pinnedEditUrlLabel')}</span>
              <input
                value={url}
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                aria-invalid={error === 'invalid-url' || error === 'duplicate-url'}
                aria-describedby={errorMessage ? 'pinned-shortcut-editor-error' : undefined}
                onChange={(event) => {
                  setUrl(event.currentTarget.value)
                  setError(null)
                }}
              />
            </label>
            {errorMessage && (
              <p id="pinned-shortcut-editor-error" className={styles.error} role="alert">
                {errorMessage}
              </p>
            )}
          </div>

          <footer className={styles.footer}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={!url.trim()}>
              {t('save')}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
