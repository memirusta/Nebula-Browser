export type AppDialogKind = 'alert' | 'confirm'

export interface AppDialogOptions {
  acceptLabel?: string
  cancelLabel?: string
}

export interface AppDialogRequest {
  id: number
  kind: AppDialogKind
  title: string
  message: string
  acceptLabel?: string
  cancelLabel?: string
}

interface PendingAppDialog extends AppDialogRequest {
  resolve: (accepted: boolean) => void
}

let nextDialogId = 1
let pendingDialogs: PendingAppDialog[] = []
let dialogSnapshot: AppDialogRequest[] = []
const listeners = new Set<() => void>()

function publishSnapshot() {
  dialogSnapshot = pendingDialogs.map(
    ({ id, kind, title, message, acceptLabel, cancelLabel }) => ({
      id,
      kind,
      title,
      message,
      acceptLabel,
      cancelLabel,
    }),
  )
  listeners.forEach((listener) => listener())
}

function enqueueDialog(
  kind: AppDialogKind,
  message: string,
  title: string,
  options: AppDialogOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    pendingDialogs = [
      ...pendingDialogs,
      {
        id: nextDialogId++,
        kind,
        title,
        message,
        acceptLabel: options.acceptLabel,
        cancelLabel: options.cancelLabel,
        resolve,
      },
    ]
    publishSnapshot()
  })
}

export function showAppAlert(
  message: string,
  title = 'Nebula',
  options: AppDialogOptions = {},
): Promise<void> {
  return enqueueDialog('alert', message, title, options).then(() => undefined)
}

export function showAppConfirmation(
  message: string,
  title = 'Nebula',
  options: AppDialogOptions = {},
): Promise<boolean> {
  return enqueueDialog('confirm', message, title, options)
}

export function subscribeAppDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAppDialogsSnapshot(): AppDialogRequest[] {
  return dialogSnapshot
}

export function resolveAppDialog(id: number, accepted: boolean) {
  const dialog = pendingDialogs.find((candidate) => candidate.id === id)
  if (!dialog) return

  pendingDialogs = pendingDialogs.filter((candidate) => candidate.id !== id)
  publishSnapshot()
  dialog.resolve(accepted)
}
