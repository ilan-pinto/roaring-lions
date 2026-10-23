/**
 * The pointer, read once for both the hover cursor and the click (WP-P4).
 *
 * `main.ts`'s `updateHover` used to do this inline: screen to ground, the
 * nearest hostile, the resolver, the cursor. The click did its own screen to
 * ground. Two things moved here, so a test can drive them from a screen
 * pixel through the real projection with no browser, and so the click and
 * the cursor that predicts it read one function:
 *
 * - PA-14: a pixel that shows a building's upper wall used to resolve to the
 *   hidden ground BEHIND the building (`screenToWorld` meets the ground, and
 *   the wall is in the way). `pointerPoint` asks the renderer which building
 *   the pixel shows first, and resolves the click to that building.
 * - PA-08: what the cursor names over an enemy. `advance` while a right-click
 *   there is an attack-move to the tile (a suspected contact), `attack` when
 *   it is a targeted order (GH-420). That rule is `cursor.ts`'s; this is the
 *   path that reaches it.
 *
 * No DOM. `Sim` is read, never written.
 */
import { WOUND_DOWN, WOUND_STABILISED, fx, type Sim, type SupportKind } from '@lions/sim';
import { isHostileSide } from '@lions/render';
import { resolveMoveOrder, resolvePointer, type IntentWorld, type Resolution } from './intents';
import { badgeFor, cursorFor, cursorKey, type CursorHints, type CursorName } from './cursor';
import { roleBucket } from '../ui/role';
import { wholeOrderPinned } from '../ui/pinned';

/**
 * The resolver's view of a real `Sim` -- the one adapter, so the click, the
 * hover cursor and a spec ask the same object the same questions. Both
 * `structureAt` and `tunnelAt` take integer tiles; the pointer's world point
 * is fractional, so both floor here rather than in the sim (Math is banned
 * in packages/sim/src -- invariant 2). `inFlaggedZone` is the caller's: a
 * mission's declared zones, or the sandbox's synthesised ones.
 */
export function simIntentWorld(sim: Sim, inFlaggedZone: (x: number, y: number) => boolean): IntentWorld {
  return {
    structureAt: (x, y) => sim.structureAt(Math.floor(x), Math.floor(y)),
    tunnelAt: (x, y) => sim.tunnelAt(Math.floor(x), Math.floor(y)),
    isProtected: (s) => sim.isProtected(s),
    structureRoePenalty: (s) => sim.structureRoePenalty(s),
    garrisonFree: (s) => sim.garrisonFree(s),
    canDemolish: (i) => sim.unitTypes[sim.state.typeIdx[i]].canDemolish,
    canGarrison: (i) => sim.unitTypes[sim.state.typeIdx[i]].canGarrison,
    canTunnelCharge: (i) => sim.unitTypes[sim.state.typeIdx[i]].canTunnelCharge,
    inFlaggedZone,
    groundAt: (x, y) => {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= sim.width || ty >= sim.height) return 'offmap';
      return sim.blocked[ty * sim.width + tx] !== 0 ? 'blocked' : 'open';
    },
    flies: (i) => sim.unitTypes[sim.state.typeIdx[i]].isAir,
    // GH-420: the sim's own filter, so the split the click makes and the
    // sim's refusal cannot drift (R-8). Read-only queries.
    canFocus: (i, target) => sim.canFocus(i, target),
    focusHurts: (i, target) => sim.focusHurts(i, target),
    canRescue: (i, target) => sim.canRescue(i, target),
    // The same test H uses (`haltTargets`): a unit inside a building holds.
    garrisoned: (i) => sim.state.garrisonedIn[i] >= 0,
  };
}

/** What the pointer needs from the renderer: projection, the unit a pixel
 *  shows, and visibility -- the questions only the renderer can answer -- plus the side this screen
 *  commands (`viewerSideOf`, network design §5.1), which decides who counts
 *  as an enemy under the pointer. */
export interface PointerView {
  screenToWorld(px: number, py: number): { x: number; y: number };
  structureAtScreen(px: number, py: number): number;
  isVisible(wx: number, wy: number): boolean;
  /** The unit a click at this pixel picks within `radiusTiles` of its drawn
   *  body (`Renderer.unitAtScreen`, PR 534), or -1. ANY unit, own or enemy,
   *  visible or not: `pointerPoint` filters. */
  unitAtScreen(px: number, py: number, radiusTiles: number): number;
  readonly viewer: number;
}

/**
 * How near a pixel must land to an enemy's drawn body to be an order on it
 * (GH-420, R-23): half a tile, `hostileUnder`'s generosity before the body
 * pick. The same body segment a left-click selects by, asked tighter -- the
 * left-click keeps its 1.2 tiles -- so a right-click on ground a tile from an
 * identified enemy is still an attack-move to that ground, as it was, and not
 * a fire order (or an R-1 refusal) the player did not point at.
 */
export const ORDER_PICK_RADIUS_TILES = 0.5;

