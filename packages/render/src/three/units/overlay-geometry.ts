/**
 * Phase C: the pixel-space triangle primitives every unit overlay (HP bar,
 * suppression bar, selection ring, control-group badge, order marker,
 * hover highlight, tutorial focus ring) is built from.
 *
 * Pixi draws every one of these into a single 2D `Graphics` object,
 * `unitsG` (`render-order.ts`'s own top comment has the full inventory and
 * the one exception -- the badge numeral -- that does not live there). This
 * backend has no 2D drawing API at all: three.js only knows how to rasterize
 * triangles. So every overlay shape here is expressed the same way
 * `units/fx.ts` already expresses a particle or a tracer -- pure geometry
 * arithmetic, testable with no `THREE.*` in sight -- generalised one level
 * further, because a rect/ring/triangle soup is what a 2D `Graphics` API
 * *is*, under the hood.
 *
 * ## The pixel-space billboard convention, reused rather than reinvented
 *
 * `instances.ts`'s own top comment and `fx.ts`'s `particleBillboardGeometry`
 * both derive the same two axes: `right`, purely horizontal on screen
 * (`screenOffsetToWorld(1, 0)`, a ground-plane offset touching world X and
 * Z), and world +Y scaled by `WORLD_Y_PER_LIFT_PIXEL`, purely vertical on
 * screen. Both are calibrated so that one unit along either axis reprojects
 * to exactly one equal screen pixel, and both are baked ONCE rather than
 * recomputed from the camera every frame, because this camera never orbits.
 * `billboardPoint` below is that same recipe, generalised from "the four
 * corners of one billboard quad" to "an arbitrary screen-pixel offset from
 * an arbitrary world anchor" -- the one formula every push* function in this
 * file, and every overlay `ThreeRenderer.updateOverlays` builds from them,
 * shares.
 *
 * Every push* function below takes pixel offsets in Pixi's OWN screen
 * convention -- x increasing rightward, y increasing DOWNWARD -- on purpose:
 * it is what lets a call site read as a near-verbatim transcription of the
 * `renderer.ts` line it ports, `g.rect(sx - 12, sy - r - 10, 24, 3)` becoming
 * `pushRectPx(soup, anchor, -12, -(r + 10), 12, -(r + 10) + 3, ...)`, rather
 * than a second, silently-divergent translation of Pixi's own geometry.
 *
 * ## Why one flat triangle soup, not one shape per `THREE.Mesh`
 *
 * `units/fx.ts`'s own `TracerBatch` already answers this for a shape that
 * varies per-instance in both length and direction: one non-instanced,
 * rebuilt-every-frame `BufferGeometry`, trimmed with `setDrawRange` rather
 * than toggling per-object visibility. Every overlay shape here is the same
 * kind of "varies too much for a shared-quad `InstancedMesh` to help" case
 * (a filled disc, a stroked ellipse, an arbitrary triangle, a variable-width
 * rect all need different vertex counts and positions), so `TriangleSoup`
 * generalises that same pattern to arbitrary triangles rather than fixed
 * quads, and `units/overlays.ts`'s `OverlayBatch` is `TracerBatch`'s
 * structural twin one level more general.
 *
 * `side: THREE.DoubleSide` on the material that eventually draws this soup
 * (`overlays.ts`) is what makes winding not worth tracking per shape here --
 * `instances.ts`'s own top comment notes `DoubleSide` "addresses back-face
 * culling, not depth ordering," and every overlay in this file is a flat,
 * always-camera-facing shape with no depth-ordering question of its own to
 * get wrong (`overlays.ts`'s `OverlayBatch` is `depthTest: false`, matching
 * Pixi's own "`unitsG` is painted after everything, unconditionally" -- see
 * `render-order.ts`'s own closing paragraphs for why that is faithful
 * porting, not a shortcut).
 */
import { screenOffsetToWorld } from '../terrain/shared';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';

/** World-plane delta for one screen pixel of purely horizontal movement --
 *  computed once, like every other fixed-camera billboard axis in this
 *  backend (`fx.ts`, `instances.ts`, `grove.ts`). */
