/**
 * What a unit's combat state IS, in words a player can act on (pass C2/C4,
 * D1-D3; docs/polish/combat-states.md §3-§4). Pure: no DOM, no `t()`, no
 * `Sim` -- the caller hands it the few numbers it reads off `sim.state`, and
 * a test hands it literals.
 *
 * The sim's own constants are COPIED here, never imported: `@lions/sim`
 * does not export its tuning, and this lane does not change the sim. The
 * copies are pinned against `packages/sim/src/tuning.ts` as TEXT by
 * `combat-state.test.ts` (the `PROJ_SPEED` precedent, `units/missiles.ts`),
 * so a retune that is not carried here goes red rather than lying.
 */

/** Q16.16, as the sim stores them. */
const Q = 65536;
/** `tuning.ts` PIN_AT, Q16.16 (0.70): a unit goes to ground above this. */
export const PIN_AT_Q = 45875;
/** `tuning.ts` UNPIN_AT, Q16.16 (0.45): ...and gets up below this. */
export const UNPIN_AT_Q = 29491;
/** `tuning.ts` SUPP_DECAY, Q16.16: suppression multiplied by this a tick. */
export const SUPP_DECAY_Q = 65046;
/** `tuning.ts` SUPP_K, Q16.16 (1.5): aim x 1 / (1 + k S). */
export const SUPP_K_Q = 98304;
/** `tuning.ts` ROUT_AFTER_TICKS: a soft unit pinned this long breaks. */
export const ROUT_AFTER_TICKS = 200;
export const TICKS_PER_SECOND = 20;

/** Below this a unit is steady: the card says nothing (aim -18% at most). */
export const SHAKEN_FROM = 0.15;

export type CombatBand = 'steady' | 'shaken' | 'suppressed' | 'pinned' | 'broken';

/**
 * The band, highest first. Pinned and broken are the sim's own flags; the
 * two below them are read off suppression. The sim's hysteresis does the
 * rest with no rule here: a unit rising past 0.45 reads "suppressed" until
 * it pins at 0.70, and one unpinning at 0.45 drops straight to "shaken".
 */
export function combatBand(suppression: number, pinned: boolean, routed: boolean): CombatBand {
  if (routed) return 'broken';
  if (pinned) return 'pinned';
  if (suppression >= UNPIN_AT_Q / Q) return 'suppressed';
  if (suppression >= SHAKEN_FROM) return 'shaken';
  return 'steady';
}

/** The aim this suppression costs the unit's own fire, whole percent:
 *  `1 - 1 / (1 + k S)`, the sim's `suppressionMod`. */
export function aimPenaltyPct(suppression: number): number {
  return Math.round((1 - 1 / (1 + (SUPP_K_Q / Q) * Math.max(0, suppression))) * 100);
}

/**
 * Seconds until a pinned unit gets up once the fire stops: the ticks the
 * sim's own decay takes to bring `suppression` under UNPIN_AT, counted the
 * way the sim counts them (one multiply a tick). A broken unit rallies at
 * the same moment. Rounded UP to a whole second -- "~6 s" must never be an
 * underestimate the player plans on.
 */
export function recoverySeconds(suppression: number): number {
  const unpin = UNPIN_AT_Q / Q;
  if (suppression < unpin) return 0;
  const decay = SUPP_DECAY_Q / Q;
  const ticks = Math.floor(Math.log(unpin / suppression) / Math.log(decay)) + 1;
  return Math.ceil(ticks / TICKS_PER_SECOND);
}

/**
 * Seconds until a pinned SOFT unit breaks, or null when it cannot: armour
 * never breaks, nor does an immobilised unit (the sim's own rule), nor one
 * already broken. `ticksPinned` is how long it has been pinned without a
 * break -- the caller counts it from the unit's own `pinned` event.
 */
export function breakSeconds(ticksPinned: number, soft: boolean, mobilityKilled: boolean): number | null {
  if (!soft || mobilityKilled) return null;
  const left = ROUT_AFTER_TICKS - Math.max(0, ticksPinned);
  if (left <= 0) return null;
  return Math.ceil(left / TICKS_PER_SECOND);
}

/** The meter's two cells, 0..1 each: shaken (0.15 -> 0.45) and suppressed
 *  (0.45 -> 0.70); `pin` lit once the unit is pinned or broken. */
export function suppressionMeter(suppression: number, pinned: boolean, routed: boolean): { shaken: number; suppressed: number; pin: boolean } {
  const pin = pinned || routed;
  if (pin) return { shaken: 1, suppressed: 1, pin };
  const unpin = UNPIN_AT_Q / Q;
  const pinAt = PIN_AT_Q / Q;
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  return {
    shaken: clamp((suppression - SHAKEN_FROM) / (unpin - SHAKEN_FROM)),
    suppressed: clamp((suppression - unpin) / (pinAt - unpin)),
    pin,
  };
}

export type HpWord = 'damaged' | 'critical' | null;

/** A word beside the hp numbers: under half, "damaged"; under a quarter,
 *  "critical" -- the HP bar's own tone edges (`hpTone`). */
export function hpWord(pct: number): HpWord {
  if (pct <= 0.25) return 'critical';
  if (pct <= 0.5) return 'damaged';
  return null;
}

export type VehicleDamage = 'outOfAction' | 'gunOut' | 'immobilised' | null;

/** One headline per vehicle: both kills is "out of action". */
export function vehicleDamage(mobilityKilled: boolean, firepowerKilled: boolean): VehicleDamage {
  if (mobilityKilled && firepowerKilled) return 'outOfAction';
  if (firepowerKilled) return 'gunOut';
  if (mobilityKilled) return 'immobilised';
  return null;
}
