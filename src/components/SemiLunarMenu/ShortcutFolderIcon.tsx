import type { Shortcut } from '../../core/types'
import styles from './ShortcutFolderIcon.module.css'

interface ShortcutFolderIconProps {
  members: Shortcut[]
  merging?: boolean
  dropHover?: boolean
  dropTarget?: boolean
}

export function ShortcutFolderIcon({ members, merging, dropHover, dropTarget }: ShortcutFolderIconProps) {
  const preview = members.slice(0, 4)

  return (
    <div
      className={[
        styles.folder,
        merging ? styles.folderMerging : '',
        dropHover ? styles.folderDropHover : '',
        dropTarget ? styles.folderDropTarget : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.grid}>
        {preview.map((s) => (
          <span key={s.id} className={styles.mini}>
            {s.favicon ? (
              <img src={s.favicon} alt="" draggable={false} />
            ) : (
              <span>{s.label[0]}</span>
            )}
          </span>
        ))}
      </div>
      {members.length > 4 && <span className={styles.more}>+{members.length - 4}</span>}
    </div>
  )
}
