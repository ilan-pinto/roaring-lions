/**
 * GH-279: a timed mark on the ground -- today only the refuge ring
 * (`ThreeRenderer.pingRefuge`). Pure: no `THREE`, no sim, so the envelope is
 * testable on its own.
 *
 * **It is never a standing mark.** A ping holds at full strength for
 * `PING_HOLD_MS`, fades linearly to nothing by `PING_END_MS`, and is then
 * gone; a second ping before that restarts the whole envelope at the new
 * point. The lead's rule for status on the map (no permanent badges) is why
 * there is no "show until cleared" here.
 *
 * Aged by the FRAME clock the caller hands `step` (`ThreeRenderer.frame`'s
 * clamped `dtMs`), never by a sim tick -- the same footing `shellHasLanded`
 * and every particle stand on. A ping is presentation and nothing about it
 * may depend on, or be read back by, the simulation (invariant 4). One
 * consequence worth knowing: a presentation freeze (hit-stop hands `frame`
 * a zero `dtMs`) holds the ring too, exactly as it holds everything else
 * drawn from that clock.
 */

/** Full strength for the first second. */
export const PING_HOLD_MS = 1000;
/** Gone at three seconds: a linear fade from `PING_HOLD_MS` to here. */
export const PING_END_MS = 3000;

/** The ring's strength `ageMs` after its (re)start: 1 through the hold, then
 *  linear to 0 at `PING_END_MS`, and 0 from there on. */
export function pingEnvelope(ageMs: number): number {
  if (ageMs <= PING_HOLD_MS) return 1;
  if (ageMs >= PING_END_MS) return 0;
  return 1 - (ageMs - PING_HOLD_MS) / (PING_END_MS - PING_HOLD_MS);
}

/** What to draw this frame: a point in tiles and a strength in (0, 1]. */
export interface PingView {
  readonly x: number;
  readonly y: number;
  readonly strength: number;
}

/** One ping slot. A re-trigger replaces the point and restarts the clock --
 *  there is only ever one refuge ring on the ground. */
export class GroundPing {
  private x = 0;
  private y = 0;
  private ageMs = 0;
  private live = false;

  /** Start (or restart) the envelope at `(x, y)`, in tiles. */
  restart(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.ageMs = 0;
    this.live = true;
  }

  /** Age by one frame's elapsed presentation time. */
  step(dtMs: number): void {
    if (!this.live) return;
    this.ageMs += dtMs;
    if (this.ageMs >= PING_END_MS) this.live = false;
  }

  /** The ring to draw now, or null when there is none. */
  view(): PingView | null {
    if (!this.live) return null;
    return { x: this.x, y: this.y, strength: pingEnvelope(this.ageMs) };
  }
}
