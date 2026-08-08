import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { SavedPassword } from '../../core/passwordVault'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { GoogleAccountSetupPanel } from './GoogleAccountSetupPanel'
import styles from './GoogleAccountSetupModal.module.css'

interface GoogleAccountSetupModalProps {
  open: boolean
  email: string
  onClose: () => void
  onOpenBrowseUrl: (url: string) => void
  onMergePasswords: (entries: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => void | Promise<void>
  onRequestCsvImport?: () => void
}

export function GoogleAccountSetupModal({
  open,
  email,
  onClose,
  onOpenBrowseUrl,
  onMergePasswords,
  onRequestCsvImport,
}: GoogleAccountSetupModalProps) {
  const { t } = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)

  useDialogFocusTrap({ active: open, containerRef: panelRef, onEscape: onClose })

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-setup-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="google-setup-title" className={styles.title}>
            {t('googleLinkTitle')}
          </h2>
        </header>

        <GoogleAccountSetupPanel
          email={email}
          onOpenBrowseUrl={onOpenBrowseUrl}
          onMergePasswords={onMergePasswords}
          onRequestCsvImport={onRequestCsvImport}
          onApplied={() => window.setTimeout(() => onClose(), 900)}
          showSkip
          onSkip={onClose}
        />
      </div>
    </div>,
    document.body,
  )
}
