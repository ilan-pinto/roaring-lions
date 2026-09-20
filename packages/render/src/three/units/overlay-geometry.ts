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
import { WORLD_Y_PER_LIFT_PIXEL, isoX, isoY } from '../../project';

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
 *
 * That future arrived as `pushEllipseAnnulusFillPx` below (Task 16, the
 * range-ring fill) and it did NOT need the partial case after all: R-12
 * settled the "designed arc" as the fill's outer BOUNDARY rather than a
 * facing sector, so the annulus is a full 0..2*PI sweep and inherits this
 * same y-down winding, symmetry and all. A genuinely partial sweep is still
 * unwritten, and this paragraph is still what it would be extending.
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
 * A filled ANNULUS -- `segments` quads between an inner ellipse
 * `(rIn, uIn)` and an outer one `(rOut, uOut)`, both centred on `anchor`'s
 * own local origin. The general shape `pushEllipseRingPx` below is now a
 * special case of: a stroke is an annulus whose two radii straddle one
 * nominal radius by half the stroke width.
 *
 * Shell Phase 2, Task 16: the range rings draw as one filled band from a
 * weapon's minimum range to its effective range instead of three competing
 * hoops (spec S6, ruling R-12 -- the "designed arc" is that fill's outer
 * BOUNDARY, never a facing sector, because `selectTarget` gates a shot on
 * identification and range and never on bearing, and no weapon in
 * `data/units/` declares a traverse limit).
 *
 * **A zero inner radius is a disc**, deliberately and without a branch: at
 * `rIn === uIn === 0` every inner point collapses onto the local origin, so
 * the first triangle of each segment is the fan triangle `pushEllipseFanPx`
 * would write and the second has zero area and rasterizes nothing. That is
 * what lets the ring block hand `Math.sqrt(minRangeSq)` straight in --
 * most weapons have no minimum range, and a mortar's is the only case where
 * the hole is real.
 *
 * Same angle convention as `pushEllipseFanPx` (its own doc comment has the
 * full reasoning): wound through `pushTrianglePx`'s y-down input, invisible
 * in the rendered shape either way for the identical point-symmetry reason.
 */
