/**
 * The bleed ring (GH-707 P2, spec §7): how much of a down wounded's clock is left, for the unit
 * card. DOM and the HUD only -- "no status marks in the world".
 *
 * Pure: the clock is `@lions/sim`'s `bleedClock` (the one reading, shared with the ground ring in
 * render; its header says how the full bleed is found), and this only turns its Q16.16 fraction
 * into a float and adds the sim's current bleed rate. Writes nothing.
 *
 * Held means the clock is not running: STABILISED (a medic finished) or carried. Admitted and
 * gone wounded are off the board and never reach a card.
 */
import { ONE, bleedClock, bleedSecondsLeft, type BleedClockSource, type BleedClockType } from '@lions/sim';

/** The slice of a unit type this reads. */
export interface BleedType extends BleedClockType {
  readonly isWounded: boolean;
}

/** The slice of the sim this reads (structural, so a test hands a literal). */
export interface BleedSim extends BleedClockSource {
  /** `Sim.woundBleedRate`: ticks of bleed per tick now -- 0 held/tended/carried/stabilised, 2 pinned, else 1. */
  woundBleedRate(id: number): number;
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

/** The card's bleed ring for entity `id`, or null when it is not a down wounded (the card then
 *  draws nothing at all) or no type says how long a wound bleeds. */
export function bleedView(sim: BleedSim, id: number): BleedView | null {
  // The clock itself is the sim's (`bleedClock`): the ground ring reads the same one, so the two cannot drift.
  const clock = bleedClock(sim, id);
  if (clock === null || clock.fullTicks <= 0) return null;
  const rate = sim.woundBleedRate(id);
  return {
    fraction: clock.fraction / ONE,
    // At the sim's own current rate (a pinned man bleeds twice as fast); held shows no countdown.
    seconds: bleedSecondsLeft(clock.leftTicks, rate),
    held: rate === 0,
    stabilised: clock.stabilised,
  };
}
