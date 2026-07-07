import { createPortal } from 'react-dom'
import type { SavedPassword } from '../../core/passwordVault'
import { GoogleAccountSetupPanel } from './GoogleAccountSetupPanel'
import styles from './GoogleAccountSetupModal.module.css'

interface GoogleAccountSetupModalProps {
  open: boolean
  email: string
  onClose: () => void
  onOpenBrowseUrl: (url: string) => void
  onMergePasswords: (entries: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => void
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
  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-setup-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="google-setup-title" className={styles.title}>
            Google hesabını bağla
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
