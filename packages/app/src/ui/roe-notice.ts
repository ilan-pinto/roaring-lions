/**
 * How an ROE deduction is narrated to the player.
 *
 * Split out of `describeMissionEvent` because the interesting part is a
 * decision, not a string: the runtime already announces every deduction, but
 * announcing them all identically is what made an ROE loss arrive as a
 * surprise. `beit_sahwan_3_clearance` crossed its floor at 217s and played on
 * for another hundred seconds before the player was told they had lost.
 * See issue 127 -- referenced without a hash because validate:ui reads
 * a hash followed by three hex digits as a colour literal, allowlist-free.
 *
 * The score is a running number and the loss is a threshold, so the only
 * moment worth raising your voice is when the gap between them gets small --
 * while it can still be closed. That is a pure function of the event and the
 * mission's own `fail_below`, which is why it can live here and be tested
 * without a DOM, a sim, or a mission.
 *
 * No DOM, no Pixi, no sim state.
 */
import type { Tone } from './hud';

/**
 * How close to the floor counts as close.
 *
 * Eleven points is a little over two deductions at the flagged-zone rate of
 * five, so the warning arrives with room to act rather than as an obituary.
 * Ten would fire exactly one deduction before the end and read as taunting.
 */
export const WARN_MARGIN = 11;

/** Reasons that name a protected zone, which the player can stop doing. */
export function isProtectedZoneReason(reason: string): boolean {
  return reason.includes('protected structure');
}

/**
 * The advice attached the first time ordnance lands in a flagged zone.
 *
 * Deliberately names the mechanism rather than the number: a unit does not
 * choose which of its weapons it fires, only where it stands, so "pull the
 * heavy weapons back" is the actionable form and "collateral_risk >= 0.3" is
 * not.
 */
export const PROTECTED_ZONE_HINT =
  'heavy weapons are doing this — pull them off the zone and clear it with infantry';

/**
 * Narrate one `roe` mission event.
 *
 * `first` is whether this reason has been narrated before, and is the
 * caller's business: the runtime emits the same reason repeatedly under a
 * cooldown, and repeating the advice every ten seconds would train the player
 * to ignore the notice stack that the advice is trying to use.
 */
export function roeNotice(
  penalty: number,
  reason: string,
  score: number,
  failBelow: number | undefined,
  first: boolean
): [string, Tone] {
  const head = `<b>ROE −${penalty}</b> (${reason}) → ${score}`;

  // Already below the floor. The mission is lost whatever else is on screen,
  // and saying so plainly beats leaving the player to infer it from a number.
  if (failBelow !== undefined && score < failBelow) {
    return [`${head} — <b>BELOW ${failBelow}: THE MISSION IS LOST</b>`, 'bad'];
  }

  const hint = first && isProtectedZoneReason(reason) ? ` — ${PROTECTED_ZONE_HINT}` : '';

  if (failBelow !== undefined && score - failBelow <= WARN_MARGIN) {
    return [`${head} — <b>${score - failBelow} above the ${failBelow} floor</b>${hint}`, 'bad'];
  }

  return [`${head}${hint}`, 'bad'];
}
