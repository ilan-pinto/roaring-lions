/**
 * The patrol verb from input (Lane A mock, approved by the lead 22 Oct, Q6-Q14).
 *
 * The sim already walks a beat (`setStance{patrol}`, N3 Task 9): 2 to
 * `MAX_PATROL_WAYPOINTS` points, shared by every id, looped in order. This is
 * how a player draws one, and nothing else:
 *
 *  - P (or the order row's Patrol button) arms it. Point 1 is fixed at that
 *    moment: where the selection stands (`patrolStart`).
 *  - A plain click adds the last point and SENDS: "here and there" is the
 *    common case and costs one click (Q7).
 *  - A Shift-click adds a point and stays armed; the 4th point sends by itself.
 *  - Rock, a wall or off the map refuses the click and stays armed, as Set
 *    rally does (Q9). A selection with a flyer may put a point over rock (K-08),
 *    never off the map: `validateCommand` refuses an off-map waypoint.
 *  - Right-click or Escape drops every pending point and sends nothing (Q8);
 *    that half lives in `main.ts`, beside rally's.
 *
 * Pure: no DOM, no sim. `main.ts` owns the armed state and the dispatch.
 */
import { MAX_PATROL_WAYPOINTS } from '@lions/sim';
import type { IntentWorld, PlayerIntent } from './intents.ts';

export interface PatrolPoint {
  readonly x: number;
  readonly y: number;
}

/** An armed patrol: who walks it, and the points placed so far (point 1 first). */
export interface PatrolDraft {
  readonly ids: readonly number[];
  readonly points: readonly PatrolPoint[];
}

/** Why a patrol could not be armed: nothing alive selected, or every one of
 *  them inside a building or a carrier (Q11: they keep their post). */
export type PatrolArmRefusal = 'noSelection' | 'nobodyFree';

/** Who in the selection patrols (Q11): the caller's own living ids, less any
 *  inside a building or riding a carrier -- the sim skips both at accept time,
 *  so leaving them out keeps the start point honest. */
export function patrolIds(
  ids: readonly number[],
  garrisoned: (id: number) => boolean,
  carried: (id: number) => boolean
): number[] {
  return ids.filter((i) => !garrisoned(i) && !carried(i));
}

/** May a patrol point go here (Q9)? Open ground, or anything on the map when a
 *  flyer is among the patrollers (K-08). Never off the map. */
export function patrolPointOk(world: Pick<IntentWorld, 'groundAt' | 'flies'>, ids: readonly number[], x: number, y: number): boolean {
  const ground = world.groundAt(x, y);
  if (ground === 'open') return true;
  if (ground === 'offmap') return false;
  return ids.some((i) => world.flies(i));
}

/**
 * Point 1: where the selection stands. The centre of the patrollers'
 * positions, at its tile's centre; when that tile is not ground a patrol may
 * use (a group either side of a wall), the tile of the patroller nearest that
 * centre instead, which the unit itself stands on.
 */
export function patrolStart(
  ids: readonly number[],
  posOf: (id: number) => PatrolPoint,
  world: Pick<IntentWorld, 'groundAt' | 'flies'>
): PatrolPoint {
  let sx = 0;
  let sy = 0;
  for (const i of ids) {
    const p = posOf(i);
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / ids.length;
  const cy = sy / ids.length;
  const centre = { x: Math.floor(cx) + 0.5, y: Math.floor(cy) + 0.5 };
  if (patrolPointOk(world, ids, centre.x, centre.y)) return centre;
  let best = ids[0];
  let bestD = Infinity;
  for (const i of ids) {
    const p = posOf(i);
    const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const p = posOf(best);
  return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
}

/** Arm a patrol for this selection, or say why not. */
export function beginPatrol(
  ids: readonly number[],
  posOf: (id: number) => PatrolPoint,
  world: Pick<IntentWorld, 'groundAt' | 'flies' | 'garrisoned'>,
  carried: (id: number) => boolean
): PatrolDraft | PatrolArmRefusal {
  if (ids.length === 0) return 'noSelection';
  const walkers = patrolIds(ids, (i) => world.garrisoned(i), carried);
  if (walkers.length === 0) return 'nobodyFree';
  return { ids: walkers, points: [patrolStart(walkers, posOf, world)] };
}

/** What one click on the map does to an armed patrol. */
export type PatrolClick =
  | { kind: 'refused' }
  | { kind: 'added'; draft: PatrolDraft }
  | { kind: 'send'; intent: Extract<PlayerIntent, { kind: 'patrol' }> };

export function patrolClick(
  draft: PatrolDraft,
  world: Pick<IntentWorld, 'groundAt' | 'flies'>,
  x: number,
  y: number,
  shift: boolean
): PatrolClick {
  if (!patrolPointOk(world, draft.ids, x, y)) return { kind: 'refused' };
  // A point on the same tile as the one before it would be a leg of length zero (review M-3).
  const last = draft.points[draft.points.length - 1];
  if (Math.floor(last.x) === Math.floor(x) && Math.floor(last.y) === Math.floor(y)) return { kind: 'refused' };
  const points = [...draft.points, { x, y }];
  if (shift && points.length < MAX_PATROL_WAYPOINTS) return { kind: 'added', draft: { ids: draft.ids, points } };
  return { kind: 'send', intent: { kind: 'patrol', ids: [...draft.ids], points } };
}
