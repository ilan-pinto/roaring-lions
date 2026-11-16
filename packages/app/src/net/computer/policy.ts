/**
 * The arena's scripted policies (N4b task 12, decision D8), moved here verbatim from `tools/src/net/players.ts` for GH-1388 so the app can
 * offer `rush` as a computer seat. Nothing in the text below changed: `players.ts` re-exports it, so the arena plays the same script.
 *
 * A policy sees a `SideView` and nothing else: this seat's own force, the contacts in its fog, and the two camps a human also reads
 * off the map. It is handed no `Sim` and no `MatchWorld`, so it cannot see through the fog, and it can only return `Command`s.
 */
import type { Command } from '@lions/sim';
import { fx } from '@lions/sim';
import type { SideView } from './view';

/** May be async: an external or slow policy is a promise; the in-process
 *  player never awaits past `roundWallMs`. */
export type Policy = (view: SideView) => Command[] | Promise<Command[]>;

/** Orders nothing, ever: the control that must lose to `rush` and draw itself. */
export const passive: Policy = () => [];

/** The room's cap on ids in one command (GH-566). */
const MAX_IDS_PER_COMMAND = 256;

/** A tile's centre, Q16.16: what a human's click on that tile sends. */
const tileCentre = (t: number): number => fx.from(t + 0.5);

/** How far from its own camp a unit still counts as "at home". */
export const RUSH_HOME_TILES = 10;

/**
 * Attack-move on the centroid of the contacts this seat can see, or, seeing
 * none, on the enemy's camp -- the anchor a human also knows from the map --
 * with every unit that is idle and still at home. Reads only the view.
 *
 * Decision D8, as refined (ruled faithful, review round 1): rush never breaks
 * off an engagement. A fresh order clears a unit's engagement and stance
 * (`sim.ts`, the move/attackMove handler), so a unit that is shooting, or
 * under way, is never re-ordered: only the view's `idle` flag (the player's
 * own idle finder, `isIdle`) is. And a unit already out is not re-sent: the
 * order carries `sweep` (the cursor's sweep, which `cleanCommand` carries),
 * so having arrived it hunts what its OWN side has seen by itself. What is
 * left at home -- the start, a unit that walked back -- is what rush commits.
 *
 * Measured, not assumed (task-12 report, review round 1; pure sim at the
 * relay's latency, tel_marum, pace 60, cap 12,000): on 20 held-out seeds
 * (2..21) x both seat orders rush scores 0.750 (30 won, 10 lost) -- 17-3
 * from the west, 13-7 from the east, where a passive force waiting below
 * the pass is the stronger side. Every fog-honest variant tried read
 * 0.525-0.750 there. It is a control that tells two players apart, not a
 * dominance.
 */
export const rush: Policy = (view) => {
  const ids = view.units
    .filter((u) => u.flags.includes('idle') && Math.hypot(u.tile[0] - view.camp[0], u.tile[1] - view.camp[1]) <= RUSH_HOME_TILES)
    .map((u) => u.id);
  if (ids.length === 0) return [];
  let tx: number;
  let ty: number;
  if (view.contacts.length > 0) {
    let sx = 0;
    let sy = 0;
    for (const c of view.contacts) { sx += c.tile[0]; sy += c.tile[1]; }
    tx = Math.floor(sx / view.contacts.length);
    ty = Math.floor(sy / view.contacts.length);
  } else {
    [tx, ty] = view.enemyCamp;
  }
  const out: Command[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_COMMAND) {
    out.push({ kind: 'attackMove', ids: ids.slice(i, i + MAX_IDS_PER_COMMAND), x: tileCentre(tx), y: tileCentre(ty), sweep: true });
  }
  return out;
};

/** A realtime room has no rounds: the policy runs every 100 ticks (5 s). */
export const REALTIME_EVERY_TICKS = 100;
