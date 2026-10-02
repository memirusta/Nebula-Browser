/**
 * Confirms a released tab really left the Semi-Lunar dome.
 *
 * The native hit-test can report a single false miss while the dedicated
 * WebView is resizing, so a drop only counts as "outside" after two
 * consecutive definite `false` readings. `null` (hit-test unavailable) and
 * `true` never count as outside.
 */
export async function confirmCursorOutsideLunar(
  isInside: () => Promise<boolean | null>,
  wait: (ms: number) => Promise<void>,
  confirmDelayMs = 50,
): Promise<boolean> {
  if ((await isInside()) !== false) return false
  await wait(confirmDelayMs)
  return (await isInside()) === false
}
