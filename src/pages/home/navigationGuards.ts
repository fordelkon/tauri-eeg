/**
 * Navigation decisions shared by the Home shell's `requestNavigation`.
 *
 * Kept as pure functions so the guard logic stays testable in the node vitest
 * environment without mounting the shell.
 */

/** Route the effect-evaluation wizard lives on. */
export const EFFECT_EVALUATION_PATH = '/effect-evaluation';

/**
 * Whether the free-recording "leaving this page" confirm may be skipped.
 *
 * Returning to the effect-evaluation wizard while its regulation window is
 * live is the instructed path — the regulation-page countdown banner tells
 * the operator to go back there — and the free recording the confirm worries
 * about belongs to that very wizard run, so prompting is pure friction. The
 * paradigm-session hard block and the scale gate keep their own precedence
 * and are unaffected by this bypass.
 */
export function shouldBypassRecordingConfirm(
  targetPath: string,
  regulationWindowOpen: boolean,
): boolean {
  return targetPath === EFFECT_EVALUATION_PATH && regulationWindowOpen;
}
