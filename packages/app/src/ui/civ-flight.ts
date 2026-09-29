/**
 * The feed line for families breaking for the refuge (GH-279).
 *
 * The flight rule lives in the sim (`@lions/sim`'s `CivilianFlight.step`) and
 * has two triggers: suppression above `CIV_FLEE_AT`, or any player unit within
 * four tiles. Neither was ever shown. A squad walked near a family, the family
 * sprinted off, and nothing on screen said why -- which is the whole of the
 * "civilians are running with no reason" report.
 *
 * The sim raises no event when a family breaks, and it is frozen, so this
 * DERIVES the break from state the app can already read. It never re-runs the
 * rule: it watches for the rule's effect.
 *
 *  - A civilian breaks the first tick it is seen MOVING or CARRIED. Nothing
 *    else orders a side-2 unit: the player selects side 0, and the only shipped
 *    trigger that names a civilian group is `remove`, which clears `alive`
 *    rather than giving an order. So the first move is the flight. Latched per
 *    civilian, exactly as the sim latches it, so the dead-transport re-order
 *    (`CivilianFlight.step`'s own first branch) is not announced twice.
 *  - The CAUSE is read one observation back. `MissionRuntime.step` decides the
 *    flight after tick T and the order lands in tick T+1, so the suppression
 *    the rule saw is the one this model recorded at the end of tick T. Reading
 *    it at T+1 instead would call a family "moved by your troops" whenever
 *    their suppression had decayed a hair under the line in the one tick
 *    between -- the misreading this exists to prevent. The rule has exactly two
 *    triggers, so not-suppressed means a soldier was close; the distance test
 *    is not repeated here.
 *
 * THROTTLED, because a village breaks in a ripple as a squad walks through it.
 * The first break opens a short gather window, everything that breaks inside
 * it is one line, and after a line no other line for a cooldown. Nothing is
 * dropped: a break inside the cooldown is held and said, with its count, when
 * the cooldown ends.
 *
 * Pure: no DOM, no `Sim`. `main.ts` builds the observations from `sim.state`
 * read-only (invariant 4). Like `alerts.ts`, no `t()` here -- it hands back a
 * catalogue key and params, and `alertNotice` words them where they render.
 */

import type { AlertLine } from './alerts';

/** Why a family broke. `fire` wins a mixed batch: it is the louder fact, and
 *  the one that costs Conduct. */
export type FlightCause = 'fire' | 'troops';

/** One civilian, as `main.ts` reads it off `sim.state` this tick. */
export interface CivObservation {
  id: number;
  alive: boolean;
  /** In a tunnel. The sim skips a buried civilian entirely, so this does too. */
  buried: boolean;
  moving: boolean;
  carried: boolean;
  /** Suppression above `CIV_FLEE_AT` -- the sim's own constant, compared by
   *  the caller so this file needs no Q16.16. */
  suppressed: boolean;
  /** Tiles. */
  x: number;
  y: number;
}

export interface FlightNotice {
  line: AlertLine;
  /** Where the first family of the batch broke -- the jump key's target. */
  at: { x: number; y: number };
  /** How many families this line stands for. */
  count: number;
  cause: FlightCause;
}

/** 1.5 s at 20 Hz: long enough for a squad walking through a village to set
 *  off every family on its path inside one line. */
export const FLIGHT_GATHER_TICKS = 30;
/** 10 s at 20 Hz between two flight lines. Twice the under-fire cooldown
 *  (`UNDER_FIRE_COOLDOWN_TICKS`): a family breaks once, so a second line is
 *  news about someone else, and there is no condition here to keep repeating. */
export const FLIGHT_COOLDOWN_TICKS = 200;

interface Pending {
  cause: FlightCause;
  at: { x: number; y: number };
}

export class CivFlightWatch {
  /** Latched: who has already been announced (or counted into a batch). */
  private readonly fled = new Set<number>();
  /** Who was suppressed at the previous observation -- the state the rule saw. */
  private suppressedLast = new Set<number>();
  private pending: Pending[] = [];
  private firstPendingTick = -1;
  private lastLineTick = Number.NEGATIVE_INFINITY;

  /** Whether this civilian has been seen breaking. */
  hasFled(id: number): boolean {
    return this.fled.has(id);
  }

  /** One tick's observations in; at most one line out. Call once per tick,
   *  after the flight rule has run for that tick. */
  observe(civs: readonly CivObservation[], tick: number): FlightNotice | null {
    const suppressedNow = new Set<number>();
    for (const c of civs) {
      if (!c.alive || c.buried || this.fled.has(c.id)) continue;
      if (c.moving || c.carried) {
        this.fled.add(c.id);
        const cause: FlightCause = this.suppressedLast.has(c.id) || c.suppressed ? 'fire' : 'troops';
        if (this.pending.length === 0) this.firstPendingTick = tick;
        this.pending.push({ cause, at: { x: c.x, y: c.y } });
        continue;
      }
      if (c.suppressed) suppressedNow.add(c.id);
    }
    this.suppressedLast = suppressedNow;

    if (this.pending.length === 0) return null;
    const due = Math.max(this.firstPendingTick + FLIGHT_GATHER_TICKS, this.lastLineTick + FLIGHT_COOLDOWN_TICKS);
    if (tick < due) return null;

    const batch = this.pending;
    this.pending = [];
    this.firstPendingTick = -1;
    this.lastLineTick = tick;
    const cause: FlightCause = batch.some((p) => p.cause === 'fire') ? 'fire' : 'troops';
    return {
      line: {
        key: cause === 'fire' ? 'alert.civFlight.fire' : 'alert.civFlight.troops',
        params: { n: batch.length },
        tone: cause === 'fire' ? 'warn' : 'info',
      },
      at: batch[0].at,
      count: batch.length,
      cause,
    };
  }
}
