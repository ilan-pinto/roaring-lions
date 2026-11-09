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
 *
 * ## `pickable`
 *
 * All three take a last, optional `pickable(i)` (N1a task 4, network design
 * §5.1): a unit it rejects is skipped as if it were not there. Absent, every
 * unit is pickable, which is the answer each function gave before it.
 * `ThreeRenderer` passes its fog gate in a versus room, so a click cannot
 * select -- and so show the card, route or range of -- an enemy the fog
 * hides from this seat.
 */
import { groundLevelAt, type ElevationSource } from '../ground-height';
import { screenToWorldThree, worldToScreenThree } from '../camera';
import { ELEV_STEP, WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '../../project';
import { ELLIPSE_BY_TYPE, ELLIPSE_PAD_TILES } from './readability';

/** A left-click's generosity, in tiles: see `pickUnit`'s "default radius". */
export const PICK_RADIUS_TILES = 1.2;

/**
 * A ground vehicle's drawn hull, for the pick (the 4 Nov lead report: a right-click on an enemy tank
 * was an attack order only about half the time). `pickUnit` measures from a unit's FEET, which is
 * right for a man and wrong for a hull 2.7 tiles long: the order radius (0.5) covered the middle
 * third of a Lavi, so a click on its nose or its flank was an attack-move to the ground, and a unit
 * already firing on something else simply went on firing on it.
 *
 * The hull's box, in tiles, from the same generated footprint table as the selection ring and the
 * proxy box (`ELLIPSE_BY_TYPE` less `ELLIPSE_PAD_TILES`): its centre sits `offset` along its heading
 * from the unit's origin, and it is `halfLength` either side of that along the heading and
 * `halfWidth` across it.
 */
export interface HullShape {
  readonly offset: number;
  readonly halfLength: number;
  readonly halfWidth: number;
}

/** Which units are hulls, and which way each faces. */
export interface HullPick {
  /** The unit's hull, or null for a unit that is picked from its feet alone. */
  shapeOf(i: number): HullShape | null;
  /** Its heading, in turns (the sim's `facing`, as `fx.toNumber` reads it). */
  heading(i: number): number;
}

/**
 * How far past the hull's edge a click may land and still be on the hull, tiles. Not the order
 * radius: the hull is already a body, so this is only the slack a click on the rim wants. Well
 * under 0.5, so ground a tile from a tank is still an attack-move to that ground (R-23).
 */
export const HULL_PICK_MARGIN_TILES = 0.2;

/**
 * How tall a hull is drawn, tiles, turret included: the Lavi stands about 3 m (a tile is 3 m). The
 * ground a hull hides reaches this much past `PICK_BODY_HEIGHT_TILES`' rifleman, proportionally.
 */
export const PICK_HULL_HEIGHT_TILES = 1.0;
const HULL_REACH_SCALE = PICK_HULL_HEIGHT_TILES / 0.6;

/**
 * The hull pick for a roster: a type's `HullShape` from the generated footprint table (a type with no
 * row is a point, picked from its feet as before), cached per type id. `typeIdOf` and `headingOf`
 * read the live sim, so one `HullPick` serves a whole mission.
 */
export function hullPickFor(typeIdOf: (i: number) => string, headingOf: (i: number) => number): HullPick {
  const cache = new Map<string, HullShape | null>();
  return {
    shapeOf(i: number): HullShape | null {
      const id = typeIdOf(i);
      let shape = cache.get(id);
      if (shape === undefined) {
        const e = ELLIPSE_BY_TYPE[id];
        shape =
          e === undefined
            ? null
            : {
                offset: e.offsetAlong,
                halfLength: Math.max(0, e.along - ELLIPSE_PAD_TILES),
                halfWidth: Math.max(0, e.across - ELLIPSE_PAD_TILES),
              };
        cache.set(id, shape);
      }
      return shape;
    },
    heading: headingOf,
  };
}

/**
 * Squared distance from the click's ground point to the ground the hull hides: 0 anywhere on the
 * body. A body of height `H` hides the ground from its footprint out to `reach` beyond it (up the
 * screen), so the region is the hull's box swept along `reach`. In the hull's own frame the box is
 * axis-aligned and the distance to it is separable; the sweep is a single parameter `t` in [0, 1]
 * and the squared distance is convex in it, so a ternary search finds the nearest shift.
 */
function hullScoreSq(
  wx: number,
  wy: number,
  cx: number,
  cy: number,
  shape: HullShape,
  headingTurns: number,
  reachX: number,
  reachY: number
): number {
  const a = headingTurns * Math.PI * 2;
  const dirX = Math.cos(a);
  const dirY = Math.sin(a);
  // The click, the box centre and the reach in the hull's frame: l along the heading, w across it.
  const rx = wx - (cx + shape.offset * dirX);
  const ry = wy - (cy + shape.offset * dirY);
  const l = rx * dirX + ry * dirY;
  const w = -rx * dirY + ry * dirX;
  const rl = reachX * dirX + reachY * dirY;
  const rw = -reachX * dirY + reachY * dirX;
  const at = (t: number): number => {
    const dl = Math.max(0, Math.abs(l - t * rl) - shape.halfLength);
    const dw = Math.max(0, Math.abs(w - t * rw) - shape.halfWidth);
    return dl * dl + dw * dw;
  };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 14; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (at(m1) <= at(m2)) hi = m2;
    else lo = m1;
  }
  return Math.min(at(lo), at(hi), at(0), at(1));
}

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
  radiusTiles = PICK_RADIUS_TILES,
  reachX = 0,
  reachY = 0,
  pickable: (i: number) => boolean = () => true,
  radiusFloor?: (i: number) => number,
  hull?: HullPick,
  reachScale?: (i: number) => number
): number {
  let best = -1;
  let bestTier = 2;
  let bestD = Infinity;
  let bestFeet = Infinity;
  const reach2 = reachX * reachX + reachY * reachY;
  // A hull's body is taller than a rifleman's, so the ground it hides reaches further up the screen.
  const hullReachX = reachX * HULL_REACH_SCALE;
  const hullReachY = reachY * HULL_REACH_SCALE;
  const marginSq = HULL_PICK_MARGIN_TILES * HULL_PICK_MARGIN_TILES;
  for (let i = 0; i < entityCount; i++) {
    if (alive[i] === 0) continue;
    // A buried unit has no body on the surface to click -- see this
    // function's own doc comment for why this is not optional.
    if (tunnelIn[i] >= 0) continue;
    // A unit this viewer may not select (a fogged enemy in a versus room,
    // network design §5.1) is passed over, never a blocker.
    if (!pickable(i)) continue;
    const fx = wx - curX[i];
    const fy = wy - curY[i];
    const feet = fx * fx + fy * fy;
    // GH-1007 P2: an air unit is drawn `lift` pixels above its tile, so the ground its drawn hull hides reaches
    // that much further up the screen. `reachScale(i)` is 1 for every unit that is not lifted, and then this unit
    // reads the SAME reach variables as before, bit for bit (a ground unit never takes the branch).
    let rX = reachX;
    let rY = reachY;
    let r2 = reach2;
    let hX = hullReachX;
    let hY = hullReachY;
    if (reachScale !== undefined) {
      const k = reachScale(i);
      if (k !== 1) {
        rX = reachX * k;
        rY = reachY * k;
        r2 = rX * rX + rY * rY;
        hX = hullReachX * k;
        hY = hullReachY * k;
      }
    }
    // Distance to the segment from the feet to `reach` beyond them (the
    // ground the unit's body hides); with no reach, the feet alone.
    const t = r2 > 0 ? Math.min(1, Math.max(0, (fx * rX + fy * rY) / r2)) : 0;
    const dx = fx - t * rX;
    const dy = fy - t * rY;
    const d = dx * dx + dy * dy;
    // Two tiers. TIER 0 is the old test, untouched: the unit's feet-and-body segment within the radius. TIER 1 is
    // a hull-only hit: a ground vehicle whose box covers the click though its feet do not reach it (a nose, a
    // flank). A tier-0 unit always outranks a tier-1 one, so a hull only ADDS candidates and can never displace the
    // old winner (the review of PR 1015: a hull scores 0 anywhere on its body, and ranked by score alone it beat a
    // rifleman standing in front of it, on both clicks). Within a tier: the lower score, then the nearer feet.
    const limit = radiusFloor ? Math.max(radiusTiles, radiusFloor(i)) : radiusTiles;
    const tier = d <= limit * limit ? 0 : 1;
    let score = d;
    if (tier === 1) {
      let ok = false;
      if (hull !== undefined) {
        const shape = hull.shapeOf(i);
        if (shape !== null) {
          const h = hullScoreSq(wx, wy, curX[i], curY[i], shape, hull.heading(i), hX, hY);
          if (h <= marginSq) {
            score = h;
            ok = true;
          }
        }
      }
      if (!ok) continue;
    }
    // Two bodies under one pixel (one figure standing in front of another):
    // the nearer feet win, which is the rule this had before bodies.
    if (tier < bestTier || (tier === bestTier && (score < bestD || (score === bestD && feet < bestFeet)))) {
      bestTier = tier;
      bestD = score;
      bestFeet = feet;
      best = i;
    }
  }
  return best;
}