const RIGHT_PER_PX = screenOffsetToWorld(1, 0);

/**
 * World xyz for the point `rightPx` screen pixels to the right and `upPx`
 * screen pixels ABOVE a given world anchor. The one shared formula every
 * push* function (and every overlay-anchor computation in `ThreeRenderer`)
 * builds a vertex or a derived anchor from -- see this file's top comment.
 */
export function billboardPoint(
  anchor: readonly [number, number, number],
  rightPx: number,
  upPx: number
): [number, number, number] {
  return [
    anchor[0] + RIGHT_PER_PX.dx * rightPx,
    anchor[1] + upPx * WORLD_Y_PER_LIFT_PIXEL,
    anchor[2] + RIGHT_PER_PX.dy * rightPx,
  ];
}

/** RGB triple in 0..1 -- the vertex-colour format every push* function
 *  below writes, matching `terrain/shared.ts`'s own `UnitColor`. */
export type OverlayColor = readonly [number, number, number];

/**
 * A flat, non-indexed triangle list -- every three consecutive vertices are
 * one triangle, no shared vertices, no index buffer. `OverlayBatch`
 * (`overlays.ts`) owns one, resets it every frame (`count = 0`) and refills
 * it from scratch, exactly like `TracerBatch` refills its own per-vertex
 * buffers every frame -- see this file's top comment for why a soup, not an
 * `InstancedMesh`, is the right shape here.
 *
 * Sized once, at construction (`createTriangleSoup`), to `vertexCapacity`
 * vertices. A push past capacity is silently dropped -- `ParticleInstancer`
 * and `TracerBatch` both already accept this trade (their own `count >=
 * capacity` early returns): losing the newest, least-likely-to-matter
 * overlay pixels under a pathological box-select is a better failure than an
 * unbounded per-frame allocation.
 */
export interface TriangleSoup {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly alphas: Float32Array;
  readonly capacity: number;
  count: number;
}

export function createTriangleSoup(vertexCapacity: number): TriangleSoup {
  return {
    positions: new Float32Array(vertexCapacity * 3),
    colors: new Float32Array(vertexCapacity * 3),
    alphas: new Float32Array(vertexCapacity),
    capacity: vertexCapacity,
    count: 0,
  };
}

export function resetSoup(soup: TriangleSoup): void {
  soup.count = 0;
}

function pushVertexPx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  xPx: number,
  yPx: number,
  color: OverlayColor,
  alpha: number
): void {
  if (soup.count >= soup.capacity) return;
  // Pixi convention: y increases DOWNWARD. `billboardPoint`'s `upPx` is
  // positive-UP, so a Pixi y offset negates going in.
  const [wx, wy, wz] = billboardPoint(anchor, xPx, -yPx);
  const i = soup.count;
  soup.positions[i * 3] = wx;
  soup.positions[i * 3 + 1] = wy;
  soup.positions[i * 3 + 2] = wz;
  soup.colors[i * 3] = color[0];
  soup.colors[i * 3 + 1] = color[1];
  soup.colors[i * 3 + 2] = color[2];
  soup.alphas[i] = alpha;
  soup.count++;
}

/** One triangle, three Pixi-convention `[xPx, yPx]` corners relative to
 *  `anchor`. Every other push* function below is built from this one. */
export function pushTrianglePx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  points: readonly (readonly [number, number])[],
  color: OverlayColor,
  alpha: number
): void {
  for (const [x, y] of points) pushVertexPx(soup, anchor, x, y, color, alpha);
}

/**
 * A filled, axis-aligned rectangle -- `pushRectPx(soup, anchor, x0, y0, x1,
 * y1, ...)` mirrors Pixi's `g.rect(x, y, w, h)` called as `(x0, y0, x1 - x0,
 * y1 - y0)`, so a call site can read `x1`/`y1` as `x0 + w`/`y0 + h` straight
 * off the Pixi source it is porting.
 */
