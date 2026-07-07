export const ONBOARDING_COMPLETE_KEY = 'nebula-onboarding-complete-v1'
export const ONBOARDING_IMPORTED_SHORTCUTS_KEY = 'nebula-onboarding-imported-shortcuts'
export const ONBOARDING_RESUME_STEP_KEY = 'nebula-onboarding-resume-step'

export type OnboardingStep = 'welcome' | 'bookmarks' | 'profile' | 'googleLink' | 'done'

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === '1'
  } catch {
    return false
  }
}

export function completeOnboarding(): void {
  localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1')
}

export function saveOnboardingResumeStep(step: OnboardingStep): void {
  sessionStorage.setItem(ONBOARDING_RESUME_STEP_KEY, step)
}

export function peekOnboardingResumeStep(): OnboardingStep | null {
  const value = sessionStorage.getItem(ONBOARDING_RESUME_STEP_KEY)
  if (value === 'welcome' || value === 'bookmarks' || value === 'profile' || value === 'googleLink' || value === 'done') {
    return value
  }
  return null
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

export function saveOnboardingImportedShortcuts(shortcuts: import('./types').Shortcut[]): void {
  sessionStorage.setItem(ONBOARDING_IMPORTED_SHORTCUTS_KEY, JSON.stringify(shortcuts))
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

/** Step to open after Google redirects back (sync, before React effects). */
export function onboardingStepAfterOAuthReturn(): OnboardingStep | undefined {
  if (!isOAuthReturnUrl()) return undefined

  const resume = peekOnboardingResumeStep()
  if (resume === 'profile') return 'googleLink'
  if (resume) return resume
  return 'googleLink'
}