/**
 * The enemy the pixel shows, or -1 (GH-420, R-13). One id for the hover, the
 * fire panel, the cursor and the click: the unit the renderer's own pick
 * names (PR 534: measured against the ground each unit's drawn body hides, so a
 * click on a body in a group is that body and not the ground behind it) at
 * `ORDER_PICK_RADIUS_TILES`, kept only if it is alive, hostile to `viewer` --
 * never own, never a civilian, side 2 is never an aimpoint -- and standing
 * where `isVisible` says it is drawn. The visibility check is the fog guard
 * that `hostileUnder` carried: in a versus room sweeping the cursor over fog
 * must not locate a hidden defender through the fire panel.
 */
function enemyAt(view: PointerView, sim: Sim, px: number, py: number): number {
  const hit = view.unitAtScreen(px, py, ORDER_PICK_RADIUS_TILES);
  if (hit < 0 || hit >= sim.entityCount) return -1;
  if (sim.state.alive[hit] === 0 || !isHostileSide(sim.state.side[hit], view.viewer)) return -1;
  return view.isVisible(fx.toNumber(sim.state.posX[hit]), fx.toNumber(sim.state.posY[hit])) ? hit : -1;
}

/**
 * The wounded entity the pixel shows, or -1 (GH-707): the unit `unitAtScreen` picks at the order
 * radius, kept only if it is alive, down (a `wounded`-role unit, or any unit the sim holds at
 * DOWN or STABILISED -- a civilian downed in place), not carried, and standing where `isVisible`
 * says it is drawn. ANY side: a medic rescues the enemy's wounded too (D2).
 */
function woundedAtPixel(view: PointerView, sim: Sim, px: number, py: number): number {
  const hit = view.unitAtScreen(px, py, ORDER_PICK_RADIUS_TILES);
  if (hit < 0 || hit >= sim.entityCount) return -1;
  const st = sim.state;
  if (st.alive[hit] === 0 || st.carriedBy[hit] >= 0) return -1;
  const down = st.woundState[hit] === WOUND_DOWN || st.woundState[hit] === WOUND_STABILISED;
  if (!down && !sim.unitTypes[st.typeIdx[hit]].isWounded) return -1;
  return view.isVisible(fx.toNumber(st.posX[hit]), fx.toNumber(st.posY[hit])) ? hit : -1;
}

/** Where an order given at this pixel goes, and what the pointer is over. */
export interface PointerPoint {
  /** Where the pixel's ray meets the ground (`screenToWorld`). */
  readonly ground: { x: number; y: number };
  /** The point an order resolves at: `ground`, or the centre of the building
   *  whose wall the pixel shows -- whether or not an enemy was picked (R-24).
   *  NEVER the picked enemy's position (R-18): an enemy that cannot be
   *  focused must leave the structure, tunnel and zone rungs, and the armed
   *  Move, exactly as they are without the pick. */
  readonly x: number;
  readonly y: number;
  /** The enemy the pixel shows (`unitAtScreen` at `ORDER_PICK_RADIUS_TILES`),
   *  or -1. */
  readonly hostile: number;
  /** Where that enemy stands, or null. Only the hostile rung reads it, once
   *  it resolves a focus (`PointerContext.hostileAt`). */
  readonly hostileAt: { x: number; y: number } | null;
  /** The wounded entity the pixel shows (GH-707), or -1. */
  readonly wounded: number;
  /** Where he lies, or null. */
  readonly woundedAt: { x: number; y: number } | null;
  /** The building the pixel shows above its footprint, or -1 when the click
   *  is on the ground (including on a footprint the ground pick reached).
   *  Independent of `hostile`. */
  readonly facade: number;
}

/**
 * The PA-14 rule. A pixel that shows a standing building's wall or roof
 * resolves to that building's footprint centre, so the resolver sees the
 * building -- garrison, demolish or an attack-move onto it, whatever the
 * cursor would say over its footprint -- rather than the ground behind it.
 * A ground point already on that building's footprint needs nothing.
 *
 * A picked enemy does not switch it off (R-24). The enemy travels apart, as
 * `hostile`/`hostileAt`, and the resolver's hostile rung comes before its
 * structure rung: an enemy somebody selected can focus still wins (its
 * occlusion outline draws through the wall, so the player can see what they
 * are pointing at), and one nobody can -- a suspected contact at the wall's
 * foot -- leaves the click the building's, exactly as with no enemy there.
 * Before R-24 any picked enemy kept the ground point, which for a wall pixel
 * is the hidden ground BEHIND the building: an attack-move round the back.
 */