export function pushRectPx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: OverlayColor,
  alpha: number
): void {
  pushTrianglePx(soup, anchor, [[x0, y0], [x1, y0], [x1, y1]], color, alpha);
  pushTrianglePx(soup, anchor, [[x0, y0], [x1, y1], [x0, y1]], color, alpha);
}

/**
 * A stroked straight line segment, `widthPx` wide -- Pixi's own
 * `g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width, color })`, which this
 * soup's triangle-only shape has no single-primitive equivalent for (the
 * same gap `pushRectStrokePx`'s own doc comment names for a rectangle's
 * outline, below). Built as a quad -- two triangles -- around the segment's
 * own perpendicular, in the same Pixi pixel convention (x-right, y-down)
 * every other push* function here shares via `pushTrianglePx`.
 *
 * Today's one caller: the billboard-path permanent-wreck cross marker
 * (`ThreeRenderer.updateOverlays`'s own fallback for a unit type with no
 * `wreck` clip -- Pixi's literal two-line X, `renderer.ts:1240-1241`).
 */
export function pushLinePx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  widthPx: number,
  color: OverlayColor,
  alpha: number
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const half = widthPx / 2;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  const a0: [number, number] = [x0 + nx, y0 + ny];
  const a1: [number, number] = [x0 - nx, y0 - ny];
  const b0: [number, number] = [x1 - nx, y1 - ny];
  const b1: [number, number] = [x1 + nx, y1 + ny];
  pushTrianglePx(soup, anchor, [a0, a1, b0], color, alpha);
  pushTrianglePx(soup, anchor, [a0, b0, b1], color, alpha);
}

/**
 * A rectangle's stroked OUTLINE, `strokeWidthPx` wide, as four filled
 * border rects -- the closest faithful thing to Pixi's `g.rect(...).stroke
 * ({width, ...})`, which this soup's non-indexed triangle shape has no
 * single-primitive equivalent for. The four border rects overlap slightly
 * at each corner; at the alpha values this backend's overlays use (a
 * pulsing 0.55-1.0), the doubled corner blend is not visible at gameplay
 * zoom -- documented here rather than fixed with mitred corners, which
 * would trade a few extra triangles for no visible difference.
 */
export function pushRectStrokePx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  strokeWidthPx: number,
  color: OverlayColor,
  alpha: number
): void {
  const w = strokeWidthPx;
  pushRectPx(soup, anchor, x0, y0, x1, y0 + w, color, alpha); // top
  pushRectPx(soup, anchor, x0, y1 - w, x1, y1, color, alpha); // bottom
  pushRectPx(soup, anchor, x0, y0, x0 + w, y1, color, alpha); // left
  pushRectPx(soup, anchor, x1 - w, y0, x1, y1, color, alpha); // right
}

/** Segment count `pushEllipseFanPx`/`pushEllipseRingPx` default to when the
 *  caller does not name one -- 16 is comfortably round at the pixel sizes
 *  these overlays draw at (7-25px radius); Pixi's own `.circle()`/`.ellipse()`
 *  tessellate through PixiJS's internal curve renderer, which exposes no
 *  segment count this backend could match exactly, so this is a judgement,
 *  not a measurement. Where Pixi DOES hand-write a segment count (the
 *  tutorial focus ring's manual 24-point loop, `renderer.ts`'s own `const
 *  segments = 24`), the caller passes that number explicitly instead. */
export const OVERLAY_RING_SEGMENTS = 16;

/**
 * A filled ellipse/disc, `segments` triangles fanned from `anchor`'s own
 * local origin -- Pixi's `g.circle(...).fill(...)` (`rightR === upR`, a true
 * screen circle) and, generalised, any `g.ellipse(...).fill(...)`.
 *
 * The angle parametrisation feeds `pushTrianglePx` directly, so it inherits
 * that function's Pixi (x-right, y-DOWN) convention rather than
 * `billboardPoint`'s own positive-up `upPx` -- `theta = PI / 2` therefore
 * lands BELOW `anchor`, not above it. This is deliberately unobservable in
 * the rendered output: a full 0..2*PI sweep of an ellipse centred on the
 * origin is point-symmetric under negating one axis, so every fan or ring
 * this file draws looks identical either way, just wound the other
 * direction around the loop. Documented rather than "fixed" so a future
 * reader does not go looking for a sign bug that has no visible effect --
 * and so a future PARTIAL arc (which would not have this symmetry) knows
 * which convention it is extending.
 */
