import { useEffect, useRef, useState } from 'react'
import { EXTENSION_CATALOG } from '../../core/extensionCatalog'
import { extensionHostCopy } from '../../core/extensionHostCopy'
import { extensionInstallCopy } from '../../core/extensionInstallCopy'
import { createExtensionPanelController, type ExtensionPanelState } from '../../core/extensionPanelState'
import { panelColumns, panelLeft, panelWidth, primaryExtensionAction, TILE_GAP, TILE_WIDTH } from '../../core/extensionTile'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { browseWithExtensions, clickExtension, installedExtensions, manageExtension, openExtension, type InstalledExtension } from '../../platform/extensionDownload'
import styles from './ExtensionsPanel.module.css'

export function ExtensionsPanel({ top, privateTab, activeUrl, onClose, onManage }: {
  top: number; privateTab: boolean; activeUrl?: string; onClose: () => void; onManage: () => void
}) {
  const { locale, t } = useLocale()
  const copy = extensionHostCopy(locale)
  const installCopy = extensionInstallCopy(locale)
  const panelRef = useRef<HTMLElement>(null)
  const controller = useRef<ReturnType<typeof createExtensionPanelController<InstalledExtension>> | null>(null)
  const [{ items, loading, pending, error }, setState] = useState<ExtensionPanelState<InstalledExtension>>({ items: [], loading: true, pending: null, error: '' })
  const [resolvedTop, setResolvedTop] = useState(12)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Where the button that opened the box is, and how wide the window is.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useDialogFocusTrap({ active: true, containerRef: panelRef, onEscape: onClose })

  useEffect(() => {
    if (privateTab) return
    const current = createExtensionPanelController(installedExtensions, setState)
    controller.current = current
    void current.refresh()
    const timer = window.setInterval(() => void current.refresh(), 5000)
    return () => {
      current.dispose()
      controller.current = null
      window.clearInterval(timer)
    }
  }, [privateTab])

  useEffect(() => {
    const position = () => {
      const button = document.querySelector('[data-nebula-extensions-toggle]')?.getBoundingClientRect()
      setAnchor(button ? { left: button.left, bottom: button.bottom } : null)
      setViewportWidth(window.innerWidth)
      // Under the button when it is known; otherwise below the menu as before.
      setResolvedTop(button ? Math.max(12, button.bottom + 10) : Math.max(12, Math.min(top, window.innerHeight - 440)))
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-nebula-extensions-toggle]')) return
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) onClose()
    }
    position()
    window.addEventListener('resize', position)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('resize', position)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', onClose)
    }
  }, [top, onClose])

  const run = async (id: string, action: 'popup' | 'options' | 'side-panel' | 'click' | 'enable' | 'disable' | 'remove') => {
    if (privateTab) return
    await controller.current?.run(id, async () => {
      if (action === 'click') {
        const result = await clickExtension(id)
        // The extension answered with an error or has no click handler: say so
        // instead of looking like nothing happened.
        if (!result.dispatched && !result.openPanelOnActionClick) throw new Error(copy.clickNoResponse)
      } else if (action === 'popup' || action === 'options' || action === 'side-panel') await openExtension(id, action)
      else await manageExtension(id, action)
    })
  }

  const trySite = async () => {
    if (!activeUrl || privateTab) return
    await controller.current?.run('site', () => browseWithExtensions(activeUrl))
  }

  const selectedItem = items.find(item => item.id === selectedId)
  const width = panelWidth(items.length, !!selectedItem)
  const canTrySite = !privateTab && items.some(item => item.isolatedProfile)
  return <section ref={panelRef} id="nebula-extensions-panel" role="dialog" aria-modal="true"
    aria-labelledby="nebula-extensions-title" tabIndex={-1} className={styles.panel}
    style={{ top: resolvedTop, left: panelLeft(anchor?.left ?? null, width, viewportWidth), width, maxHeight: `calc(100dvh - ${resolvedTop + 12}px)` }}>
    <header className={styles.header}>
      <h2 id="nebula-extensions-title">{copy.title}</h2>
      <div className={styles.headerButtons}>
        {canTrySite && <button type="button" className={styles.close} data-extensions-try-site title={copy.trySite} aria-label={copy.trySite}
          disabled={!!pending || !activeUrl || !/^https?:\/\//i.test(activeUrl)} onClick={() => void trySite()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>
        </button>}
        <button type="button" className={styles.close} data-extensions-manage title={copy.manage} aria-label={copy.manage} onClick={onManage}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button type="button" onClick={onClose} aria-label={t('close')} className={styles.close}>×</button>
      </div>
    </header>
    <div className={styles.content}>
      {privateTab ? <p>{copy.privateUnavailable}</p> : <>
        {loading ? <p role="status">{installCopy.checking}</p> : !items.length && <p>{copy.empty}</p>}
        <ul className={styles.grid} style={{ gridTemplateColumns: `repeat(${panelColumns(items.length)}, ${TILE_WIDTH}px)`, gap: TILE_GAP }}>{items.map(item => {
          const entry = EXTENSION_CATALOG.find(entry => entry.id === item.id)
          const name = entry?.name ?? item.id
          const action = primaryExtensionAction(item)
          const selected = selectedId === item.id
          return <li key={item.id} data-installed-extension={item.id}
            className={`${styles.tile} ${item.enabled ? '' : styles.off} ${selected ? styles.selected : ''}`}>
            {/* Only the logo, as in Chrome's extensions menu; the name is its tooltip.
                Click runs the extension; right click (or the menu key) opens the details. */}
            <button type="button" className={styles.tileMain} data-extension-primary={item.id} title={name} aria-label={name}
              aria-haspopup="true" aria-expanded={selected} disabled={!!pending}
              onClick={() => action ? void run(item.id, action) : setSelectedId(item.id)}
              onContextMenu={event => { event.preventDefault(); setSelectedId(selected ? null : item.id) }}>
              <span className={styles.icon} aria-hidden="true">{item.iconDataUrl
                ? <img src={item.iconDataUrl} alt="" />
                : name.slice(0, 2)}</span>
            </button>
          </li>
        })}</ul>
        {(selectedItem ? [selectedItem] : []).map(item => {
          const entry = EXTENSION_CATALOG.find(entry => entry.id === item.id)
          const primaryLabel = item.primaryView === 'side-panel' ? copy.openPanel : copy.open
          return <section key={item.id} className={styles.details} data-extension-detail={item.id}>
            <div className={styles.identity}><span className={styles.icon} aria-hidden="true">{item.iconDataUrl
              ? <img src={item.iconDataUrl} alt="" />
              : entry?.name.slice(0, 2) ?? 'EX'}</span>
              <div><strong>{entry?.name ?? item.id}</strong><small>{item.version} · {item.enabled ? installCopy.installed : copy.disabled}{item.isolatedProfile && ` · ${copy.trialProfile}`}</small></div>
            </div>
            <p>{copy.limited}</p>
            {item.isolatedProfile && <p>{copy.separateSession}</p>}
            {item.primaryView === 'side-panel' && <p className={styles.experimental}>{copy.experimentalPanel}</p>}
            {item.needsActionHost && <p className={styles.experimental}>{copy.clickBeta}</p>}
            {item.needsSidePanel && !item.hasSidePanel && !item.needsActionHost && <p className={styles.limitation}>{copy.missingSidePanel}</p>}
            {item.requiresNativeApp && <p className={styles.limitation}>{copy.requiresNativeApp}</p>}
            {!item.metadataAvailable && <p className={styles.limitation}>{copy.metadataUnavailable}</p>}
            {item.enabled && item.runsInProfile && <p className={styles.profileStatus}>{copy.runsInProfile}</p>}
            <div className={styles.actions}>
              {item.needsActionHost && <button type="button" data-extension-click={item.id} disabled={!!pending || !item.enabled} onClick={() => void run(item.id, 'click')}>{copy.clickLabel}</button>}
              {item.primaryView && <button type="button" disabled={!!pending || !item.enabled} onClick={() => void run(item.id, item.primaryView!)}>{primaryLabel}</button>}
              {item.hasSidePanel && item.primaryView !== 'side-panel' && <button type="button" disabled={!!pending || !item.enabled} onClick={() => void run(item.id, 'side-panel')}>{copy.openPanel}</button>}
              {item.hasOptions && <button type="button" disabled={!!pending || !item.enabled} onClick={() => void run(item.id, 'options')}>{copy.options}</button>}
              <button type="button" disabled={!!pending} onClick={() => void run(item.id, item.enabled ? 'disable' : 'enable')}>{item.enabled ? copy.disable : installCopy.enable}</button>
              <button type="button" disabled={!!pending} onClick={() => { setSelectedId(null); void run(item.id, 'remove') }}>{installCopy.remove}</button>
            </div>
          </section>
        })}
      </>}
      {!privateTab && pending && <p role="status">{installCopy.checking}</p>}
      {!privateTab && error && <p role="alert" className={styles.error}>{installCopy.failed}<small>{error}</small></p>}
    </div>
  </section>
}