export function pointerPoint(view: PointerView, sim: Sim, px: number, py: number): PointerPoint {
  const ground = view.screenToWorld(px, py);
  const hostile = enemyAt(view, sim, px, py);
  const hostileAt =
    hostile >= 0 ? { x: fx.toNumber(sim.state.posX[hostile]), y: fx.toNumber(sim.state.posY[hostile]) } : null;
  const wounded = woundedAtPixel(view, sim, px, py);
  const woundedAt =
    wounded >= 0 ? { x: fx.toNumber(sim.state.posX[wounded]), y: fx.toNumber(sim.state.posY[wounded]) } : null;
  const s = view.structureAtScreen(px, py);
  if (s < 0 || sim.structures.alive[s] !== 1 || sim.structureAt(Math.floor(ground.x), Math.floor(ground.y)) === s) {
    return { ground, x: ground.x, y: ground.y, hostile, hostileAt, wounded, woundedAt, facade: -1 };
  }
  const st = sim.structures;
  return {
    ground,
    x: (st.minX[s] + st.maxX[s] + 1) / 2,
    y: (st.minY[s] + st.maxY[s] + 1) / 2,
    hostile,
    hostileAt,
    wounded,
    woundedAt,
    facade: s,
  };
}

/** Everything else the hover cursor reads that the resolver does not. */
export interface CursorContext {
  /** The player's living selection. */
  readonly ids: number[];
  readonly armed: SupportKind | null;
  /** Alt held. */
  readonly confirm: boolean;
  readonly armedSmoke: boolean;
  /** The plain Move order is armed: the click is a move to the ground, so the
   *  cursor reads `resolveMoveOrder`, not the attack-move resolver. Optional
   *  so the other callers compile and read unchanged. */
  readonly armedMove?: boolean;
  /** F4: Set rally is armed -- would a rally stand at this tile point? Null or
   *  absent when no rally is armed. Read at `p` (the `pointerPoint` rule), the
   *  point the click would send. */
  readonly rallyAt?: ((x: number, y: number) => boolean) | null;
  /** An armed patrol (Lane A mock): may a waypoint go at this point
   *  (`patrolPointOk`)? Absent or null: not armed. */
  readonly patrolAt?: ((x: number, y: number) => boolean) | null;
}

export interface CursorRead {
  readonly res: Resolution;
  readonly hints: CursorHints;
  readonly name: CursorName;
  /** What `canvas.dataset.cursor` carries, and `__lions.cursorKey()` reads. */
  readonly key: string;
}

/**
 * The cursor for an order at `p` -- the resolver the click uses, ranked by
 * `cursor.ts`. `append` is always false: the hover cursor does not depend on
 * Shift, and passing the live Shift state would make the cursor flicker
 * while a player queues waypoints.
 */
export function cursorAt(sim: Sim, world: IntentWorld, p: PointerPoint, ctx: CursorContext): CursorRead {
  const armedMove = ctx.armedMove === true && ctx.armed === null;
  // F4: an armed rally is nobody's order -- the selection does not move, so it
  // is resolved with no ids and wears no role badge.
  const rallyAt = ctx.armed === null ? (ctx.rallyAt ?? null) : null;
  // An armed patrol is the same shape: the click places a waypoint, not an order.
  const patrolAt = ctx.armed === null && rallyAt === null ? (ctx.patrolAt ?? null) : null;
  const ids = rallyAt !== null || patrolAt !== null ? [] : ctx.ids;
  const res = armedMove
    ? resolveMoveOrder(world, { ids, x: p.x, y: p.y, append: false })
    : resolvePointer(world, {
        ids,
        x: p.x,
        y: p.y,
        append: false,
        armed: ctx.armed,
        confirm: ctx.confirm,
        hostile: p.hostile,
        ...(p.hostileAt ? { hostileAt: p.hostileAt } : {}),
        wounded: p.wounded,
        ...(p.woundedAt ? { woundedAt: p.woundedAt } : {}),
      });
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const inBounds = tx >= 0 && ty >= 0 && tx < sim.width && ty < sim.height;
  // GH-262: the whole order is pinned -- every id the order intent would
  // move -- so the click is accepted and nobody goes. Read from the order
  // intent's ids rather than the selection, so a pinned unit in a demolish
  // or garrison group never speaks for it.
  // A targeted order (GH-420) is moved by the same pinned units: the intents
  // that send someone somewhere or open fire are `order` and `attack`.
  const orderIds = res.intents.flatMap((i) => (i.kind === 'order' || i.kind === 'attack' ? i.ids : []));
  const hints: CursorHints = {
    hostile: p.hostile >= 0,
    blocked: inBounds && sim.blocked[ty * sim.width + tx] !== 0,
    armedSmoke: ctx.armedSmoke,
    armedMove,
    pinned: wholeOrderPinned(sim.state, orderIds),
    ...(rallyAt !== null ? { armedRally: rallyAt(p.x, p.y) ? ('ok' as const) : ('refused' as const) } : {}),
    ...(patrolAt !== null ? { armedPatrol: patrolAt(p.x, p.y) ? ('ok' as const) : ('refused' as const) } : {}),
  };
  const name = cursorFor(res, hints);
  const key = cursorKey(
    name,
    badgeFor(res, hints, { bucketOf: (id) => roleBucket(sim.unitTypes[sim.state.typeIdx[id]]) }, name)
  );
  return { res, hints, name, key };
}
