import { useEffect, useRef, useState } from 'react'
import { buildSearchUrl, type SearchEngine } from '../../core/nebulaSettings'
import { useLocale } from '../../hooks/useLocale'
import type { HomeLayout, ModuleOffset, ModuleSize } from '../../core/homeLayout'
import type { BrowseSession } from '../../core/browseSession'
import { SEARCH_SIZE_WIDTH } from '../../core/homeLayout'
import type { Shortcut } from '../../core/types'
import { EditModuleChrome } from '../HomeEdit/EditModuleChrome'
import { ModuleOffsetWrap } from './ModuleOffsetWrap'
import { PinnedStrip } from './PinnedStrip'
import styles from './HomeCenter.module.css'

interface HomeCenterProps {
  onNavigate: (url: string) => void
  onSearchNavigate?: (url: string) => void
  variant?: 'home' | 'overlay'
  searchEngine?: SearchEngine
  userDisplayName?: string
  avatarUrl?: string
  showGreeting?: boolean
  showProfile?: boolean
  showPinnedStrip?: boolean
  pinnedStripSize?: ModuleSize
  searchSize?: ModuleSize
  searchOffset?: ModuleOffset
  profileOffset?: ModuleOffset
  pinnedShortcuts?: Shortcut[]
  onUnpinShortcut?: (id: string) => void
  onReorderPins?: (fromIndex: number, toIndex: number) => void
  isShortcutMuted?: (id: string) => boolean
  onToggleShortcutMute?: (id: string) => void
  onRemoveShortcut?: (id: string) => void
  previewOnHover?: boolean
  previewDelayMs?: number
  onShortcutInteractionChange?: (active: boolean) => void
  activeUrl?: string | null
  getSession?: (url: string) => BrowseSession | null
  hideChrome?: boolean
  pinPreviewActive?: boolean
  editMode?: boolean
  editLayout?: HomeLayout
  onEditLayoutChange?: (patch: Partial<HomeLayout>) => void
  focusSearchRequest?: number
}

