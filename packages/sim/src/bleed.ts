// GH-707: the one reading of a down wounded's bleed clock. Pure and read-only: it reads the
// sim's public wound columns and unit types and writes nothing, so it moves no hash. Integers
// and Q16.16 only (invariant 2); turning the fraction into a float for a ring or a card is the
// CALLER's job, outside this package.
//
// Two consumers read it and must never disagree: the ground ring's arc (render,
// `wounded-read.ts`) and the unit card's countdown (app, `ui/bleed.ts`). The FULL bleed is the
// PARENT type's `wounds.bleedTicks`, which the sim stamps into `bleedTicks` the tick the man
// falls and then only counts down, so the fraction is `bleedTicks / full`, `full` being found
// the way the sim chose it:
//
//  - a man who fell from a squad that still exists (`woundParent` >= 0): that squad's type;
//  - a man downed in place (a civilian), or the squad's last man (parent -1, the squad dead):
//    his OWN type if it carries `wounds`, otherwise the first type whose `wounds.typeId` is his
//    type (the squad type that sheds his kind).

import { ONE, type Fx } from './fixed';
import { TICKS_PER_SECOND } from './sim';
import { WOUND_DOWN, WOUND_STABILISED } from './tuning';
import { scaleDown } from './wounds';

/** The slice of a unit type this reads. */
export interface BleedClockType {
  readonly id: string;
  readonly wounds: { readonly bleedTicks: number; readonly typeId: string } | null;
}

/** The slice of the sim this reads (structural, so a test hands a literal). */
export interface BleedClockSource {
  readonly state: {
    readonly typeIdx: ArrayLike<number>;
    readonly woundState: ArrayLike<number>;
    readonly bleedTicks: ArrayLike<number>;
    readonly woundParent: ArrayLike<number>;
  };
  readonly unitTypes: readonly BleedClockType[];
}

export interface BleedClock {
  /** The clock is stopped by a medic's finish (WOUND_STABILISED); otherwise he is DOWN. */
  readonly stabilised: boolean;
  /** Ticks of bleed left, clamped to 0..fullTicks (or just >= 0 when `fullTicks` is 0). */
  readonly leftTicks: number;
  /** The ticks a fresh wound of his bleeds for, or 0 when no type says. */
  readonly fullTicks: number;
  /** `leftTicks / fullTicks` in Q16.16 (0..ONE), rounded down; ONE when `fullTicks` is 0 (unknown). */
  readonly fraction: Fx;
}

/** The ticks a fresh wound of entity `id` bleeds for, or 0 when no type says. */
export function bleedFullTicks(sim: BleedClockSource, id: number): number {
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

/** Entity `id`'s bleed clock, or null when he is not a DOWN or STABILISED wounded. */
export function bleedClock(sim: BleedClockSource, id: number): BleedClock | null {
  const st = sim.state;
  const w = st.woundState[id];
  if (w !== WOUND_DOWN && w !== WOUND_STABILISED) return null;
  const fullTicks = bleedFullTicks(sim, id);
  const raw = st.bleedTicks[id];
  if (fullTicks <= 0) return { stabilised: w === WOUND_STABILISED, leftTicks: raw > 0 ? raw : 0, fullTicks: 0, fraction: ONE };
  const leftTicks = raw < 0 ? 0 : raw > fullTicks ? fullTicks : raw;
  return { stabilised: w === WOUND_STABILISED, leftTicks, fullTicks, fraction: scaleDown(leftTicks, ONE, fullTicks) };
}

/**
 * Whole seconds a clock of `leftTicks` has left when it loses `rate` ticks a tick (`Sim.woundBleedRate`:
 * a pinned man bleeds at 2), rounded up. A rate of 0 (held) is read as 1: a held clock shows no countdown,
 * and the caller says so from the rate itself.
 */
export function bleedSecondsLeft(leftTicks: number, rate: number): number {
  const per = (rate > 0 ? rate : 1) * TICKS_PER_SECOND;
  const r = leftTicks % per;
  const q = (leftTicks - r) / per;
  return r > 0 ? q + 1 : q;
}
