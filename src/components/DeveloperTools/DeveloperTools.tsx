import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { SHORTCUT_POSITIONS_KEY } from '../../core/shortcutLayout'
import { removeLocalStorage } from '../../core/storageSync'
import { SHORTCUT_FOLDERS_KEY } from '../../hooks/useShortcutFolders'
import {
  clearBrowseData,
  openBrowseTabDevTools,
  reloadBrowseTab,
} from '../../platform/tauriBrowser'
import { isTauri } from '../../platform/runtime'
import styles from './DeveloperTools.module.css'

type DeveloperToolsSection =
  | 'storage'
  | 'browser'
  | 'debug'

type SourceViewMode =
  | 'home'
  | 'browsing'
  | 'overlay'

interface DeveloperToolsProps {
  activeTabId: string | null
  activeUrl: string | null
  openTabIds: string[]
  sourceViewMode: SourceViewMode
  onClose: () => void
}

function prettyStorageValue(
  value: string | null,
): string {
  if (value === null) {
    return '— empty —'
  }

  try {
    return JSON.stringify(
      JSON.parse(value),
      null,
      2,
    )
  } catch {
    return value
  }
}

export function DeveloperTools({
  activeTabId,
  activeUrl,
  openTabIds,
  sourceViewMode,
  onClose,
}: DeveloperToolsProps) {
  const [section, setSection] =
    useState<DeveloperToolsSection>('storage')

  const [
    storageRevision,
    setStorageRevision,
  ] = useState(0)

  const [status, setStatus] =
    useState<string | null>(null)

  const nebulaStorageEntries = useMemo(() => {
    const entries: Array<{
      key: string
      value: string | null
    }> = []

    for (
      let index = 0;
      index < localStorage.length;
      index += 1
    ) {
      const key = localStorage.key(index)

      if (
        !key ||
        !key.startsWith('nebula-')
      ) {
        continue
      }

      entries.push({
        key,
        value: localStorage.getItem(key),
      })
    }

    return entries.sort((a, b) =>
      a.key.localeCompare(b.key),
    )
  }, [storageRevision])

  const refreshStorage = () => {
    setStorageRevision(
      (revision) => revision + 1,
    )
  }

  const clearStorageKey = (
    key: string,
  ) => {
    removeLocalStorage(key)

    refreshStorage()

    window.setTimeout(
      refreshStorage,
      100,
    )
  }

  const clearFolderCache = () => {
    clearStorageKey(
      SHORTCUT_FOLDERS_KEY,
    )

    setStatus(
      'Folder state cleared.',
    )
  }

  const clearSemiLunarLayout = () => {
    clearStorageKey(
      SHORTCUT_POSITIONS_KEY,
    )

    setStatus(
      'Semi-Lunar layout cleared.',
    )
  }

  const clearSemiLunarState = () => {
    removeLocalStorage(
      SHORTCUT_FOLDERS_KEY,
    )

    removeLocalStorage(
      SHORTCUT_POSITIONS_KEY,
    )

    refreshStorage()

    window.setTimeout(
      refreshStorage,
      100,
    )

    setStatus(
      'Folder and Semi-Lunar layout state cleared.',
    )
  }

  const runBrowserAction = async (
    label: string,
    action: () => Promise<void>,
  ) => {
    try {
      setStatus(`${label}...`)

      await action()

      setStatus(
        `${label} complete.`,
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error)

      setStatus(
        `${label} failed: ${message}`,
      )
    }
  }

  const reloadActiveTab = () => {
    if (
      !activeTabId ||
      !isTauri
    ) {
      return
    }

    void runBrowserAction(
      'Reload',
      () =>
        reloadBrowseTab(activeTabId),
    )
  }

  const clearActiveTabCache = () => {
    if (
      !activeTabId ||
      !isTauri
    ) {
      return
    }

    void runBrowserAction(
      'Clear cache',
      () =>
        clearBrowseData(
          activeTabId,
          'cache',
        ),
    )
  }

  const openNativeDevTools = () => {
    if (
      !activeTabId ||
      !isTauri
    ) {
      return
    }

    void runBrowserAction(
      'Open native DevTools',
      () =>
        openBrowseTabDevTools(
          activeTabId,
        ),
    )
  }

  if (!import.meta.env.DEV) {
    return null
  }

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose()
        }
      }}
    >
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Nebula Developer Tools"
      >
        <header
          className={styles.header}
        >
          <div>
            <div
              className={styles.title}
            >
              Nebula Dev Tools
            </div>

            <div
              className={
                styles.subtitle
              }
            >
              Internal development
              utilities
            </div>
          </div>

          <button
            type="button"
            className={
              styles.closeButton
            }
            onClick={onClose}
            aria-label="Close developer tools"
            title="Close (F12 / Esc)"
          >
            ✕
          </button>
        </header>

        <nav
          className={styles.tabs}
        >
          <button
            type="button"
            className={
              section === 'storage'
                ? styles.tabActive
                : styles.tab
            }
            onClick={() =>
              setSection('storage')
            }
          >
            Storage
          </button>

          <button
            type="button"
            className={
              section === 'browser'
                ? styles.tabActive
                : styles.tab
            }
            onClick={() =>
              setSection('browser')
            }
          >
            Browser
          </button>

          <button
            type="button"
            className={
              section === 'debug'
                ? styles.tabActive
                : styles.tab
            }
            onClick={() =>
              setSection('debug')
            }
          >
            Debug
          </button>
        </nav>

        <main
          className={styles.content}
        >
          {section === 'storage' && (
            <div
              className={
                styles.section
              }
            >
              <div
                className={
                  styles.sectionHeader
                }
              >
                <div>
                  <h2>
                    Storage
                  </h2>

                  <p>
                    Nebula
                    localStorage
                    state.
                  </p>
                </div>

                <button
                  type="button"
                  className={
                    styles.secondaryButton
                  }
                  onClick={
                    refreshStorage
                  }
                >
                  Refresh
                </button>
              </div>

              <div
                className={
                  styles.actionGrid
                }
              >
                <button
                  type="button"
                  className={
                    styles.actionButton
                  }
                  onClick={
                    clearFolderCache
                  }
                >
                  <strong>
                    Clear Folder
                    Cache
                  </strong>

                  <span>
                    {
                      SHORTCUT_FOLDERS_KEY
                    }
                  </span>
                </button>

                <button
                  type="button"
                  className={
                    styles.actionButton
                  }
                  onClick={
                    clearSemiLunarLayout
                  }
                >
                  <strong>
                    Clear Semi-Lunar
                    Layout
                  </strong>

                  <span>
                    {
                      SHORTCUT_POSITIONS_KEY
                    }
                  </span>
                </button>

                <button
                  type="button"
                  className={
                    styles.dangerButton
                  }
                  onClick={
                    clearSemiLunarState
                  }
                >
                  <strong>
                    Clear Both
                  </strong>

                  <span>
                    Reset folders +
                    positions
                  </span>
                </button>
              </div>

              <div
                className={
                  styles.storageList
                }
              >
                {nebulaStorageEntries.length ===
                0 ? (
                  <div
                    className={
                      styles.emptyState
                    }
                  >
                    No Nebula
                    localStorage
                    entries.
                  </div>
                ) : (
                  nebulaStorageEntries.map(
                    (entry) => (
                      <details
                        key={
                          entry.key
                        }
                        className={
                          styles.storageEntry
                        }
                      >
                        <summary>
                          <span>
                            {
                              entry.key
                            }
                          </span>

                          <span
                            className={
                              styles.chevron
                            }
                          >
                            ›
                          </span>
                        </summary>

                        <pre>
                          {prettyStorageValue(
                            entry.value,
                          )}
                        </pre>
                      </details>
                    ),
                  )
                )}
              </div>
            </div>
          )}

          {section === 'browser' && (
            <div
              className={
                styles.section
              }
            >
              <div
                className={
                  styles.sectionHeader
                }
              >
                <div>
                  <h2>
                    Browser
                  </h2>

                  <p>
                    Active WebView2
                    controls.
                  </p>
                </div>
              </div>

              <div
                className={
                  styles.infoGrid
                }
              >
                <div
                  className={
                    styles.infoCard
                  }
                >
                  <span>
                    Active tab
                  </span>

                  <strong>
                    {activeTabId ??
                      'None'}
                  </strong>
                </div>

                <div
                  className={
                    styles.infoCard
                  }
                >
                  <span>
                    Runtime
                  </span>

                  <strong>
                    {isTauri
                      ? 'Tauri / WebView2'
                      : 'Web fallback'}
                  </strong>
                </div>
              </div>

              <div
                className={
                  styles.urlCard
                }
              >
                <span>
                  Current URL
                </span>

                <code>
                  {activeUrl ??
                    '—'}
                </code>
              </div>

              <div
                className={
                  styles.actionGrid
                }
              >
                <button
                  type="button"
                  className={
                    styles.actionButton
                  }
                  disabled={
                    !activeTabId ||
                    !isTauri
                  }
                  onClick={
                    reloadActiveTab
                  }
                >
                  <strong>
                    Reload WebView
                  </strong>

                  <span>
                    Reload active
                    browser tab
                  </span>
                </button>

                <button
                  type="button"
                  className={
                    styles.actionButton
                  }
                  disabled={
                    !activeTabId ||
                    !isTauri
                  }
                  onClick={
                    clearActiveTabCache
                  }
                >
                  <strong>
                    Clear Cache
                  </strong>

                  <span>
                    Clear active
                    WebView cache
                  </span>
                </button>

                <button
                  type="button"
                  className={
                    styles.actionButton
                  }
                  disabled={
                    !activeTabId ||
                    !isTauri
                  }
                  onClick={
                    openNativeDevTools
                  }
                >
                  <strong>
                    Native WebView
                    DevTools
                  </strong>

                  <span>
                    Open WebView2
                    inspector
                  </span>
                </button>
              </div>
            </div>
          )}

          {section === 'debug' && (
            <div
              className={
                styles.section
              }
            >
              <div
                className={
                  styles.sectionHeader
                }
              >
                <div>
                  <h2>
                    Debug
                  </h2>

                  <p>
                    Current Nebula
                    shell state.
                  </p>
                </div>
              </div>

              <pre
                className={
                  styles.debugOutput
                }
              >
                {JSON.stringify(
                  {
                    environment:
                      import.meta.env.MODE,
                    tauri:
                      isTauri,
                    openedFrom:
                      sourceViewMode,
                    activeTabId,
                    activeUrl,
                    openTabIds,
                    openTabCount:
                      openTabIds.length,
                    userAgent:
                      navigator.userAgent,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </main>

        <footer
          className={styles.footer}
        >
          <span>
            F12 / Esc to close
          </span>

          {status && (
            <span
              className={
                styles.status
              }
            >
              {status}
            </span>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  )
}