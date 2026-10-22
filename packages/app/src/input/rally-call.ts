/**
 * The armed Set rally click, from a screen pixel to a `setRally` command (F4,
 * WP-S-F GH-184 Lane A).
 *
 * The point goes through `pointerPoint`, the rule every armed click and the
 * hover cursor read, so a pixel that shows a building's wall means that
 * building -- and a building is a blocked tile, which the runtime refuses.
 * The cursor reads `canRally` at the same point (`cursorAt`'s `rallyAt`), so
 * a `blocked` cursor and a refused click are the same answer.
 *
 * "Check, then send" (N2, D3): the click asks the runtime's read-only
 * `canSetRally` and an accepted point goes to the order sink as a `setRally`
 * command; the runtime re-checks when it runs it, before the next tick. A
 * refused point sends nothing -- never snapped, as the runtime never snaps.
 *
 * No DOM. `Sim` is read, never written.
 */
import { fx, type Command, type Fx, type Sim } from '@lions/sim';
import { pointerPoint, type PointerView } from './pointer';

/** The slice of `MissionRuntime` a rally reads. */
export interface RallyRuntime {
  canSetRally(line: number, x: Fx, y: Fx, side?: 0 | 1): boolean;
}

export type RallyOutcome = { ok: boolean; x: number; y: number };

/** Would a rally for `line` stand at this tile point? The cursor's question.
 *  `side` is the seat's own (N3 Task 6: a room's viewer); single-player is 0. */
export function canRally(rt: RallyRuntime, line: number, x: number, y: number, side: 0 | 1 = 0): boolean {
  return rt.canSetRally(line, fx.from(x), fx.from(y), side);
}

export function callRally(
  rt: RallyRuntime,
  sink: { queueCommand(cmd: Command): void },
  line: number,
  view: PointerView,
  sim: Sim,
  px: number,
  py: number,
  side: 0 | 1 = 0
): RallyOutcome {
  const p = pointerPoint(view, sim, px, py);
  if (!canRally(rt, line, p.x, p.y, side)) return { ok: false, x: p.x, y: p.y };
  sink.queueCommand({ kind: 'setRally', side, line, x: fx.from(p.x), y: fx.from(p.y) });
  return { ok: true, x: p.x, y: p.y };
}