export function HomeCenter({
  onNavigate,
  onSearchNavigate,
  variant = 'home',
  searchEngine = 'google',
  userDisplayName = 'memir',
  avatarUrl,
  showGreeting = true,
  showProfile = true,
  showPinnedStrip = true,
  pinnedStripSize = 'm',
  searchSize = 'm',
  searchOffset = { x: 0, y: 0 },
  profileOffset = { x: 0, y: 0 },
  pinnedShortcuts = [],
  onUnpinShortcut,
  onReorderPins,
  isShortcutMuted,
  onToggleShortcutMute,
  onRemoveShortcut,
  previewOnHover,
  previewDelayMs,
  onShortcutInteractionChange,
  activeUrl = null,
  getSession,
  hideChrome = false,
  pinPreviewActive = false,
  editMode = false,
  editLayout,
  onEditLayoutChange,
  focusSearchRequest = 0,
}: HomeCenterProps) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focusSearchRequest) return
    const input = searchInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [focusSearchRequest])

  useEffect(() => {
    if (isEditing) return
    setQuery(activeUrl ?? '')
  }, [activeUrl, isEditing])

  const handleSubmit = () => {
    if (editMode) return
    const trimmed = query.trim()
    if (!trimmed) return
    const url = trimmed.includes('.') && !trimmed.includes(' ')
      ? (trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
      : buildSearchUrl(trimmed, searchEngine)
    ;(onSearchNavigate ?? onNavigate)(url)
    setIsEditing(false)
  }

  const resolvedSearchOffset =
    editMode && editLayout ? editLayout.search.offset : searchOffset
  const resolvedProfileOffset =
    editMode && editLayout ? editLayout.profile.offset : profileOffset

  const showPinSection =
    variant === 'home' && (showPinnedStrip || editMode) && (pinnedShortcuts.length > 0 || editMode)

  const pinStripContent =
    showPinSection && pinnedShortcuts.length > 0 ? (
      <PinnedStrip
        shortcuts={pinnedShortcuts}
        onNavigate={onNavigate}
        onUnpin={(id) => onUnpinShortcut?.(id)}
        onReorder={(from, to) => onReorderPins?.(from, to)}
        isMuted={isShortcutMuted}
        onToggleMute={onToggleShortcutMute}
        onRemoveShortcut={onRemoveShortcut}
        previewOnHover={previewOnHover}
        previewDelayMs={previewDelayMs}
        onShortcutInteractionChange={onShortcutInteractionChange}
        activeUrl={activeUrl}
        getSession={getSession}
        editMode={editMode}
        size={pinnedStripSize}
      />
    ) : editMode ? (
      <div className={styles.emptyPinPlaceholder}>{t('noPinnedSites')}</div>
    ) : null

  const searchBar = (
    <div
      className={[
        styles.searchBar,
        variant === 'overlay' ? styles.searchBarOverlay : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: SEARCH_SIZE_WIDTH[searchSize] }}
    >
      <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M16 16l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={searchInputRef}
        type="text"
        className={styles.searchInput}
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={(e) => {
          setIsEditing(true)
          e.currentTarget.select()
        }}
        onBlur={() => setIsEditing(false)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        readOnly={editMode}
        tabIndex={editMode ? -1 : undefined}
        autoFocus={variant === 'overlay'}
        spellCheck={false}
      />
    </div>
  )

  const profileSection =
    variant === 'home' && (showProfile || editMode) ? (
      <div
        className={[styles.profile, hideChrome ? styles.chromeHidden : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.avatarRing}>
          <div className={styles.avatar}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className={styles.avatarImage} />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            )}
          </div>
        </div>
        {showGreeting && (
          <p className={styles.greeting}>
            {t('welcomeBack')} {userDisplayName}
          </p>
        )}
      </div>
    ) : null

  return (
    <section
      className={[
        styles.root,
        pinPreviewActive ? styles.rootPinPreview : '',
        editMode ? styles.rootEditMode : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={editMode ? { width: SEARCH_SIZE_WIDTH[searchSize] } : undefined}
    >
      {showPinSection && (
        <div className={styles.pinFullBleed}>
          {editMode && editLayout && onEditLayoutChange ? (
            <EditModuleChrome
              label={t('pinStrip')}
              visible={editLayout.pinnedStrip.visible}
              onToggleVisible={() =>
                onEditLayoutChange({
                  pinnedStrip: {
                    ...editLayout.pinnedStrip,
                    visible: !editLayout.pinnedStrip.visible,
                  },
                })
              }
              size={editLayout.pinnedStrip.size}
              onSizeChange={(size) =>
                onEditLayoutChange({
                  pinnedStrip: { ...editLayout.pinnedStrip, size },
                })
              }
              reorderHint
              hidden={!editLayout.pinnedStrip.visible}
            >
              {pinStripContent}
            </EditModuleChrome>
          ) : (
            showPinnedStrip && pinStripContent
          )}
        </div>
      )}

      <div
        className={[styles.centerStack, hideChrome ? styles.chromeHidden : '']
          .filter(Boolean)
          .join(' ')}
      >
        {editMode && editLayout && onEditLayoutChange ? (
          <EditModuleChrome
            label={t('search')}
            size={editLayout.search.size}
            onSizeChange={(size) =>
              onEditLayoutChange({
                search: { ...editLayout.search, size },
              })
            }
            offset={editLayout.search.offset}
            onOffsetChange={(offset) =>
              onEditLayoutChange({
                search: { ...editLayout.search, offset },
              })
            }
            positionHint
          >
            {searchBar}
          </EditModuleChrome>
        ) : (
          <ModuleOffsetWrap offset={resolvedSearchOffset}>{searchBar}</ModuleOffsetWrap>
        )}
      </div>

      {profileSection &&
        (editMode && editLayout && onEditLayoutChange ? (
          <EditModuleChrome
            label={t('profile')}
            visible={editLayout.profile.visible}
            onToggleVisible={() =>
              onEditLayoutChange({
                profile: { ...editLayout.profile, visible: !editLayout.profile.visible },
              })
            }
            offset={editLayout.profile.offset}
            onOffsetChange={(offset) =>
              onEditLayoutChange({
                profile: { ...editLayout.profile, offset },
              })
            }
            hidden={!editLayout.profile.visible}
            controlsAtBottom
            positionHint
          >
            {profileSection}
          </EditModuleChrome>
        ) : (
          showProfile && (
            <ModuleOffsetWrap offset={resolvedProfileOffset}>{profileSection}</ModuleOffsetWrap>
          )
        ))}
    </section>
  )
}
