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
 * No DOM, no Pixi, no sim state. `reason` is passed straight through
 * untranslated -- it is the sim's own event text (`e.reason`, e.g. "fire
 * into protected structure (clinic)"), data rather than chrome, the same
 * "Data text stays data" rule `describeMissionEvent`'s own `unit`/`type` ids
 * follow.
 */
import { t } from '../i18n/t';
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
 *
 * A function, not the plain string constant this used to be (lesson from
 * `role.ts`'s `ROLE_LABEL` and `grade-copy.ts`'s `tierName`/`tierLine`): a
 * module-level value resolved once at import time would freeze in whatever
 * locale was active before `main.ts`'s boot ever calls `setCatalogue`, and
 * render plain English under `?pseudo=1` forever. Called fresh from
 * `roeNotice` below, the same way those two call `t()` on every access.
 * `roe-notice.test.ts` calls it as `protectedZoneHint()` for the same
 * reason.
 */
export function protectedZoneHint(): string {
  return t('roe.protectedZoneHint');
}

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
  const head = t('roe.notice.head', { penalty, reason, score });

  // Already below the floor. The mission is lost whatever else is on screen,
  // and saying so plainly beats leaving the player to infer it from a number.
  if (failBelow !== undefined && score < failBelow) {
    return [t('roe.notice.lost', { head, floor: failBelow }), 'bad'];
  }

  const hint = first && isProtectedZoneReason(reason) ? ` — ${protectedZoneHint()}` : '';

  if (failBelow !== undefined && score - failBelow <= WARN_MARGIN) {
    return [t('roe.notice.warn', { head, above: score - failBelow, floor: failBelow, hint }), 'bad'];
  }

  return [t('roe.notice.plain', { head, hint }), 'bad'];
}
