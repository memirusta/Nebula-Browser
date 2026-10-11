import {
  Fragment,
  useEffect,
  useLayoutEffect,
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
import { resolveNavigationInput } from '../../core/addressNavigation'
import { cachedFaviconForUrl, ensureFavicon } from '../../core/faviconCache'
import { DEFAULT_USER_DISPLAY_NAME } from '../../core/userProfile'
import { useLocale } from '../../hooks/useLocale'
import type {
  HomeLayout,
  ModuleOffset,
  ModuleSize,
} from '../../core/homeLayout'
import type { BrowseSession } from '../../core/browseSession'
import { SEARCH_SIZE_WIDTH } from '../../core/homeLayout'
import type { Shortcut } from '../../core/types'
import type { EditPinnedShortcutResult } from '../../core/pinnedShortcuts'
import { EditModuleChrome } from '../HomeEdit/EditModuleChrome'
import { ModuleOffsetWrap } from './ModuleOffsetWrap'
import { PinnedStrip } from './PinnedStrip'
import styles from './HomeCenter.module.css'
import { fetchSearchSuggestions } from '../../platform/searchSuggestions'
import {
  buildHomeHistorySuggestions,
  filterHomeWebSuggestions,
  highlightSegments,
  inlineCompletion,
  queryTerms,
  suggestionInitial,
} from '../../core/homeSearchSuggestions'

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
  onEditPinnedShortcut?: (
    id: string,
    title: string,
    url: string,
  ) => EditPinnedShortcutResult
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

/** The icon of a suggestion: the one the site gave when it was visited, kept on this machine; a letter if none. */
function SuggestionIcon({
  kind,
  url,
  title,
  host,
}: {
  kind: 'site' | 'history' | 'query'
  url: string
  title: string
  host: string
}) {
  const [failed, setFailed] = useState(false)
  const [fetched, setFetched] = useState<string | null>(null)
  const known = kind === 'query' ? null : cachedFaviconForUrl(url)
  // A site that has no icon kept yet is asked for once; the icon appears when it arrives and is kept.
  useEffect(() => {
    if (kind === 'query' || known) return
    let live = true
    void ensureFavicon(url).then((found) => {
      if (live && found) setFetched(found)
    })
    return () => {
      live = false
    }
  }, [kind, known, url])
  const source = known ?? fetched
  const usable = source !== null && !failed
  return (
    <span className={styles.suggestionSiteIcon} aria-hidden="true">
      {usable ? (
        <img
          src={source}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          className={styles.suggestionFavicon}
          onError={() => setFailed(true)}
        />
      ) : kind === 'query' ? (
        '↻'
      ) : (
        suggestionInitial(kind === 'site' ? title : host, host, title)
      )}
    </span>
  )
}

/** Text with the parts that match what was typed in bold. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((segment, index) =>
        segment.match ? (
          <b key={index} className={styles.suggestionMatch}>
            {segment.text}
          </b>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}

export function HomeCenter({
  onNavigate,
  onSearchNavigate,
  variant = 'home',
  searchEngine = 'google',
  historyEntries = [],
  userDisplayName = DEFAULT_USER_DISPLAY_NAME,
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
  onEditPinnedShortcut,
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
  const { t, tf } = useLocale()

  const [query, setQuery] = useState('')
  // The rest of an address the field completes after the typed text. It only counts while the
  // typed text is still exactly what it was computed for.
  const [completion, setCompletion] = useState<{
    typed: string
    rest: string
    url: string
  } | null>(null)
  const activeCompletion =
    completion && completion.typed === query ? completion : null
  const typedTerms = useMemo(() => queryTerms(query), [query])
  const [isEditing, setIsEditing] =
    useState(false)

  const [activeSuggestion, setActiveSuggestion] =
    useState(-1)

  const [webSuggestions, setWebSuggestions] =
    useState<string[]>([])

  const searchInputRef =
    useRef<HTMLInputElement>(null)
  const selectAllOnNextClickRef =
    useRef(true)
  // The window lost focus while the field was being edited (Alt+Tab, another app). Nothing was
  // decided about the text: it stays, and it is not selected when the window comes back.
  const windowLostFocusWhileEditingRef =
    useRef(false)

  /*
   * ---------------------------------------------------------
   * HISTORY / SITE SUGGESTIONS
   * ---------------------------------------------------------
   */

  const historySuggestions = useMemo(
    () =>
      buildHomeHistorySuggestions(
        historyEntries,
        pinnedShortcuts,
        query,
      ),
    [
      historyEntries,
      pinnedShortcuts,
      query,
    ],
  )
  // The completion is shown after the typed text, selected: the next key replaces it, Backspace
  // removes it, Enter takes it.
  useLayoutEffect(() => {
    const input = searchInputRef.current
    if (!activeCompletion || !input || document.activeElement !== input) return
    input.setSelectionRange(
      query.length,
      query.length + activeCompletion.rest.length,
    )
  }, [activeCompletion, query])

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
        suggestions.slice(0, 8),
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

  const displayWebSuggestions = useMemo(
    () =>
      filterHomeWebSuggestions(
        webSuggestions,
        historySuggestions,
        query,
        // The whole list stays at about eight rows, as in Chrome and Brave: what the user has
        // visited first, the engine's suggestions fill the rest.
        Math.max(2, 8 - historySuggestions.length),
      ),
    [
      historySuggestions,
      query,
      webSuggestions,
    ],
  )
  const suggestionsOpen =
    isEditing &&
    !editMode &&
    query.trim().length > 0

  const searchSuggestionIndex =
    historySuggestions.length +
    displayWebSuggestions.length

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

  input.focus({
    preventScroll: true,
  })

  input.select()

  selectAllOnNextClickRef.current =
    false
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

    const url = resolveNavigationInput(
      trimmed,
      buildSearchUrl(trimmed, searchEngine),
    )
    if (!url) return

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
        displayWebSuggestions.length
    ) {
      const suggestion =
        displayWebSuggestions[webIndex]

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

    if (activeCompletion) {
      ;(onSearchNavigate ?? onNavigate)(activeCompletion.url)
      setIsEditing(false)
      setActiveSuggestion(-1)
      setWebSuggestions([])
      setCompletion(null)
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
      setCompletion(null)

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
        onEdit={(id, title, url) =>
          onEditPinnedShortcut?.(id, title, url) ?? {
            pins: [],
            accepted: false,
            reason: 'not-found',
          }
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
      data-nebula-tutorial="home-search"
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
          value={
            activeCompletion
              ? query + activeCompletion.rest
              : query
          }
          onChange={(event) => {
            const input = event.target
            const typed = input.value
            const native = event.nativeEvent as InputEvent

            setQuery(typed)

            setActiveSuggestion(
              -1,
            )

            // Only when characters are being added at the end (not on delete, paste in the
            // middle, or while an input method is composing) the address is completed.
            const adding =
              typeof native.inputType === 'string' &&
              native.inputType.startsWith('insert') &&
              !native.isComposing &&
              input.selectionStart === typed.length &&
              input.selectionEnd === typed.length
            const found =
              adding && typed.trim()
                ? inlineCompletion(
                    historyEntries,
                    pinnedShortcuts,
                    typed,
                  )
                : null
            setCompletion(
              found
                ? {
                    typed,
                    rest: found.completion,
                    url: found.url,
                  }
                : null,
            )
          }}
onMouseDown={(event) => {
  if (!selectAllOnNextClickRef.current) {
    return
  }

  // Prevent the native text caret placement from
  // immediately destroying the full selection.
  event.preventDefault()

  selectAllOnNextClickRef.current = false

  const input = event.currentTarget

  input.focus()
  input.select()
}}

onFocus={(event) => {
  setIsEditing(true)
  setActiveSuggestion(-1)

  if (windowLostFocusWhileEditingRef.current) {
    windowLostFocusWhileEditingRef.current = false
    return
  }

  event.currentTarget.select()
}}

onBlur={(event) => {
  const input = event.currentTarget

  // When only the window loses focus the field stays the document's active element; when focus
  // moves inside the page it does not. Decide after the event, once the active element is known.
  window.setTimeout(() => {
    if (document.activeElement === input) {
      windowLostFocusWhileEditingRef.current = true
      return
    }

    selectAllOnNextClickRef.current = true

    setIsEditing(false)
    setActiveSuggestion(-1)
  }, 0)
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
            (suggestion, index) => (
              <button
                key={suggestion.key}
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
                <SuggestionIcon
                  kind={suggestion.kind}
                  url={suggestion.url}
                  title={suggestion.title}
                  host={suggestion.host}
                />

                <span
                  className={
                    styles.suggestionText
                  }
                >
                  <strong>
                    <Highlighted
                      text={suggestion.title}
                      terms={typedTerms}
                    />
                  </strong>

                  <span>
                    <Highlighted
                      text={suggestion.subtitle}
                      terms={typedTerms}
                    />
                  </span>
                </span>
              </button>
            ),
          )}
          {displayWebSuggestions.map(
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
                      {suggestion
                        .toLocaleLowerCase()
                        .startsWith(
                          query
                            .trim()
                            .toLocaleLowerCase(),
                        ) &&
                      query.trim().length > 0 ? (
                        <>
                          {suggestion.slice(
                            0,
                            query.trim().length,
                          )}
                          <b
                            className={
                              styles.suggestionMatch
                            }
                          >
                            {suggestion.slice(
                              query.trim().length,
                            )}
                          </b>
                        </>
                      ) : (
                        suggestion
                      )}
                    </strong>

                    <span>{tf('searchSuggestionSource', { engine: searchEngineLabel })}</span>
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

              <span>{tf('searchWithEngine', { engine: searchEngineLabel })}</span>
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
