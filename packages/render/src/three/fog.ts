/**
 * Task B4.1: the fog-of-war computation, extracted to plain functions.
 *
 * `updateFog`/`hasSight`/`isVisible` (`renderer.ts:1020-1197`) read
 * `this.sim` directly because Pixi has one sitting right there, but nothing
 * in the algorithm itself needs a `Sim` instance -- only its dimensions,
 * `alive`, `side`, `typeIdx`, `posX`/`posY`, a per-type sight radius,
 * `blocked`, and a low-profile predicate over structures. Every one of those
 * is a plain array or a plain function, so the whole model is portable and,
 * critically, testable under `environment: 'node'` -- `ThreeRenderer`
 * constructs a `WebGLRenderer` and cannot be built there at all, and fog is
 * the one subsystem where a subtle error stays invisible until a player
 * complains an enemy appeared out of nowhere. There is no screenshot that
 * catches an off-by-one in a sight radius.
 *
 * Ported faithfully from `renderer.ts`; the three load-bearing details
 * (decay-before-reveal, side-0-only, the low-profile exemption) are called
 * out at each function below, matching the source's own comments rather than
 * re-deriving them.
 */

/**
 * Everything `computeFog` needs for one tick, in the struct-of-arrays shape
 * the sim itself already keeps (`Sim`'s own `alive`/`side`/`typeIdx`/`posX`/
 * `posY`, `renderer.ts:836-840`). `typeIdx` and the per-type sight radius are
 * kept as two separate arrays -- `typeIdx` per entity, `sightByType` indexed
 * BY that type index -- rather than a single per-entity `sight` array,
 * because sight is a property of the unit TYPE (`UnitType.sight`,
 * `packages/sim/src/sim.ts:348`), identical for every living entity of that
 * type; a caller building `sightByType` once per frame (or once per mission,
 * since it never changes) is strictly cheaper than re-resolving `fx.toNumber
 * (unitTypes[typeIdx[i]].sight)` per entity per tick the way `updateFog`
 * itself does, and behaviourally identical.
 *
 * `posX`/`posY` are left as raw Q16.16 ints (`Sim`'s own storage,
 * `renderer.ts:672-673`), not `Fx` -- this module has no reason to import
 * `@lions/sim`'s `Fx` type alias for what is, at the boundary, still just
 * `number`; the `/ 65536` conversion below is the same one `updateFog`
 * itself performs inline (`renderer.ts:1030-1031`).
 */
export interface FogInput {
  readonly width: number;
  readonly height: number;
  readonly entityCount: number;
  readonly alive: Uint8Array;
  readonly side: Uint8Array;
  readonly typeIdx: Uint16Array;
  /** Q16.16. */
  readonly posX: Int32Array;
  /** Q16.16. */
  readonly posY: Int32Array;
  /** Sight radius in tiles, indexed by `typeIdx`, already `fx.toNumber`'d. */
  readonly sightByType: Float64Array;
  readonly blocked: Uint8Array;
  readonly isLowProfile: (x: number, y: number) => boolean;
}