/**
 * How tall a body is drawn, in tiles: a rifleman, `proxy-box.ts`'s `foot`
 * class (0.6 tile, ~23 px at zoom 1 -- the "about 25 px" soldier). The
 * smallest body that stands in a group; a vehicle's length is already inside
 * the 1.2-tile radius around its body.
 */
export const PICK_BODY_HEIGHT_TILES = 0.6;

/**
 * The unit a left-click at screen pixel (`px`, `py`) picks, or -1.
 *
 * `pickUnit` alone answers "which unit's FEET are nearest the ground this
 * pixel's ray meets", and for a pixel on a unit's body that ground is BEHIND
 * the unit, up the screen -- a click 8 px up a rifleman meets the ground
 * half a tile behind him. In a group that ground belongs to his neighbour:
 * measured on `beit_sahwan_outskirts` after a group order, two squads 0.40
 * tiles apart, a click on the front squad's body selected the one behind it
 * at 8, 16 and 24 px above its feet, and the right-click that followed moved
 * the wrong squad. The unit-side twin of PA-14's facade pick.
 *
 * So the click is measured against the ground each body HIDES -- the segment
 * from its feet to where the ray past the top of a body that tall meets the
 * ground -- rather than against the feet alone. The reach is one vector for
 * every unit: the camera is orthographic, so it depends on the camera's
 * pitch and yaw and not on where the unit stands. Asked of the camera, never
 * re-derived here.
 *
 * `radiusTiles` is how far from that segment a click may land: a left-click's
 * 1.2 by default. An ORDER asks a tighter radius of the same segment (GH-420,
 * R-23), so a right-click on ground a tile from an enemy stays an order to
 * that ground; one pick, two generosities.
 *
 * `radiusFloor` (E6, chunk B) is a per-unit MINIMUM on that radius: a swarm entity stands for a
 * cloud 1.5 tiles across, so a click anywhere in the cloud picks it even at the order radius.
 *
 * `liftPx` (GH-1007 P2) is how many lift pixels the renderer draws unit `i` above its tile
 * (`AIR_LIFT_PX * airLiftFrac`, read from the renderer and never recomputed here; 0 for a ground
 * unit). The ground a lifted body hides reaches that much further up the screen, so the whole drawn
 * hull is pickable at the tight order radius. Absent, or 0, every unit is picked exactly as before.
 */
