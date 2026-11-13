/**
 * The retry of a site without Nebula's protections, which a person asks for on the error page of a cut connection. It is a
 * trial: the exception is added, the site is loaded again, and only what the load shows decides what happens next.
 *
 *   it loads        -> the person is asked whether the protections stay off for this site (no: they are turned back on)
 *   it does not     -> the exception is taken away again and the person is told that the protections stay on, because
 *                      the cause was not them
 *
 * Kept free of imports so tests can run it with stand-ins for the browser.
 */
export interface CompatibilityTrialSteps {
  /** Turns the protections off for the site (and saves that). */
  addException(): Promise<void>
  /** Turns them back on. */
  removeException(): Promise<void>
  /** Loads the site again. */
  navigate(): Promise<void>
  /** Waits for that load to end; true when the tab shows the site, false when it shows the error page again. */
  showsTheSite(): Promise<boolean>
  /** "It loaded with the protections off. Keep them off?" */
  askToKeep(): Promise<boolean>
  /** "It did not help, so the protections stay on." */
  tellItDidNotHelp(): Promise<void>
}

export type CompatibilityTrialResult = 'kept' | 'reverted' | 'did-not-help'

export async function runCompatibilityTrial(steps: CompatibilityTrialSteps): Promise<CompatibilityTrialResult> {
  await steps.addException()
  try {
    await steps.navigate()
    if (await steps.showsTheSite()) {
      if (await steps.askToKeep()) return 'kept'
      await steps.removeException()
      return 'reverted'
    }
  } catch (error) {
    await steps.removeException()
    throw error
  }
  await steps.removeException()
  await steps.tellItDidNotHelp()
  return 'did-not-help'
}
