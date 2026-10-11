/* eslint-disable react/only-export-components -- isolated smoke entry, no Fast Refresh */
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { LocaleProvider, useLocale } from '../../src/hooks/useLocale'
import { useDialogFocusTrap } from '../../src/hooks/useDialogFocusTrap'
import { useModalFocusTrap } from '../../src/hooks/useModalFocusTrap'
import { focusableElements } from '../../src/core/focusableElements'
import { HistoryPanel } from '../../src/components/HistoryPanel/HistoryPanel'
import { NotificationPanel } from '../../src/components/NotificationPanel/NotificationPanel'
import { DownloadManager } from '../../src/components/DownloadManager/DownloadManager'
import { SiteInfoPanel } from '../../src/components/SiteInfoPanel/SiteInfoPanel'
import { PrivateBrowsingPanel } from '../../src/components/PrivateBrowsingPanel/PrivateBrowsingPanel'
import { AppDialogHost } from '../../src/components/AppDialog/AppDialogHost'
import { GuidedTutorial } from '../../src/components/GuidedTutorial/GuidedTutorial'
import { SemiLunarMenu } from '../../src/components/SemiLunarMenu/SemiLunarMenu'
import { RightToolbar } from '../../src/components/RightToolbar/RightToolbar'
import type { DownloadItem } from '../../src/core/download'
import type { NebulaNotification } from '../../src/core/notification'
import '../../src/styles/global.css'

const noop = () => {}
const now = Date.now()
const entries = Array.from({ length: 30 }, (_, i) => ({
  id: String(i), url: `https://example.com/page-${i}`, title: `History ${i}`,
  favicon: '', host: 'example.com', visitedAt: now - i * 1000, visitCount: 1,
}))
const notifications: NebulaNotification[] = entries.map((entry) => ({
  id: entry.id, kind: 'site', title: entry.title, body: 'A long notification. '.repeat(12),
  origin: 'https://example.com', siteName: 'Example', senderName: null, eventKind: null,
  iconUrl: null, notificationTag: null, notificationType: null, targetUrl: entry.url,
  notificationData: null, tabLabel: null, downloadId: null, createdAtMs: now, read: false,
}))
const downloads: DownloadItem[] = entries.map((entry) => ({
  id: entry.id, tabLabel: 'fixture', sourceUrl: entry.url, fileName: `document-${entry.id}.txt`,
  filePath: '', mimeType: 'text/plain', totalBytes: 100, receivedBytes: 100,
  state: 'completed', interruptReason: 0, canResume: false, paused: false,
  dangerReason: null, requiresConfirmation: false, startedAtMs: now,
}))