export function pickUnitAtScreen(
  px: number,
  py: number,
  curX: Float64Array,
  curY: Float64Array,
  alive: Uint8Array,
  tunnelIn: Int32Array,
  entityCount: number,
  elevation: ElevationSource,
  mapWidth: number,
  mapHeight: number,
  cam: Camera,
  vp: Viewport,
  pickable: (i: number) => boolean = () => true,
  radiusTiles: number = PICK_RADIUS_TILES,
  radiusFloor?: (i: number) => number,
  hull?: HullPick,
  liftPx?: (i: number) => number
): number {
  const g = screenToWorldThree(px, py, cam, vp, elevation, mapWidth, mapHeight);
  const top = worldToScreenThree(cam.x, cam.y, cam, vp, PICK_BODY_HEIGHT_TILES / WORLD_Y_PER_LIFT_PIXEL);
  const behind = screenToWorldThree(top.x, top.y, cam, vp);
  // GH-1007 P2: the reach is linear in lift (the camera is orthographic), so a unit drawn `lift` px above its tile
  // hides `1 + lift / bodyPx` times the ground a body on the ground does. Only a lifted unit scales; the rest read 1.
  const bodyLiftPx = PICK_BODY_HEIGHT_TILES / WORLD_Y_PER_LIFT_PIXEL;
  const reachScale = liftPx === undefined ? undefined : (i: number): number => {
    const l = liftPx(i);
    return l > 0 ? 1 + l / bodyLiftPx : 1;
  };
  return pickUnit(g.x, g.y, curX, curY, alive, tunnelIn, entityCount, radiusTiles, behind.x - cam.x, behind.y - cam.y, pickable, radiusFloor, hull, reachScale);
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
 *
 * `liftPx` (GH-1007 P2): for a unit it reads above 0 (an air unit, `AIR_LIFT_PX * airLiftFrac`), the
 * drawn hull point, `lift` px above the feet, is projected as well and either may be inside the box.
 * Absent, or 0, only the feet are tested, as before.
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
  vp: Viewport,
  pickable: (i: number) => boolean = () => true,
  liftPx?: (i: number) => number
): number[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const out: number[] = [];
  for (let i = 0; i < entityCount; i++) {
    if (alive[i] === 0) continue;
    if (!pickable(i)) continue;
    const x = curX[i];
    const y = curY[i];
    const groundPx = groundLevelAt(elevation, mapWidth, mapHeight, x, y) * ELEV_STEP;
    const { x: sx, y: sy } = worldToScreenThree(x, y, cam, vp, groundPx);
    if (sx >= lo.x && sx <= hi.x && sy >= lo.y && sy <= hi.y) {
      out.push(i);
      continue;
    }
    // GH-1007 P2: an air unit is DRAWN `lift` px above its feet, so a box round the floating hull alone must catch it
    // too. The feet stay a hit (a box round the shadow or the tile selected it before); the drawn point is added.
    const lift = liftPx === undefined ? 0 : liftPx(i);
    if (lift > 0) {
      const { x: hx, y: hy } = worldToScreenThree(x, y, cam, vp, groundPx + lift);
      if (hx >= lo.x && hx <= hi.x && hy >= lo.y && hy <= hi.y) out.push(i);
    }
  }
  return out;
}
