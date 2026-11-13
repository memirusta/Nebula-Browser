/**
 * What every part of the window does while the guided tour runs, worked out from the tour's state alone.
 *
 * The tour is shown in the main window, but the menu (Semi-Lunar) lives in another webview and the home page has its own
 * pieces. Each of them used to decide for itself ("is the tour open and is it step 1?"). Now they all ask this one
 * function, so a new step is described in one place, and when the tour is closed the answer is "change nothing": nothing
 * has to be switched back, and a tour that was cut short cannot leave a part of the window in tour mode.
 *
 * Kept free of imports so tests can run it as it is.
 */

/** What each step of the tour is about, in order. The words of the steps are in tutorial.ts, which has to follow this. */
export const TUTORIAL_TARGETS = ['top-edge', 'semi-lunar', 'home-search', 'home-widgets', 'home-toolbar', 'shield'] as const

export type TutorialTarget = (typeof TUTORIAL_TARGETS)[number]

/**
 * The opening scene of the first tour, played once, right after the first-run wizard: the screen goes dark and asks for the
 * pointer at the top (`waiting`); once the menu has opened it takes its time and a light runs along its rim (`opening`);
 * then the tour goes on with the tabs. The tour started later from Settings has no such scene (`null`).
 */
export type TutorialIntro = 'waiting' | 'opening' | null

export interface TutorialModeState {
  open: boolean
  step: number
  /** The first step's menu was opened with its button instead of the pointer. */
  menuShown?: boolean
  intro?: TutorialIntro
}

export interface TutorialSurfaces {
  /** True while the tour runs. */
  active: boolean
  /** What the current step is about. */
  target: TutorialTarget | null
  /** The menu (Semi-Lunar). `null` means: behave as the settings say. */
  semiLunar: {
    expansion: boolean | null
    /** The menu opens when the pointer rests at the top edge, even on the home page. */
    hoverOpen: boolean
    /** Four sample tabs are drawn in it, because the person may have none open. */
    demoTab: boolean
    highlight: 'edge' | 'content' | null
    /** The menu is shown dimmed, because the step is about something else. */
    dimmed: boolean
    /** The menu opens slowly (the opening scene). */
    slowOpen: boolean
    /** A light runs once along the rim of the menu, and its glow swells once. */
    sweep: boolean
    /** `false` forces the "always open on the home page" setting off; `null` leaves it as it is. */
    homeAlwaysOpen: false | null
  }
  /** The opening scene that is playing, if any (always on the first step). */
  intro: TutorialIntro
  /**
   * The steps after the first are all on the screen at once, each by what it is about, and only the current one is lit: the menu
   * stays open and the buttons on the right stay shown for all of them.
   */
  together: boolean
  /** The buttons on the right of the home page are shown. */
  toolbarVisible: boolean
}

const UNCHANGED: TutorialSurfaces = {
  active: false,
  target: null,
  semiLunar: { expansion: null, hoverOpen: false, demoTab: false, highlight: null, dimmed: false, slowOpen: false, sweep: false, homeAlwaysOpen: null },
  intro: null,
  together: false,
  toolbarVisible: false,
}

export function tutorialTargetAt(step: number): TutorialTarget {
  const index = Number.isFinite(step) ? Math.max(0, Math.min(TUTORIAL_TARGETS.length - 1, Math.trunc(step))) : 0
  return TUTORIAL_TARGETS[index]
}

export function tutorialSurfaces(state: TutorialModeState): TutorialSurfaces {
  if (!state.open) return UNCHANGED
  const target = tutorialTargetAt(state.step)
  const onEdge = target === 'top-edge'
  const onTabs = target === 'semi-lunar'
  const intro = onEdge ? (state.intro ?? null) : null
  const together = !onEdge
  return {
    active: true,
    target,
    semiLunar: {
      expansion: together || (onEdge && (state.menuShown === true || intro === 'opening')) ? true : null,
      hoverOpen: onEdge,
      demoTab: together,
      highlight: onEdge ? 'edge' : onTabs ? 'content' : null,
      dimmed: together && !onTabs,
      slowOpen: intro !== null,
      sweep: intro === 'opening',
      homeAlwaysOpen: onEdge ? false : null,
    },
    intro,
    together,
    toolbarVisible: together,
  }
}