function Nested({ close }: { close: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useDialogFocusTrap({ active: true, containerRef: ref, onEscape: close })
  return createPortal(<section id="nested" ref={ref} tabIndex={-1}>
    <button id="nested-close" onClick={close}>Close nested</button>
  </section>, document.body)
}

function FocusContents() {
  const [nested, setNested] = useState(false)
  return <>
    <div style={{ display: 'none' }}><button id="hidden-first">Hidden</button></div>
    <button id="first">First</button>
    <button tabIndex={-2}>Programmatic only</button>
    <fieldset disabled><button tabIndex={0}>Disabled fieldset</button></fieldset>
    <div inert><button>Inert</button></div>
    <div aria-hidden="true"><button>Aria hidden</button></div>
    <details id="details"><summary id="summary">Details</summary><button id="detail-action">Detail action</button></details>
    <button id="open-nested" onClick={() => setNested(true)}>Open nested</button>
    <input type="radio" name="test-group" aria-label="Unselected" />
    <input id="selected-radio" type="radio" name="test-group" defaultChecked aria-label="Selected" />
    <button id="last">Last</button>
    <div style={{ display: 'none' }}><button id="hidden-last">Hidden last</button></div>
    {nested && <Nested close={() => setNested(false)} />}
  </>
}

function DialogFixture({ close }: { close: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useDialogFocusTrap({ active: true, containerRef: ref, onEscape: close })
  return <section id="focus" ref={ref} tabIndex={-1}><FocusContents /></section>
}

function ModalFixture() {
  const ref = useRef<HTMLElement>(null)
  useModalFocusTrap(ref)
  return <section id="focus" ref={ref} tabIndex={-1}><FocusContents /></section>
}

function TutorialFixture({ close }: { close: () => void }) {
  const { locale } = useLocale()
  const [step, setStep] = useState(0)
  const lunarWidth = 1100
  const lunarHeight = 152
  return <>
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 20% 20%, #414161, transparent 65%), linear-gradient(140deg, #122b31, #10161f)' }} />
    <SemiLunarMenu shortcuts={[]} dockItemIds={[]} folders={[]} onCreateFolder={() => null} onAddToFolder={() => false}
      onRenameFolder={noop} onNavigate={noop} mode="home" shellViewMode="home" homeAlwaysOpen={false}
      tutorialExpansion={step === 1 ? true : null} tutorialHoverOpen={step === 0} tutorialDemoTab={step === 1}
      tutorialHighlight={step === 0 ? 'edge' : step === 1 ? 'content' : null}
      lunarWidthPx={lunarWidth} lunarHeightPx={lunarHeight} />
    <label data-nebula-tutorial="home-search" style={{ position: 'fixed', top: '55%', left: '50%', transform: 'translateX(-50%)', width: 'min(540px, 70vw)' }}>
      <input aria-label="Search" placeholder="Search or type URL…" style={{ width: '100%', padding: 18, borderRadius: 24, background: '#131b24', border: '1px solid #ffffff30', color: '#ccc' }} />
    </label>
    {step === 3 && <RightToolbar onSettings={noop} onNotifications={noop} onDownloads={noop} onHistory={noop} />}
    <GuidedTutorial open locale={locale} step={step} lunarWidthPx={lunarWidth} lunarHeightPx={lunarHeight}
      onStepChange={setStep} onSkip={close} onComplete={close} />
  </>
}

function Fixture() {
  const { setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const params = new URLSearchParams(location.search)
  const panel = params.get('panel') ?? 'history'
  const variant = params.get('variant') === 'browsing' ? 'browsing' : 'home'
  const close = () => setOpen(false)
  Object.assign(window, { fixture: {
    rerender: () => setRevision((value) => value + 1), setLocale,
    focusable: () => focusableElements(document.querySelector('#focus')!).map((element) => element.id),
  } })
  return <>
    <button id="open" onClick={() => setOpen(true)}>Open panel</button>
    <output id="revision">{revision}</output>
    {open && panel === 'history' && <HistoryPanel entries={entries} hosts={['example.com']}
      closedTabs={[]} previousSession={null} variant={variant} browsingTop={260}
      onOpenUrl={noop} onOpenClosedTab={noop} onOpenPreviousSession={noop}
      onRemoveEntry={noop} onClearFiltered={noop} onClearAll={noop} onClearClosed={noop} onClose={close} />}
    {open && panel === 'notifications' && <NotificationPanel items={notifications} variant={variant} browsingTop={260}
      onMarkRead={noop} onMarkAllRead={noop} onRemove={noop} onClear={noop}
      onOpenOrigin={noop} onOpenDownload={noop} onClose={close} />}
    {open && panel === 'downloads' && <DownloadManager items={downloads} variant={variant} browsingTop={260}
      onAction={async () => {}} onRemove={noop} onClearFinished={noop} onClose={close} />}
    {open && panel === 'site' && <SiteInfoPanel top={260} state={{
      shortcutId: 'fixture', url: 'https://example.com', origin: 'https://example.com', hostname: 'example.com',
      protectionDisabled: false, darkenWebpagesOverride: 'default', permissionPromptsAllowed: true,
      notificationPermission: null, permissions: { camera: 'prompt', microphone: 'prompt', location: 'prompt' },
    }} usage={{ camera: false, microphone: false, location: false, screen: false }}
      onClose={close} onToggleProtection={noop} onSetDarkening={noop}
      onSetNotificationPermission={noop} onResetPermissions={noop} onClearSiteData={noop} />}
    {open && panel === 'private' && <PrivateBrowsingPanel tabs={[]} top={260} onClose={close} onEnd={noop} />}
    {open && panel === 'dialog' && <DialogFixture close={close} />}
    {open && panel === 'modal' && <ModalFixture />}
    {open && panel === 'tutorial' && <TutorialFixture close={close} />}
    <AppDialogHost />
  </>
}

createRoot(document.getElementById('root')!).render(<LocaleProvider><Fixture /></LocaleProvider>)
