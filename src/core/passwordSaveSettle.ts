/**
 * When a submitted login may be offered for saving. A password typed into a form is only worth remembering once
 * the site accepted it, and the page shows that by taking the sign-in form away. While the form is still there
 * the sign-in may have failed, and if it is still there after the settle time it did.
 */
export const SAVE_SETTLE_MS = 20_000
/** Polls in a row without a sign-in form, so a page that is only reloading does not count as signed in. */
export const SAVE_FORM_GONE_TICKS = 2

export interface SaveSettleState {
  stagedAt: number
  formGoneTicks: number
}

export type SaveSettleAction = 'wait' | 'show' | 'drop'

export function settleSaveDraft(
  state: SaveSettleState,
  formShown: boolean,
  now: number,
): { action: SaveSettleAction; formGoneTicks: number } {
  if (formShown) {
    return {
      action: now - state.stagedAt >= SAVE_SETTLE_MS ? 'drop' : 'wait',
      formGoneTicks: 0,
    }
  }
  const formGoneTicks = state.formGoneTicks + 1
  return {
    action: formGoneTicks >= SAVE_FORM_GONE_TICKS ? 'show' : 'wait',
    formGoneTicks,
  }
}
