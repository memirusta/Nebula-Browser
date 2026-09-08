import { APP_VERSION } from './appVersion'
import { ONBOARDING_COMPLETE_KEY } from './onboarding'

export const STORE_RECOVERY_NOTICE_VERSION = '1.8.5'
export const STORE_RECOVERY_NOTICE_SEEN_KEY =
  'nebula-store-recovery-notice-1.8.5'

interface NoticeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): NoticeStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function shouldShowStoreRecoveryNotice(
  storage: NoticeStorage | null = browserStorage(),
  appVersion: string = APP_VERSION,
): boolean {
  if (!storage || appVersion !== STORE_RECOVERY_NOTICE_VERSION) return false

  try {
    return (
      storage.getItem(ONBOARDING_COMPLETE_KEY) === '1' &&
      storage.getItem(STORE_RECOVERY_NOTICE_SEEN_KEY) !== '1'
    )
  } catch {
    return false
  }
}

export function markStoreRecoveryNoticeSeen(
  storage: NoticeStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(STORE_RECOVERY_NOTICE_SEEN_KEY, '1')
  } catch {
    // A blocked storage write should not prevent the user from continuing.
  }
}