export function pushEllipseFanPx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  rightR: number,
  upR: number,
  color: OverlayColor,
  alpha: number,
  segments: number = OVERLAY_RING_SEGMENTS
): void {
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: [number, number] = [Math.cos(t0) * rightR, Math.sin(t0) * upR];
    const p1: [number, number] = [Math.cos(t1) * rightR, Math.sin(t1) * upR];
    pushTrianglePx(soup, anchor, [[0, 0], p0, p1], color, alpha);
  }
}

/**
 * A stroked ellipse -- an annulus of `segments` quads around `anchor`'s own
 * local origin, `strokeWidthPx` wide, split evenly inside and outside
 * `(rightR, upR)`. Pixi's `g.ellipse(...).stroke({width, ...})` (or
 * `g.circle(...).stroke(...)` when `rightR === upR`).
 *
 * Same angle convention as `pushEllipseFanPx` (its own doc comment has the
 * full reasoning): wound through `pushTrianglePx`'s y-down input, invisible
 * in the rendered ring either way for the identical point-symmetry reason.
 */
export function pushEllipseRingPx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  rightR: number,
  upR: number,
  strokeWidthPx: number,
  color: OverlayColor,
  alpha: number,
  segments: number = OVERLAY_RING_SEGMENTS
): void {
  const half = strokeWidthPx / 2;
  const rIn = Math.max(0, rightR - half);
  const rOut = rightR + half;
  const uIn = Math.max(0, upR - half);
  const uOut = upR + half;
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    const in0: [number, number] = [Math.cos(t0) * rIn, Math.sin(t0) * uIn];
    const out0: [number, number] = [Math.cos(t0) * rOut, Math.sin(t0) * uOut];
    const in1: [number, number] = [Math.cos(t1) * rIn, Math.sin(t1) * uIn];
    const out1: [number, number] = [Math.cos(t1) * rOut, Math.sin(t1) * uOut];
    pushTrianglePx(soup, anchor, [in0, out0, out1], color, alpha);
    pushTrianglePx(soup, anchor, [in0, out1, in1], color, alpha);
  }
}

// ---------------------------------------------------------------------------
// The objective zone: the one overlay in this file that is NOT expressed as
// a screen-pixel offset from a single billboard anchor. Pixi's own zone loop
// (`renderer.ts`'s objective-zone block) projects each of the rectangle's
// FOUR corners independently -- `isoY(cx2, cy2) - this.groundOffset(cx2,
// cy2)` per corner -- because the zone is genuine ground geometry, not a
// marker hung off one unit. Every push*Px function above shares one anchor
// on purpose (`billboardPoint`'s own top comment); reusing that shape here
// would force every corner through the SAME ground height, silently
// flattening a zone that straddles a terrace edge. `pushTriangleWorld` below
// is the one exception: a raw world-space triangle, no anchor, no pixel
// offset -- the caller (`objectiveZoneCorners`) has already resolved each
// corner's own height.
// ---------------------------------------------------------------------------

/** A literal three.js world position -- game tile (x, y) plus that corner's
 *  own ground height, already resolved. Unlike every anchor above, this is
 *  not relative to anything. */
export type WorldPoint = readonly [number, number, number];

/** Writes one triangle of already-resolved world points directly, bypassing
 *  `billboardPoint` entirely -- see this section's own top comment for why
 *  the objective zone cannot share the single-anchor convention every other
 *  push* function in this file uses. */
export function pushTriangleWorld(
  soup: TriangleSoup,
  points: readonly [WorldPoint, WorldPoint, WorldPoint],
  color: OverlayColor,
  alpha: number
): void {
  if (soup.count + 3 > soup.capacity) return;
  for (const [x, y, z] of points) {
    const i = soup.count;
    soup.positions[i * 3] = x;
    soup.positions[i * 3 + 1] = y;
    soup.positions[i * 3 + 2] = z;
    soup.colors[i * 3] = color[0];
    soup.colors[i * 3 + 1] = color[1];
    soup.colors[i * 3 + 2] = color[2];
    soup.alphas[i] = alpha;
    soup.count++;
  }
}

