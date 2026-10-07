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
 * - PA-08: what the cursor names over an enemy -- `advance`, because a
 *   right-click there is an attack-move to the tile, not a targeted attack.
 *   That rule is `cursor.ts`'s; this is the path that reaches it.
 *
 * No DOM. `Sim` is read, never written.
 */
import { fx, type Sim } from '@lions/sim';
import { resolvePointer, type IntentWorld, type Resolution } from './intents';
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
  };
}

/** What the pointer needs from the renderer: projection and visibility, the
 *  three questions only the renderer can answer. `Renderer` satisfies it. */
export interface PointerView {
  screenToWorld(px: number, py: number): { x: number; y: number };
  structureAtScreen(px: number, py: number): number;
  isVisible(wx: number, wy: number): boolean;
}

/** How near the pointer's ground point an enemy must stand to be "under" it:
 *  half a tile, the same generosity the click-to-select test uses. */
export const HOVER_RADIUS_TILES = 0.5;

/**
 * Nearest living ENEMY (side 1 -- never a civilian, side 2 is never an
 * aimpoint) within half a tile of a ground point, or -1. Gated on
 * `isVisible`, the condition the renderer draws a hostile by, so sweeping the
 * cursor over fog cannot locate a hidden defender through the fire panel.
 */
export function hostileUnder(sim: Sim, wx: number, wy: number, isVisible: (x: number, y: number) => boolean): number {
  let he = -1;
  let bestD = HOVER_RADIUS_TILES * HOVER_RADIUS_TILES;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] === 0 || sim.state.side[i] !== 1) continue;
    const ex = fx.toNumber(sim.state.posX[i]);
    const ey = fx.toNumber(sim.state.posY[i]);
    if (!isVisible(ex, ey)) continue;
    const dx = ex - wx;
    const dy = ey - wy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      he = i;
    }
  }
  return he;
}

/** Where an order given at this pixel goes, and what the pointer is over. */
export interface PointerPoint {
  /** Where the pixel's ray meets the ground (`screenToWorld`). */
  readonly ground: { x: number; y: number };
  /** The point an order resolves at: `ground`, or the centre of the building
   *  whose wall the pixel shows. */
  readonly x: number;
  readonly y: number;
  /** The enemy under `ground`, or -1. */
  readonly hostile: number;
  /** The building the pixel shows above its footprint, or -1 when the click
   *  is on the ground (including on a footprint the ground pick reached). */
  readonly facade: number;
}

/**
 * The PA-14 rule. A pixel that shows a standing building's wall or roof
 * resolves to that building's footprint centre, so the resolver sees the
 * building -- garrison, demolish or an attack-move onto it, whatever the
 * cursor would say over its footprint -- rather than the ground behind it.
 *
 * Two cases keep the ground point. An enemy under it wins, because its
 * occlusion outline draws through the wall: the player can see what they are
 * pointing at, and the cursor already names it. And a ground point already
 * on that building's footprint needs nothing.
 */
export function pointerPoint(view: PointerView, sim: Sim, px: number, py: number): PointerPoint {
  const ground = view.screenToWorld(px, py);
  const hostile = hostileUnder(sim, ground.x, ground.y, (x, y) => view.isVisible(x, y));
  const s = hostile >= 0 ? -1 : view.structureAtScreen(px, py);
  if (s < 0 || sim.structures.alive[s] !== 1 || sim.structureAt(Math.floor(ground.x), Math.floor(ground.y)) === s) {
    return { ground, x: ground.x, y: ground.y, hostile, facade: -1 };
  }
  const st = sim.structures;
  return {
    ground,
    x: (st.minX[s] + st.maxX[s] + 1) / 2,
    y: (st.minY[s] + st.maxY[s] + 1) / 2,
    hostile,
    facade: s,
  };
}

/** Everything else the hover cursor reads that the resolver does not. */
export interface CursorContext {
  /** The player's living selection. */
  readonly ids: number[];
  readonly armed: 'strike' | 'sweep' | null;
  /** Alt held. */
  readonly confirm: boolean;
  readonly armedSmoke: boolean;
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
  const res = resolvePointer(world, {
    ids: ctx.ids,
    x: p.x,
    y: p.y,
    append: false,
    armed: ctx.armed,
    confirm: ctx.confirm,
  });
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  const inBounds = tx >= 0 && ty >= 0 && tx < sim.width && ty < sim.height;
  // GH-262: the whole order is pinned -- every id the order intent would
  // move -- so the click is accepted and nobody goes. Read from the order
  // intent's ids rather than the selection, so a pinned unit in a demolish
  // or garrison group never speaks for it.
  const orderIds = res.intents.find((i) => i.kind === 'order')?.ids ?? [];
  const hints: CursorHints = {
    hostile: p.hostile >= 0,
    blocked: inBounds && sim.blocked[ty * sim.width + tx] !== 0,
    armedSmoke: ctx.armedSmoke,
    pinned: wholeOrderPinned(sim.state, orderIds),
  };
  const name = cursorFor(res, hints);
  const key = cursorKey(
    name,
    badgeFor(res, hints, { bucketOf: (id) => roleBucket(sim.unitTypes[sim.state.typeIdx[id]]) }, name)
  );
  return { res, hints, name, key };
}
