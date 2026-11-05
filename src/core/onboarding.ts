export const ONBOARDING_COMPLETE_KEY = 'nebula-onboarding-complete-v1'
export const ONBOARDING_IMPORTED_SHORTCUTS_KEY = 'nebula-onboarding-imported-shortcuts'
export const ONBOARDING_RESUME_STEP_KEY = 'nebula-onboarding-resume-step'
export const ONBOARDING_RESTORED_KEY = 'nebula-onboarding-restored'

/**
 * Screens in order. `restore` is only shown when the Google account has a Nebula Sync backup, `bookmarks` is
 * the browser-import screen and `home` is the home-screen (region and weather) screen.
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'profile',
  'restore',
  'bookmarks',
  'home',
  'defaultBrowser',
  'done',
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === '1'
  } catch {
    return false
  }
}

export function completeOnboarding(): void {
  localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1')

  try {
    sessionStorage.removeItem(ONBOARDING_RESTORED_KEY)
  } catch {
    // ignore
  }
}

/** Restoring a Sync backup reloads the app; this remembers it did happen, for the summary at the end. */
export function markOnboardingRestored(): void {
  try {
    sessionStorage.setItem(ONBOARDING_RESTORED_KEY, '1')
  } catch {
    // ignore
  }
}

export function wasOnboardingRestored(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_RESTORED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveOnboardingResumeStep(step: OnboardingStep): void {
  sessionStorage.setItem(ONBOARDING_RESUME_STEP_KEY, step)
}

export function peekOnboardingResumeStep(): OnboardingStep | null {
  const value = sessionStorage.getItem(ONBOARDING_RESUME_STEP_KEY)

  // v1.6.x had separate Google-link and Sync-restore pages. Resume those
  // interrupted first-run flows on the new combined profile page.
  if (value === 'googleLink' || value === 'syncRestore') {
    return 'profile'
  }

  return ONBOARDING_STEPS.includes(value as OnboardingStep)
    ? (value as OnboardingStep)
    : null
}

export function peekOnboardingImportedShortcuts(): import('./types').Shortcut[] {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_IMPORTED_SHORTCUTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as import('./types').Shortcut[]) : []
  } catch {
    return []
  }
}

export function takeOnboardingImportedShortcuts(): import('./types').Shortcut[] {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_IMPORTED_SHORTCUTS_KEY)
    if (!raw) return []
    sessionStorage.removeItem(ONBOARDING_IMPORTED_SHORTCUTS_KEY)
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as import('./types').Shortcut[]) : []
  } catch {
    return []
  }
}

export function saveOnboardingImportedShortcuts(
  shortcuts: import('./types').Shortcut[],
): void {
  sessionStorage.setItem(
    ONBOARDING_IMPORTED_SHORTCUTS_KEY,
    JSON.stringify(shortcuts),
  )
}

export function takeOnboardingResumeStep(): OnboardingStep | null {
  const step = peekOnboardingResumeStep()
  sessionStorage.removeItem(ONBOARDING_RESUME_STEP_KEY)
  return step
}

export function isOAuthReturnUrl(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('code') && params.has('state')
}

/**
 * Step to open synchronously before React effects.
 *
 * The saved resume step is also used for non-OAuth reloads, most notably after
 * restoring Nebula Sync settings during first-run setup.
 */
export function onboardingStepAfterOAuthReturn(): OnboardingStep | undefined {
  const resume = peekOnboardingResumeStep()

  if (!isOAuthReturnUrl()) {
    return resume ?? undefined
  }

  return resume ?? 'profile'
}