/** The four corners of a tile-space rectangle `[zx, zy, zw, zh]`, each
 *  carrying ITS OWN ground height via `groundYAt` -- the direct three.js
 *  analogue of Pixi's own per-corner `isoY(cx2, cy2) - groundOffset(cx2,
 *  cy2)` loop. Order matches Pixi's `corners` array exactly (top-left,
 *  top-right, bottom-right, bottom-left in tile space) so a fan or a
 *  perimeter walk over the result traces the same rectangle Pixi's
 *  `g.poly(pts)` does. */
export function objectiveZoneCorners(
  zx: number,
  zy: number,
  zw: number,
  zh: number,
  groundYAt: (x: number, y: number) => number
): readonly [WorldPoint, WorldPoint, WorldPoint, WorldPoint] {
  return [
    [zx, groundYAt(zx, zy), zy],
    [zx + zw, groundYAt(zx + zw, zy), zy],
    [zx + zw, groundYAt(zx + zw, zy + zh), zy + zh],
    [zx, groundYAt(zx, zy + zh), zy + zh],
  ];
}

/** Fan-triangulates an arbitrary convex world-space polygon from its own
 *  first vertex -- Pixi's `g.poly(pts).fill(...)`, the objective zone's
 *  fill half. Any point count, same fan order `terrain/shared.ts`'s
 *  `pushPolygon` uses, but writing into a `TriangleSoup` (per-vertex alpha)
 *  rather than a terrain builder's flat position/colour/index arrays. */
export function pushPolygonFillWorld(
  soup: TriangleSoup,
  points: readonly WorldPoint[],
  color: OverlayColor,
  alpha: number
): void {
  for (let i = 1; i < points.length - 1; i++) {
    pushTriangleWorld(soup, [points[0], points[i], points[i + 1]], color, alpha);
  }
}

/**
 * A thin border around a closed world-space polygon loop -- Pixi's
 * `g.poly(pts).stroke({width, ...})`, the objective zone's outline half.
 *
 * Not a literal constant-screen-pixel-width port: Pixi's stroke is drawn
 * AFTER projection, in 2D screen space, where "outward" is a single
 * well-defined direction for the whole polygon. This backend's overlay
 * geometry is genuine pre-projection world space, and these corners each
 * carry their OWN independent height (`objectiveZoneCorners`) -- there is no
 * single per-vertex "outward" normal that stays a constant screen width once
 * reprojected through a camera whose dimetric angle foreshortens X, Y and Z
 * unequally. The practical approximation used instead: inset each corner
 * toward the polygon's own centroid by `insetTiles` world-tile units, and
 * fill the ring between the original loop and the inset one. `insetTiles` is
 * chosen once by the caller to read as a thin line at gameplay zoom (see
 * `ThreeRenderer.updateOverlays`'s own call site for the derivation from
 * Pixi's literal 2px stroke width); it is not, and does not need to be,
 * pixel-exact -- Pixi's own stroke is a state-encoding boundary marker, not
 * a measurement the player reads a value off.
 */
export function pushPolygonStrokeWorld(
  soup: TriangleSoup,
  points: readonly WorldPoint[],
  insetTiles: number,
  color: OverlayColor,
  alpha: number
): void {
  const n = points.length;
  if (n < 3) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const [x, y, z] of points) {
    cx += x;
    cy += y;
    cz += z;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const inner: WorldPoint[] = points.map(([x, y, z]) => {
    const dx = cx - x;
    const dy = cy - y;
    const dz = cz - z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const t = Math.min(insetTiles / len, 0.5);
    return [x + dx * t, y + dy * t, z + dz * t];
  });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushTriangleWorld(soup, [points[i], points[j], inner[j]], color, alpha);
    pushTriangleWorld(soup, [points[i], inner[j], inner[i]], color, alpha);
  }
}
