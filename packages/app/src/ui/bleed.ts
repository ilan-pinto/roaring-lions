/**
 * The bleed ring (GH-707 P2, spec §7): how much of a down wounded's clock is left, for the unit
 * card. DOM and the HUD only -- "no status marks in the world".
 *
 * Pure: reads the sim's public columns (`woundState`, `bleedTicks`, `woundParent`, `carriedBy`)
 * and unit types, writes nothing. The FULL bleed is the PARENT type's `hull.wounds.bleed_s`,
 * which the sim stamps into `bleedTicks` the tick the man falls and then only counts down; so
 * the fraction is `bleedTicks / full`, where `full` is found the way the sim chose it:
 *
 *  - a man who fell from a squad that still exists (`woundParent` >= 0): that squad's type;
 *  - a man downed in place (a civilian), or the squad's last man (parent -1, the squad dead):
 *    his OWN type if it carries `wounds`, otherwise the first type whose `wounds.typeId` is his
 *    type (the squad type that sheds his kind).
 *
 * Held means the clock is not running: STABILISED (a medic finished) or carried. Admitted and
 * gone wounded are off the board and never reach a card.
 */
import { TICKS_PER_SECOND, WOUND_DOWN, WOUND_STABILISED } from '@lions/sim';

/** The slice of a unit type this reads. */
export interface BleedType {
  readonly id: string;
  readonly isWounded: boolean;
  readonly wounds: { readonly bleedTicks: number; readonly typeId: string } | null;
}

/** The slice of the sim this reads (structural, so a test hands a literal). */
export interface BleedSim {
  /** `Sim.woundBleedRate`: ticks of bleed per tick now -- 0 held/tended/carried/stabilised, 2 pinned, else 1. */
  woundBleedRate(id: number): number;
  readonly state: {
    readonly typeIdx: ArrayLike<number>;
    readonly woundState: ArrayLike<number>;
    readonly bleedTicks: ArrayLike<number>;
    readonly woundParent: ArrayLike<number>;
  };
  readonly unitTypes: readonly BleedType[];
}

export interface BleedView {
  /** Remaining bleed, 0..1. */
  readonly fraction: number;
  /** Whole seconds left at the current rate (rounded up). */
  readonly seconds: number;
  /** The clock is not running: stabilised, or carried. */
  readonly held: boolean;
  readonly stabilised: boolean;
}

/** The ticks a fresh wound of entity `id` bleeds for, or 0 when no type says. */
export function bleedFullTicks(sim: BleedSim, id: number): number {
  const st = sim.state;
  const parent = st.woundParent[id];
  if (parent >= 0) {
    const w = sim.unitTypes[st.typeIdx[parent]]?.wounds;
    if (w) return w.bleedTicks;
  }
  const own = sim.unitTypes[st.typeIdx[id]];
  if (own?.wounds) return own.wounds.bleedTicks;
  if (own) {
    for (const u of sim.unitTypes) if (u.wounds !== null && u.wounds.typeId === own.id) return u.wounds.bleedTicks;
  }
  return 0;
}

/** The card's bleed ring for entity `id`, or null when it is not a down wounded (the card then
 *  draws nothing at all) or no type says how long a wound bleeds. */
export function bleedView(sim: BleedSim, id: number): BleedView | null {
  const st = sim.state;
  const w = st.woundState[id];
  if (w !== WOUND_DOWN && w !== WOUND_STABILISED) return null;
  const full = bleedFullTicks(sim, id);
  if (full <= 0) return null;
  const left = Math.max(0, Math.min(full, st.bleedTicks[id]));
  const stabilised = w === WOUND_STABILISED;
  const rate = sim.woundBleedRate(id);
  return {
    fraction: left / full,
    // At the sim's own current rate (a pinned man bleeds twice as fast); held shows no countdown.
    seconds: Math.ceil(left / (rate > 0 ? rate : 1) / TICKS_PER_SECOND),
    held: rate === 0,
    stabilised,
  };
}