export function pushEllipseAnnulusFillPx(
  soup: TriangleSoup,
  anchor: readonly [number, number, number],
  rIn: number,
  uIn: number,
  rOut: number,
  uOut: number,
  color: OverlayColor,
  alpha: number,
  segments: number = OVERLAY_RING_SEGMENTS
): void {
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

/**
 * A stroked ellipse -- an annulus of `segments` quads around `anchor`'s own
 * local origin, `strokeWidthPx` wide, split evenly inside and outside
 * `(rightR, upR)`. Pixi's `g.ellipse(...).stroke({width, ...})` (or
 * `g.circle(...).stroke(...)` when `rightR === upR`).
 *
 * One line, into `pushEllipseAnnulusFillPx` above, since Task 16 gave that
 * shape a second caller: one piece of geometry, two callers, so a change to
 * the annulus that drifts from the stroke turns every ring test in
 * `overlay-geometry.test.ts` red rather than quietly changing what a
 * selection ring or a charge ring looks like.
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
  pushEllipseAnnulusFillPx(
    soup,
    anchor,
    Math.max(0, rightR - half),
    Math.max(0, upR - half),
    rightR + half,
    upR + half,
    color,
    alpha,
    segments
  );
}

// ---------------------------------------------------------------------------
// Colour, for the range-ring fill. Plain sRGB-byte arithmetic with no `THREE`
// import, which is what keeps this module the node-testable pure half (see
// this file's own top comment).
//
// Ruling R-5 (shell Phase 2): the fill is DERIVED from the resolved team hex
// at draw time rather than being a new `data/palette.json` entry. G0 decision
// #3 keeps the colour-vision variants and says a new colour "rides through
// the existing team-colour resolver and makes no accessibility claim" -- and
// a palette entry would need FOUR rows (`reserved.team.colors` plus the three
// `reserved.team.variants.*` blocks), so choosing three variant values would
// be exactly that claim. One helper over `this.opts.teamColors[side]`, which
// `main.ts` already resolves per variant through `paletteTeamColors`, and the
// accessibility setting follows for free.
// ---------------------------------------------------------------------------

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToBytes(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bytesToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Drains colour out of `hex` toward grey while HOLDING its luminance.
 * `amount` 0 returns the same colour (lower-cased), 1 returns the neutral
 * grey of the same brightness.
 *
 * Each channel is lerped toward the colour's own Rec.709 luma. That the
 * luma is preserved exactly is arithmetic rather than a tuning choice: the
 * three weights sum to 1, so the new luma is `L + amount * (L - L)`. It
 * matters because the alternative -- lerping toward a fixed mid-grey --
 * would darken the yellow team colour and lighten the blue one, and the fill
 * is drawn at low alpha over terrain whose own brightness varies, where a
 * shift in lightness reads as a different shape rather than a different hue.
 */
export function desaturateHex(hex: string, amount: number): string {
  const [r, g, b] = hexToBytes(hex);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const drain = (c: number): number => clampByte(c + (luma - c) * amount);
  return bytesToHex(drain(r), drain(g), drain(b));
}

/**
 * HSL saturation, 0..1 -- the instrument spec S6's acceptance clause (c)
 * ("the capture pass at zoom 2.5 shows no saturated ring fill") is measured
 * with, so that clause is a number in a test rather than a look at a picture.
 *
 * HSL rather than HSV on purpose: HSV would report the pale yellow variant
 * `#F0E442` as far less saturated than it reads on screen, because HSV
 * divides by the brightest channel and that channel is nearly 255. HSL
 * divides by how much room the colour has left at its own lightness, which
 * is the harsher and more honest question for a fill drawn over ground.
 */
export function hexSaturation(hex: string): number {
  const [r, g, b] = hexToBytes(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const denom = 255 - Math.abs(max + min - 255);
  return denom === 0 ? 0 : (max - min) / denom;
}

/**
 * How far the range-ring fill is drained from the team hue.
 *
 * **Measured, not chosen.** The task brief proposed 0.6, and at 0.6 SEVEN of
 * the twelve shipped team colours (five distinct hexes) miss the 0.35
 * saturation budget the same brief sets -- seen red, by running it: default
 * `neutral` `#E8C33A` 0.4321, deuteranopia and protanopia `kedem` `#0072B2`
 * 0.3838, their `hostile` `#D55E00` 0.3846, and worst their `neutral`
 * `#F0E442` at **0.5520**. 0.80 still misses, at 0.3535. At 0.85 all twelve
 * clear it -- worst 0.2826, next-worst 0.1884, and the two colours a range
 * ring can actually draw in (`kedem`, `hostile`) sit at 0.1193-0.1444.
 *
 * Why `#F0E442` is the hard one, since it is not obviously the loudest of
 * the twelve: HSL saturation divides the channel spread by how much room the
 * colour has left at its own lightness, and a pale yellow has very little.
 * That is the instrument being harsh in the right direction, not a defect in
 * it (see `hexSaturation`). It is also a colour no range ring can ever draw
 * in -- `neutral` is side 2, civilians, who carry no weapons -- and it is
 * still held to the budget on purpose, because the point of reading all
 * twelve off disk is that a variant added later is covered the day it lands.
 *
 * The budget was NOT widened to admit 0.6. The brief's own reason for reading
 * all twelve off `data/palette.json` is that "a variant with a colour this
 * ruling cannot desaturate fails here rather than on screen" -- so the ruling
 * is what gave way, which is also the direction acceptance clause (c) wants:
 * a fill that is drained further is never the defect that clause names.
 */
export const RANGE_FILL_DESATURATE = 0.85;

/**
 * How strong the range-ring fill reads in TOTAL, over ground every selected
 * unit can reach -- not the alpha any one unit's annulus is drawn at. See
 * `rangeFillAlphaFor` for why those are different numbers.
 */
export const RANGE_FILL_ALPHA = 0.14;

/**
 * The alpha ONE unit's range fill is drawn at, given how many units are
 * drawing one, so that the total where they all overlap is always
 * `RANGE_FILL_ALPHA`.
 *
 * **This is the difference between a fill and a stroke, and it was
 * photographed before it was reasoned about.** The three hoops this replaces
 * were strokes: thin lines, so six selected units cost six thin lines and
 * overlapping them cost nothing. A FILL compounds. Six annuli at a flat 0.14
 * composite to `1 - 0.86^6 = 0.596` -- and at zoom 2.5 an effective-range
 * annulus covers most of the frame, so `pnpm ui:shots`' own
 * `09-hud-zoom2.5` (six units selected, the state that exists for exactly
 * this) came back with the sand, the camouflage and the trees all washed to
 * one blue-grey. Correct by every test in this file and plainly wrong on
 * screen.
 *
 * So the constant above is declared as the TOTAL and this inverts the `over`
 * compositing that produces it: N layers of alpha `a` leave `(1 - a)^N` of
 * the background, so `a = 1 - (1 - RANGE_FILL_ALPHA)^(1/N)` makes the
 * overlap read at `RANGE_FILL_ALPHA` for any N. One unit draws at 0.140, six
 * at 0.025, twelve at 0.012.
 *
 * What that trades away, stated rather than hidden: ground only ONE unit of
 * a large selection can reach is drawn very faintly. That is the right way
 * round for this shape -- the fill is an area hint and the ARC is the edge a
 * distance is read off, and the arc is a stroke drawn at full strength
 * whatever N is, exactly like the hoops it inherits from.
 */
export function rangeFillAlphaFor(drawing: number): number {
  if (drawing <= 1) return RANGE_FILL_ALPHA;
  return 1 - Math.pow(1 - RANGE_FILL_ALPHA, 1 / drawing);
}

/** The fill's outer BOUNDARY -- "reach fades out at this line" (R-12).
 *  Brighter than the fill it bounds, and the one edge of the shape the
 *  player is meant to read a distance off. */
export const RANGE_ARC_ALPHA = 0.55;

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

/**
 * A stroked straight line between two arbitrary WORLD points -- neither an
 * anchor-relative offset (every push*Px function above) nor a pre-resolved
 * polygon corner (the objective-zone section above). Its one caller is the
 * engagement-reticle "duel line" (`ThreeRenderer.updateOverlays`, ported from
 * `renderer.ts`'s `g.moveTo(sx0, sy0).lineTo(rx, ry).stroke(...)`): a shooter
 * and its current target are two INDEPENDENT entities, arbitrarily far apart,
 * so there is no single shared anchor to express both endpoints as small
 * pixel offsets from -- the one precondition every anchor-based push*Px
 * function relies on.
 *
 * The camera is a fixed orthographic dimetric projection with no perspective
 * foreshortening, so a straight 3D segment between two world points always
 * projects to a straight 2D segment between their screen positions, and
 * `project.ts`'s pure `isoX`/`isoY` arithmetic and `three/camera.ts`'s real
 * camera agree on every point by construction (that file's own doc comment:
 * its pitch is chosen exactly so the two projections agree). `project.ts`'s
 * own top comment warns "a three.js backend will NOT use these functions --
 * there the projection is the camera"; this is not that -- `isoX`/`isoY` are
 * used here only to find which SCREEN direction the segment already runs in,
 * so a constant-pixel-width stroke can be built around it. Nothing here
 * places anything the real camera will draw; only `pushTriangleWorld`'s
 * plain world coordinates, at the end, do that.
 */
export function pushLineWorld(
  soup: TriangleSoup,
  p0: WorldPoint,
  p1: WorldPoint,
  widthPx: number,
  color: OverlayColor,
  alpha: number
): void {
  // Forward-project both endpoints to Pixi's own screen convention
  // (x-right, y-down): `isoY(...) - lift` is `worldToScreen`'s own formula,
  // with `lift` recovered from `p*[1]` the same way `billboardPoint`'s
  // `upPx * WORLD_Y_PER_LIFT_PIXEL` produces it in the first place.
  const s0x = isoX(p0[0], p0[2]);
  const s0y = isoY(p0[0], p0[2]) - p0[1] / WORLD_Y_PER_LIFT_PIXEL;
  const s1x = isoX(p1[0], p1[2]);
  const s1y = isoY(p1[0], p1[2]) - p1[1] / WORLD_Y_PER_LIFT_PIXEL;
  const dx = s1x - s0x;
  const dy = s1y - s0y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const half = widthPx / 2;
  // Perpendicular, in screen pixels -- `pushLinePx`'s own identical formula.
  const nxPx = (-dy / len) * half;
  const nyPx = (dx / len) * half;
  // Convert that pixel-space perpendicular back into a world vector via the
  // SAME per-pixel basis `billboardPoint` uses (`RIGHT_PER_PX`,
  // `WORLD_Y_PER_LIFT_PIXEL`) -- both are translation-invariant, so the one
  // offset vector computed here is valid added at EITHER endpoint without
  // needing either one's own anchor.
  const offX = RIGHT_PER_PX.dx * nxPx;
  const offY = -nyPx * WORLD_Y_PER_LIFT_PIXEL; // Pixi y-down -> world-Y-up
  const offZ = RIGHT_PER_PX.dy * nxPx;
  const a0: WorldPoint = [p0[0] + offX, p0[1] + offY, p0[2] + offZ];
  const a1: WorldPoint = [p0[0] - offX, p0[1] - offY, p0[2] - offZ];
  const b0: WorldPoint = [p1[0] - offX, p1[1] - offY, p1[2] - offZ];
  const b1: WorldPoint = [p1[0] + offX, p1[1] + offY, p1[2] + offZ];
  pushTriangleWorld(soup, [a0, a1, b0], color, alpha);
  pushTriangleWorld(soup, [a0, b0, b1], color, alpha);
}
