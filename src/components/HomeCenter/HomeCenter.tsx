import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { HistoryEntry } from '../../core/browsingHistory'
import {
  buildSearchUrl,
  type SearchEngine,
} from '../../core/nebulaSettings'
import { useLocale } from '../../hooks/useLocale'
import type {
  HomeLayout,
  ModuleOffset,
  ModuleSize,
} from '../../core/homeLayout'
import type { BrowseSession } from '../../core/browseSession'
import { SEARCH_SIZE_WIDTH } from '../../core/homeLayout'
import type { Shortcut } from '../../core/types'
import { EditModuleChrome } from '../HomeEdit/EditModuleChrome'
import { ModuleOffsetWrap } from './ModuleOffsetWrap'
import { PinnedStrip } from './PinnedStrip'
import styles from './HomeCenter.module.css'
import { fetchSearchSuggestions } from '../../platform/searchSuggestions'

interface HomeCenterProps {
  onNavigate: (url: string) => void
  onSearchNavigate?: (url: string) => void
  variant?: 'home' | 'overlay'
  searchEngine?: SearchEngine
  historyEntries?: HistoryEntry[]
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
  onReorderPins?: (
    fromIndex: number,
    toIndex: number,
  ) => void
  isShortcutMuted?: (id: string) => boolean
  onToggleShortcutMute?: (id: string) => void
  onRemoveShortcut?: (id: string) => void
  previewOnHover?: boolean
  previewDelayMs?: number
  onShortcutInteractionChange?: (
    active: boolean,
  ) => void
  activeUrl?: string | null
  getSession?: (
    url: string,
  ) => BrowseSession | null
  hideChrome?: boolean
  pinPreviewActive?: boolean
  editMode?: boolean
  editLayout?: HomeLayout
  onEditLayoutChange?: (
    patch: Partial<HomeLayout>,
  ) => void
  focusSearchRequest?: number
}

