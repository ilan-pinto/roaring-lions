/**
 * Task B3.8: picking. `ThreeRenderer.pickUnit` and `unitsInScreenRect` have
 * thrown since Phase B1 -- deliberately, per that class's own top comment:
 * `-1` and `[]` both mean "you clicked empty ground", and inventing either
 * would be believed. The throw was correct then; both are now implemented,
 * ported from `PixiRenderer`'s own members (`renderer.ts:974-1013`).
 *
 * ## `pickUnit` is not a projection question
 *
 * The B3 brief calls both members "projection questions". Only
 * `unitsInScreenRect` is. `pickUnit(wx, wy, radiusTiles)` takes WORLD
 * coordinates already -- Pixi's own version does a nearest-entity search by
 * squared distance against `curX`/`curY`, no projection anywhere inside it.
 * The screen-to-world conversion happens once, at the call site
 * (`main.ts:928`, `renderer.pickUnit(w.x, w.y)` where `w` came from
 * `screenToWorld`) -- not in here. So `pickUnit` below is plain arithmetic
 * over plain arrays, same as `unitsInScreenRect`, but for a different reason:
 * it never touches a camera at all.
 *
 * ## Both are pure, and that is the point
 *
 * Neither needs a GPU, a raycast, or a DOM -- exactly the shape every other
 * builder in this phase uses (`frame-state.ts`, the terrain builders under
 * `../terrain/`), and the reason all of them are testable in
 * `environment: 'node'` even though `ThreeRenderer` itself is not.
 */
import { groundLevelAt, type ElevationSource } from '../ground-height';
import { worldToScreenThree } from '../camera';
import { ELEV_STEP, type Camera, type Viewport } from '../../project';

/**
 * Nearest living, surfaced unit within `radiusTiles` of a world point, or -1.
 *
 * Ported from `PixiRenderer.pickUnit` (`renderer.ts:995-1013`) verbatim, over
 * plain arrays instead of `Sim`/`this.curX`/`this.curY` so it needs neither a
 * `Sim` nor a `ThreeRenderer` instance to test.
 *
 * Two things Pixi's version does that are load-bearing, both kept exactly:
 *  - **The buried-unit skip.** A unit with `tunnelIn[i] >= 0` is inside a
 *    route, with no body on the surface to click -- every command already
 *    refuses one, so without this skip a click near a buried unit's mouth
 *    would select a ghost: a ring around empty ground.
 *  - **The default radius**, `1.2` tiles. Not a rendering choice -- it is
 *    how forgiving a click has to be to reliably hit a unit's sprite, and a
 *    different default between backends would make the same click hit in
 *    Pixi and miss in three.js, a gameplay difference wearing a rendering
 *    costume.
 */
export function pickUnit(
  wx: number,
  wy: number,
  curX: Float64Array,
  curY: Float64Array,
  alive: Uint8Array,
  tunnelIn: Int32Array,
  entityCount: number,
  radiusTiles = 1.2
): number {
  let best = -1;
  let bestD = radiusTiles * radiusTiles;
  for (let i = 0; i < entityCount; i++) {
    if (alive[i] === 0) continue;
    // A buried unit has no body on the surface to click -- see this
    // function's own doc comment for why this is not optional.
    if (tunnelIn[i] >= 0) continue;
    const dx = curX[i] - wx;
    const dy = curY[i] - wy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Living units whose projected FEET fall inside a screen-space rect.
 *
 * Ported from `PixiRenderer.unitsInScreenRect` (`renderer.ts:974-992`).
 * Unlike `pickUnit`, this genuinely is a projection question -- Pixi
 * computes `isoX(x, y)` / `isoY(x, y) - groundOffset(x, y)`, i.e. the
 * screen point of a unit's own tile, lifted up the screen by that tile's
 * elevation, exactly the point its feet stand on. `groundOffset(x, y)` is
 * `level * ELEV_STEP` (`renderer.ts:706-712`); `groundLevelAt` below is the
 * three.js side's already-tested equivalent of that same tile lookup
 * (`ground-height.ts`), and `worldToScreenThree`'s own `lift` parameter is
 * proven (`camera.test.ts`, "puts higher ground higher on screen, and by the
 * same amount Pixi does") to reproduce `project.worldToScreen`'s `lift`
 * pixel-for-pixel -- so `groundLevelAt(...) * ELEV_STEP` fed through it as
 * `lift` reproduces Pixi's `isoY(x, y) - groundOffset(x, y)` exactly, on flat
 * ground and on relief alike.
 *
 * Deliberately does NOT skip buried units: Pixi's own `unitsInScreenRect`
 * has no `tunnelIn` check either (only `pickUnit` does) -- ported faithfully,
 * not "fixed" to match its sibling.
 *
 * Projects each living unit's own FEET, not a body-centre point one sprite-
 * height higher -- see this task's break-check 3. A box drawn low around a
 * unit's base must still catch it; a box drawn low that only catches a
 * higher "centre" point would silently miss short units and over-select on
 * relief where the two diverge most.
 */
export function unitsInScreenRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  curX: Float64Array,
  curY: Float64Array,
  alive: Uint8Array,
  entityCount: number,
  elevation: ElevationSource,
  mapWidth: number,
  mapHeight: number,
  cam: Camera,
  vp: Viewport
): number[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const out: number[] = [];
  for (let i = 0; i < entityCount; i++) {
    if (alive[i] === 0) continue;
    const x = curX[i];
    const y = curY[i];
    const liftPx = groundLevelAt(elevation, mapWidth, mapHeight, x, y) * ELEV_STEP;
    const { x: sx, y: sy } = worldToScreenThree(x, y, cam, vp, liftPx);
    if (sx >= lo.x && sx <= hi.x && sy >= lo.y && sy <= hi.y) out.push(i);
  }
  return out;
}
