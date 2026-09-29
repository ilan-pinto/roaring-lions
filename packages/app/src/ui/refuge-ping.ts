/**
 * GH-279: the two moments the refuge ring is shown, as the app says them.
 *
 * The ring itself is the renderer's (`Renderer.pingRefuge`, three only); this
 * is only WHEN. It shows when a flight line is EMITTED -- once per line, not
 * once per family, since `CivFlightWatch` already folds a ripple of breaks
 * into one line -- and when the player presses the tracker's "Show refuge".
 * Never as a standing mark: each call restarts a three-second envelope and
 * nothing keeps it up.
 *
 * Pulled out of `main.ts` so the wiring is testable: both functions take
 * their effects as plain callbacks and touch no DOM, no renderer and no sim.
 */

import type { AlertLine } from './alerts';
import type { FlightNotice } from './civ-flight';

export interface TilePoint {
  x: number;
  y: number;
}

/** Where one flight line goes. */
export interface FlightSinks {
  /** The feed line -- `main.ts` words it through `alertNotice`. */
  note(line: AlertLine): void;
  /** The minimap flash, on where they broke and where they are going. */
  flash(points: readonly TilePoint[], nowMs: number): void;
  /** The refuge ring. */
  ping(x: number, y: number): void;
}

/**
 * Say one flight line: the feed, the minimap flash, and the ring on the
 * refuge -- exactly one ping per line. Returns the point the jump key should
 * take (where the first family is now), which `main.ts` keeps as
 * `lastAlertAt`.
 */
export function sayFlight(flight: FlightNotice, refuge: TilePoint, sinks: FlightSinks, nowMs: number): TilePoint {
  sinks.note(flight.line);
  sinks.flash([flight.at, refuge], nowMs);
  sinks.ping(refuge.x, refuge.y);
  return flight.at;
}

/**
 * The tracker's jump handler: the camera onto the row's point, and the ring
 * on it. The only row that carries a jump today is an active evacuation,
 * whose point IS the refuge (`evacuation.ts`), so the ring goes where the
 * camera goes.
 */
export function refugeJump(camera: TilePoint, ping: (x: number, y: number) => void): (x: number, y: number) => void {
  return (x, y) => {
    camera.x = x;
    camera.y = y;
    ping(x, y);
  };
}
