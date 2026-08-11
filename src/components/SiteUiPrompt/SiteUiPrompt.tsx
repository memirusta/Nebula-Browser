import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SiteUiRequest, SiteUiResponse } from '../../platform/tauriSiteUi'
import styles from './SiteUiPrompt.module.css'

interface SiteUiPromptProps {
  request: SiteUiRequest
  pendingCount: number
  onRespond: (response: SiteUiResponse) => void
}

const PERMISSION_LABELS: Record<string, string> = {
  microphone: 'microphone',
  camera: 'camera',
  geolocation: 'location',
  notifications: 'notifications',
  sensors: 'motion sensors',
  'clipboard-read': 'clipboard',
  'multiple-downloads': 'multiple downloads',
  'file-read-write': 'files',
  autoplay: 'autoplay',
  'local-fonts': 'local fonts',
  'midi-sysex': 'MIDI devices',
  'window-management': 'window management',
}

function originText(uri: string, fallback: string): string {
  try {
    return new URL(uri).origin
  } catch {
    return fallback
  }
}

export function SiteUiPrompt({ request, pendingCount, onRespond }: SiteUiPromptProps) {
  const [text, setText] = useState(request.defaultText ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(request.defaultText ?? '')
    setUsername('')
    setPassword('')
    setRemember(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [request])

  const presentation = useMemo(() => {
    if (request.requestType === 'permission') {
      const permission = PERMISSION_LABELS[request.permissionKind ?? ''] ?? request.permissionKind ?? 'this feature'
      return {
        eyebrow: 'Site permission',
        title: `${request.title} wants to use ${permission}`,
        message: `Allow ${originText(request.uri, request.title)} to access ${permission}?`,
        accept: 'Allow',
        cancel: 'Block',
      }
    }

    if (request.requestType === 'basic-auth') {
      return {
        eyebrow: 'Authentication required',
        title: `Sign in to ${request.title}`,
        message: request.challenge
          ? `The server requested credentials (${request.challenge}).`
          : 'The server requested a username and password.',
        accept: 'Sign in',
        cancel: 'Cancel',
      }
    }

    if (request.requestType === 'protocol-handler') {
      const scheme = request.permissionKind ?? 'link'
      const label = scheme === 'mailto' ? 'email links' : `${scheme}: links`
      return {
        eyebrow: 'Protocol handler',
        title: `${request.title} wants to open ${label}`,
        message: `Allow ${originText(request.uri, request.title)} to handle ${label} in Nebula?`,
        accept: 'Allow',
        cancel: 'Block',
      }
    }

    if (request.requestType === 'external-uri') {
      const scheme = request.permissionKind ?? 'external'
      return {
        eyebrow: 'Open external app?',
        title: `${request.title} wants to open another application`,
        message: `Allow this site to open a ${scheme}: link outside Nebula?`,
        accept: 'Open',
        cancel: 'Block',
      }
    }

    switch (request.dialogKind) {
      case 'beforeunload':
        return {
          eyebrow: 'Leave site?',
          title: request.title,
          message: request.message || 'Changes you made may not be saved.',
          accept: 'Leave',
          cancel: 'Stay',
        }
      case 'confirm':
        return {
          eyebrow: 'Site message',
          title: request.title,
          message: request.message,
          accept: 'OK',
          cancel: 'Cancel',
        }
      case 'prompt':
        return {
          eyebrow: 'Site input',
          title: request.title,
          message: request.message,
          accept: 'OK',
          cancel: 'Cancel',
        }
      default:
        return {
          eyebrow: 'Site message',
          title: request.title,
          message: request.message,
          accept: 'OK',
          cancel: '',
        }
    }
  }, [request])

  const submit = () => {
    onRespond({
      accepted: true,
      text,
      username,
      password,
      remember,
    })
  }

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nebula-site-ui-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && request.dialogKind !== 'alert') {
            event.preventDefault()
            onRespond({ accepted: false })
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <div className={styles.headerRow}>
          <div className={styles.siteMark}>{request.title.slice(0, 1).toUpperCase()}</div>
          <div className={styles.heading}>
            <span>{presentation.eyebrow}</span>
            <h2 id="nebula-site-ui-title">{presentation.title}</h2>
          </div>
          {pendingCount > 1 && <span className={styles.queueBadge}>+{pendingCount - 1}</span>}
        </div>

        <p className={styles.message}>{presentation.message}</p>
        <div className={styles.origin}>{originText(request.uri, request.uri)}</div>

        {request.requestType === 'script-dialog' && request.dialogKind === 'prompt' && (
          <input
            ref={inputRef}
            className={styles.input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Site prompt response"
          />
        )}

        {request.requestType === 'basic-auth' && (
          <div className={styles.formGrid}>
            <input
              ref={inputRef}
              className={styles.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              autoComplete="username"
            />
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
            />
          </div>
        )}

        {request.requestType === 'permission' && (
          <label className={styles.rememberRow}>
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span>Remember this choice for this site</span>
          </label>
        )}

        <div className={styles.actions}>
          {presentation.cancel && (
            <button type="button" className={styles.secondary} onClick={() => onRespond({ accepted: false })}>
              {presentation.cancel}
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            onClick={submit}
            disabled={request.requestType === 'basic-auth' && !username.trim()}
          >
            {presentation.accept}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