export function HomeCenter({
  onNavigate,
  onSearchNavigate,
  variant = 'home',
  searchEngine = 'google',
  historyEntries = [],
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
  const [isEditing, setIsEditing] =
    useState(false)

  const [activeSuggestion, setActiveSuggestion] =
    useState(-1)

  const [webSuggestions, setWebSuggestions] =
    useState<string[]>([])

  const searchInputRef =
    useRef<HTMLInputElement>(null)

  /*
   * ---------------------------------------------------------
   * HISTORY / SITE SUGGESTIONS
   * ---------------------------------------------------------
   */

  const historySuggestions = useMemo(() => {
    const needle =
      query.trim().toLocaleLowerCase()

    if (!needle || editMode) {
      return []
    }

    const seen = new Set<string>()

    return historyEntries
      .filter((entry) => {
        const haystack =
          `${entry.title} ${entry.host} ${entry.url}`.toLocaleLowerCase()

        return haystack.includes(needle)
      })
      .sort((a, b) => {
        const aHost =
          a.host.toLocaleLowerCase()

        const bHost =
          b.host.toLocaleLowerCase()

        const aTitle =
          a.title.toLocaleLowerCase()

        const bTitle =
          b.title.toLocaleLowerCase()

        const score = (
          host: string,
          title: string,
        ) => {
          if (host.startsWith(needle)) {
            return 0
          }

          if (title.startsWith(needle)) {
            return 1
          }

          if (host.includes(needle)) {
            return 2
          }

          return 3
        }

        const scoreDifference =
          score(aHost, aTitle) -
          score(bHost, bTitle)

        if (scoreDifference !== 0) {
          return scoreDifference
        }

        return b.visitedAt - a.visitedAt
      })
      .filter((entry) => {
        if (seen.has(entry.url)) {
          return false
        }

        seen.add(entry.url)
        return true
      })
      .slice(0, 5)
  }, [
    editMode,
    historyEntries,
    query,
  ])

  /*
   * ---------------------------------------------------------
   * WEB SEARCH SUGGESTIONS
   * ---------------------------------------------------------
   */

useEffect(() => {
  const trimmed = query.trim()

  if (
    !isEditing ||
    editMode ||
    trimmed.length < 2
  ) {
    setWebSuggestions([])
    return
  }

  let cancelled = false

  const timer = window.setTimeout(() => {
    void fetchSearchSuggestions(
      trimmed,
      searchEngine,
    ).then((suggestions) => {
      if (cancelled) return

      setWebSuggestions(
        suggestions.slice(0, 6),
      )
    })
  }, 180)

  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}, [
  editMode,
  isEditing,
  query,
  searchEngine,
])

  /*
   * ---------------------------------------------------------
   * SUGGESTION STATE
   * ---------------------------------------------------------
   */

  const suggestionsOpen =
    isEditing &&
    !editMode &&
    query.trim().length > 0

  const searchSuggestionIndex =
    historySuggestions.length +
    webSuggestions.length

  const suggestionCount =
    searchSuggestionIndex + 1

  const searchEngineLabel =
    searchEngine === 'duckduckgo'
      ? 'DuckDuckGo'
      : searchEngine === 'bing'
        ? 'Bing'
        : 'Google'

  /*
   * ---------------------------------------------------------
   * FOCUS / URL SYNC
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!focusSearchRequest) {
      return
    }

    const input =
      searchInputRef.current

    if (!input) {
      return
    }

    input.focus()
    input.select()
  }, [focusSearchRequest])

  useEffect(() => {
    if (isEditing) {
      return
    }

    setQuery(activeUrl ?? '')
  }, [
    activeUrl,
    isEditing,
  ])

  /*
   * ---------------------------------------------------------
   * NAVIGATION
   * ---------------------------------------------------------
   */

  const navigateQuery = (
    value: string,
  ) => {
    if (editMode) {
      return
    }

    const trimmed = value.trim()

    if (!trimmed) {
      return
    }

    let url =
      buildSearchUrl(
        trimmed,
        searchEngine,
      )

    /*
     * Tek kelime / URL girdilerinde
     * doğrudan siteye gitmeyi dene.
     *
     * Örn:
     *
     * github.com
     * https://github.com
     */
    if (!trimmed.includes(' ')) {
      const candidate =
        /^https?:\/\//i.test(trimmed)
          ? trimmed
          : `https://${trimmed}`

      try {
        const parsed =
          new URL(candidate)

        if (
          [
            'http:',
            'https:',
          ].includes(
            parsed.protocol,
          ) &&
          parsed.hostname.includes('.')
        ) {
          url = parsed.href
        }
      } catch {
        /*
         * URL değilse normal
         * arama olarak devam et.
         */
      }
    }

    ;(
      onSearchNavigate ??
      onNavigate
    )(url)

    setIsEditing(false)
    setActiveSuggestion(-1)
    setWebSuggestions([])
  }

  const chooseSuggestion = (
    index: number,
  ) => {
    /*
     * 1. History/site suggestion
     */
    if (
      index >= 0 &&
      index <
        historySuggestions.length
    ) {
      const entry =
        historySuggestions[index]

      setQuery(entry.url)

      ;(
        onSearchNavigate ??
        onNavigate
      )(entry.url)

      setIsEditing(false)
      setActiveSuggestion(-1)
      setWebSuggestions([])

      return
    }

    /*
     * 2. Web search suggestion
     */
    const webIndex =
      index -
      historySuggestions.length

    if (
      webIndex >= 0 &&
      webIndex <
        webSuggestions.length
    ) {
      const suggestion =
        webSuggestions[webIndex]

      setQuery(suggestion)
      navigateQuery(suggestion)

      return
    }

    /*
     * 3. Son satır:
     * "Google ile ara"
     */
    navigateQuery(query)
  }

  const handleSubmit = () => {
    if (
      suggestionsOpen &&
      activeSuggestion >= 0
    ) {
      chooseSuggestion(
        activeSuggestion,
      )

      return
    }

    navigateQuery(query)
  }

  /*
   * ---------------------------------------------------------
   * KEYBOARD NAVIGATION
   * ---------------------------------------------------------
   */

  const handleSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (
      event.key ===
        'ArrowDown' &&
      suggestionsOpen
    ) {
      event.preventDefault()

      setActiveSuggestion(
        (current) =>
          current >=
          suggestionCount - 1
            ? 0
            : current + 1,
      )

      return
    }

    if (
      event.key ===
        'ArrowUp' &&
      suggestionsOpen
    ) {
      event.preventDefault()

      setActiveSuggestion(
        (current) =>
          current <= 0
            ? suggestionCount - 1
            : current - 1,
      )

      return
    }

    if (
      event.key === 'Escape'
    ) {
      event.preventDefault()

      setIsEditing(false)
      setActiveSuggestion(-1)
      setWebSuggestions([])

      searchInputRef.current?.blur()

      return
    }

    if (
      event.key === 'Enter'
    ) {
      event.preventDefault()
      handleSubmit()
    }
  }

  /*
   * ---------------------------------------------------------
   * HOME LAYOUT
   * ---------------------------------------------------------
   */

  const resolvedSearchOffset =
    editMode && editLayout
      ? editLayout.search.offset
      : searchOffset

  const resolvedProfileOffset =
    editMode && editLayout
      ? editLayout.profile.offset
      : profileOffset

  const showPinSection =
    variant === 'home' &&
    (showPinnedStrip ||
      editMode) &&
    (pinnedShortcuts.length >
      0 ||
      editMode)

  /*
   * ---------------------------------------------------------
   * PINNED STRIP
   * ---------------------------------------------------------
   */

  const pinStripContent =
    showPinSection &&
    pinnedShortcuts.length > 0 ? (
      <PinnedStrip
        shortcuts={
          pinnedShortcuts
        }
        onNavigate={
          onNavigate
        }
        onUnpin={(id) =>
          onUnpinShortcut?.(id)
        }
        onReorder={(
          from,
          to,
        ) =>
          onReorderPins?.(
            from,
            to,
          )
        }
        isMuted={
          isShortcutMuted
        }
        onToggleMute={
          onToggleShortcutMute
        }
        onRemoveShortcut={
          onRemoveShortcut
        }
        previewOnHover={
          previewOnHover
        }
        previewDelayMs={
          previewDelayMs
        }
        onShortcutInteractionChange={
          onShortcutInteractionChange
        }
        activeUrl={activeUrl}
        getSession={getSession}
        editMode={editMode}
        size={
          pinnedStripSize
        }
      />
    ) : editMode ? (
      <div
        className={
          styles.emptyPinPlaceholder
        }
      >
        {t('noPinnedSites')}
      </div>
    ) : null

  /*
   * ---------------------------------------------------------
   * SEARCH ICON
   * ---------------------------------------------------------
   */

  const suggestionSearchIcon = (
    <span
      className={
        styles.suggestionSearchIcon
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="10.5"
          cy="10.5"
          r="6"
          stroke="currentColor"
          strokeWidth="1.7"
        />

        <path
          d="M15 15l5 5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )

  /*
   * ---------------------------------------------------------
   * SEARCH BAR
   * ---------------------------------------------------------
   */

  const searchBar = (
    <div
      className={
        styles.searchWrap
      }
      style={{
        width:
          SEARCH_SIZE_WIDTH[
            searchSize
          ],
      }}
    >
      <div
        className={[
          styles.searchBar,
          variant === 'overlay'
            ? styles.searchBarOverlay
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <svg
          className={
            styles.searchIcon
          }
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            stroke="currentColor"
            strokeWidth="1.5"
          />

          <path
            d="M16 16l5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>

        <input
          ref={searchInputRef}
          type="text"
          className={
            styles.searchInput
          }
          placeholder={t(
            'searchPlaceholder',
          )}
          value={query}
          onChange={(event) => {
            setQuery(
              event.target.value,
            )

            setActiveSuggestion(
              -1,
            )
          }}
          onFocus={(event) => {
            setIsEditing(true)

            setActiveSuggestion(
              -1,
            )

            event.currentTarget.select()
          }}
          onBlur={() => {
            setIsEditing(false)

            setActiveSuggestion(
              -1,
            )
          }}
          onKeyDown={
            handleSearchKeyDown
          }
          readOnly={editMode}
          tabIndex={
            editMode
              ? -1
              : undefined
          }
          autoFocus={
            variant === 'overlay'
          }
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={
            suggestionsOpen
          }
          aria-autocomplete="list"
        />
      </div>

      {suggestionsOpen && (
        <div
          className={
            styles.suggestions
          }
          role="listbox"
        >
          {/*
           * -----------------------------------
           * HISTORY / SITE SUGGESTIONS
           * -----------------------------------
           */}

          {historySuggestions.map(
            (entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={
                  activeSuggestion ===
                  index
                }
                className={[
                  styles.suggestionRow,
                  activeSuggestion ===
                  index
                    ? styles.suggestionRowActive
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() =>
                  setActiveSuggestion(
                    index,
                  )
                }
                onMouseDown={(
                  event,
                ) => {
                  event.preventDefault()

                  chooseSuggestion(
                    index,
                  )
                }}
              >
                <span
                  className={
                    styles.suggestionSiteIcon
                  }
                >
                  {entry.host
                    .replace(
                      /^www\./,
                      '',
                    )
                    .charAt(0)
                    .toUpperCase()}
                </span>

                <span
                  className={
                    styles.suggestionText
                  }
                >
                  <strong>
                    {entry.title}
                  </strong>

                  <span>
                    {entry.url}
                  </span>
                </span>
              </button>
            ),
          )}

          {/*
           * -----------------------------------
           * LIVE WEB SUGGESTIONS
           * -----------------------------------
           */}

          {webSuggestions.map(
            (
              suggestion,
              index,
            ) => {
              const
                suggestionIndex =
                  historySuggestions.length +
                  index

              return (
                <button
                  key={`${suggestion}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={
                    activeSuggestion ===
                    suggestionIndex
                  }
                  className={[
                    styles.suggestionRow,
                    activeSuggestion ===
                    suggestionIndex
                      ? styles.suggestionRowActive
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() =>
                    setActiveSuggestion(
                      suggestionIndex,
                    )
                  }
                  onMouseDown={(
                    event,
                  ) => {
                    event.preventDefault()

                    chooseSuggestion(
                      suggestionIndex,
                    )
                  }}
                >
                  {
                    suggestionSearchIcon
                  }

                  <span
                    className={
                      styles.suggestionText
                    }
                  >
                    <strong>
                      {suggestion}
                    </strong>

                    <span>
                      {
                        searchEngineLabel
                      }{' '}
                      önerisi
                    </span>
                  </span>
                </button>
              )
            },
          )}

          {/*
           * -----------------------------------
           * FINAL "SEARCH FOR QUERY" ROW
           * -----------------------------------
           */}

          <button
            type="button"
            role="option"
            aria-selected={
              activeSuggestion ===
              searchSuggestionIndex
            }
            className={[
              styles.suggestionRow,
              activeSuggestion ===
              searchSuggestionIndex
                ? styles.suggestionRowActive
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onMouseEnter={() =>
              setActiveSuggestion(
                searchSuggestionIndex,
              )
            }
            onMouseDown={(
              event,
            ) => {
              event.preventDefault()

              chooseSuggestion(
                searchSuggestionIndex,
              )
            }}
          >
            {
              suggestionSearchIcon
            }

            <span
              className={
                styles.suggestionText
              }
            >
              <strong>
                {query.trim()}
              </strong>

              <span>
                {
                  searchEngineLabel
                }{' '}
                ile ara
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  )

  /*
   * ---------------------------------------------------------
   * PROFILE
   * ---------------------------------------------------------
   */

  const profileSection =
    variant === 'home' &&
    (showProfile ||
      editMode) ? (
      <div
        className={[
          styles.profile,
          hideChrome
            ? styles.chromeHidden
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div
          className={
            styles.avatarRing
          }
        >
          <div
            className={
              styles.avatar
            }
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className={
                  styles.avatarImage
                }
              />
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            )}
          </div>
        </div>

        {showGreeting && (
          <p
            className={
              styles.greeting
            }
          >
            {t('welcomeBack')}{' '}
            {userDisplayName}
          </p>
        )}
      </div>
    ) : null

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  return (
    <section
      className={[
        styles.root,
        pinPreviewActive
          ? styles.rootPinPreview
          : '',
        editMode
          ? styles.rootEditMode
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        editMode
          ? {
              width:
                SEARCH_SIZE_WIDTH[
                  searchSize
                ],
            }
          : undefined
      }
    >
      {showPinSection && (
        <div
          className={
            styles.pinFullBleed
          }
        >
          {editMode &&
          editLayout &&
          onEditLayoutChange ? (
            <EditModuleChrome
              label={t(
                'pinStrip',
              )}
              visible={
                editLayout
                  .pinnedStrip
                  .visible
              }
              onToggleVisible={() =>
                onEditLayoutChange({
                  pinnedStrip: {
                    ...editLayout
                      .pinnedStrip,
                    visible:
                      !editLayout
                        .pinnedStrip
                        .visible,
                  },
                })
              }
              size={
                editLayout
                  .pinnedStrip
                  .size
              }
              onSizeChange={(
                size,
              ) =>
                onEditLayoutChange({
                  pinnedStrip: {
                    ...editLayout
                      .pinnedStrip,
                    size,
                  },
                })
              }
              reorderHint
              hidden={
                !editLayout
                  .pinnedStrip
                  .visible
              }
            >
              {
                pinStripContent
              }
            </EditModuleChrome>
          ) : (
            showPinnedStrip &&
            pinStripContent
          )}
        </div>
      )}

      <div
        className={[
          styles.centerStack,
          hideChrome
            ? styles.chromeHidden
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {editMode &&
        editLayout &&
        onEditLayoutChange ? (
          <EditModuleChrome
            label={t('search')}
            size={
              editLayout.search
                .size
            }
            onSizeChange={(
              size,
            ) =>
              onEditLayoutChange({
                search: {
                  ...editLayout.search,
                  size,
                },
              })
            }
            offset={
              editLayout.search
                .offset
            }
            onOffsetChange={(
              offset,
            ) =>
              onEditLayoutChange({
                search: {
                  ...editLayout.search,
                  offset,
                },
              })
            }
            positionHint
          >
            {searchBar}
          </EditModuleChrome>
        ) : (
          <ModuleOffsetWrap
            offset={
              resolvedSearchOffset
            }
          >
            {searchBar}
          </ModuleOffsetWrap>
        )}
      </div>

      {profileSection &&
        (editMode &&
        editLayout &&
        onEditLayoutChange ? (
          <EditModuleChrome
            label={t('profile')}
            visible={
              editLayout.profile
                .visible
            }
            onToggleVisible={() =>
              onEditLayoutChange({
                profile: {
                  ...editLayout.profile,
                  visible:
                    !editLayout
                      .profile
                      .visible,
                },
              })
            }
            offset={
              editLayout.profile
                .offset
            }
            onOffsetChange={(
              offset,
            ) =>
              onEditLayoutChange({
                profile: {
                  ...editLayout.profile,
                  offset,
                },
              })
            }
            hidden={
              !editLayout.profile
                .visible
            }
            controlsAtBottom
            positionHint
          >
            {profileSection}
          </EditModuleChrome>
        ) : (
          showProfile && (
            <ModuleOffsetWrap
              offset={
                resolvedProfileOffset
              }
            >
              {profileSection}
            </ModuleOffsetWrap>
          )
        ))}
    </section>
  )
}