/**
 * One tick of fog-of-war (`updateFog`, `renderer.ts:1020-1050`). Per tile: 0
 * never seen, 1 explored but not currently observed, 2 in sight right now.
 *
 * Returns a NEW array rather than mutating `prev` in place -- this module is
 * pure functions, not a class with an owned `this.fog`; the caller (a later
 * task's `ThreeRenderer`) owns the array identity and reassigns it, exactly
 * the way `entityFrame` (`units/frame-state.ts`) returns a fresh result
 * rather than writing through a passed-in one. `prev` itself is never
 * written to.
 *
 * Two things happen in a fixed order, and the order is the point:
 *
 * 1. **Decay before reveal.** Every tile currently at 2 drops to 1 FIRST,
 *    unconditionally, before any unit re-reveals anything this tick
 *    (`renderer.ts:1024-1025`, "Anything currently visible decays to
 *    'explored' before we re-reveal"). Skip this and a tile a unit has
 *    walked away from never dims -- fog would only ever grow, not track
 *    where the player currently is. Explored (>=1) is still monotonic: this
 *    step never sets a tile back to 0.
 * 2. **Only living side-0 units reveal.** `alive[i] === 0 || side[i] !== 0`
 *    skips the entity outright (`renderer.ts:1029`) -- fog is what the
 *    PLAYER can see, and only side 0 is the player; a dead unit has no eyes
 *    either.
 *
 * For each qualifying entity, scans a `ceil(sight)` square around its tile
 * (cheap bounding box) and rejects anything outside the true circular sight
 * radius on squared distance (`renderer.ts:1041-1043`) -- the square is
 * necessarily looser than the circle it bounds, so a tile at the SQUARE's
 * corner is exactly the case the squared-distance check exists to reject;
 * `fog.test.ts` asserts this directly, not merely that revealing happens
 * somewhere.
 */
export function computeFog(prev: Uint8Array, input: FogInput): Uint8Array {
  const { width, height, entityCount, alive, side, typeIdx, posX, posY, sightByType, blocked, isLowProfile } =
    input;
  const fog = prev.slice();

  // 1. Decay: 2 -> 1, before anything re-reveals this tick.
  for (let t = 0; t < fog.length; t++) if (fog[t] === 2) fog[t] = 1;

  // 2. Reveal: only living side-0 units.
  for (let i = 0; i < entityCount; i++) {
    if (alive[i] === 0 || side[i] !== 0) continue;
    const sight = sightByType[typeIdx[i]];
    const ux = posX[i] / 65536;
    const uy = posY[i] / 65536;
    const tx = ux | 0;
    const ty = uy | 0;
    const r = Math.ceil(sight);
    for (let y = ty - r; y <= ty + r; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = tx - r; x <= tx + r; x++) {
        if (x < 0 || x >= width) continue;
        const t = y * width + x;
        if (fog[t] === 2) continue;
        const dx = x + 0.5 - ux;
        const dy = y + 0.5 - uy;
        if (dx * dx + dy * dy > sight * sight) continue;
        if (hasSight(blocked, width, isLowProfile, tx, ty, x, y)) fog[t] = 2;
      }
    }
  }

  return fog;
}

/**
 * Bresenham line-of-sight over `blocked` (`renderer.ts:1052-1071`): walls
 * cast fog shadows. The wall tile itself is always visible (you can see the
 * building you're standing next to) -- both the start and end checks below
 * return `true` before the blocked check is ever consulted for that tile.
 *
 * `isLowProfile(x, y)` exempts a tile from blocking even when `blocked[t]`
 * is set. `renderer.ts:1073-1075`'s own comment is why this exists and is
 * reproduced here rather than re-derived: "A chest-high wall casts no fog
 * shadow, because the sim lets sight and fire cross it. Without this the
 * compound's own garrison would be shooting at men the fog swears they
 * cannot see." Drop the exemption and every low-profile structure (a fence,
 * a compound wall) becomes a full sight blocker in the fog model while
 * remaining transparent to the sim's own `losRay` -- the two would disagree
 * about what a unit standing right there can see.
 */
export function hasSight(
  blocked: Uint8Array,
  w: number,
  isLowProfile: (x: number, y: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) return true;
    if (blocked[y * w + x] !== 0 && !isLowProfile(x, y)) return false;
  }
}

/**
 * True when the player can currently (not merely "ever") see this world
 * position -- `PixiRenderer.isVisible` (`renderer.ts:1193-1197`): fog value
 * exactly 2. Off-map is always `false`, matching the source's own bounds
 * check.
 */
export function isFogVisible(fog: Uint8Array, w: number, h: number, wx: number, wy: number): boolean {
  const x = wx | 0;
  const y = wy | 0;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  return fog[y * w + x] === 2;
}
