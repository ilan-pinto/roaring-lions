/**
 * Olive groves: one dominant tree per grove tile, a second smaller one on
 * roughly a third of them, each a splayed two-stem trunk under a three-lobe
 * crown. Ported from `drawCanopy` (`renderer.ts:1675-1757`) and the flat
 * trunk shadow at `renderer.ts:1561`.
 *
 * THE NEW PROBLEM (why this file is not just another `scatter.ts` mark):
 * every mark `buildScatter` places is a flat quad lying on a tile's own
 * ground plane -- true of a limestone fleck, a rut, even a ridge's rock
 * blob. A canopy is the first thing in Phase B2 that is meant to have
 * *height*: it must occlude terrain standing behind it, which only works if
 * its geometry actually stands above the ground rather than painting a
 * bigger, greener version of the same flat trick.
 *
 * The choice made here: trunk and crown are camera-facing billboards --
 * quads standing upright, always facing the viewer. That is the "billboards
 * first" framing Phase B's own spec uses, and it is cheap to make *correct*
 * rather than merely plausible because this camera never orbits: azimuth and
 * pitch are fixed for the whole game (`camera.ts`), so "facing the camera"
 * is not a per-frame computation, it is two constant world-space axes baked
 * in at build time --
 *
 *   - a local "right" axis, horizontal and independent of pitch: pushing a
 *     point along it is exactly what a *pure-horizontal* screen offset does
 *     to a flat mark, so `screenOffsetToWorld(pxRight, 0)` (already proven
 *     correct by `scatter.test.ts`) already computes it -- no new basis
 *     vector needs deriving or testing.
 *   - a local "up" axis: world Y itself. A billboard that stands upright in
 *     world Y (rather than tilting to face the camera's own tilted "up",
 *     which a full spherical billboard would do) is both simpler and more
 *     correct for a tree that has to look like it is standing on the
 *     ground from every zoom level, and its scale is `WORLD_Y_PER_LIFT_PIXEL`
 *     -- the exact constant elevation itself uses for "a pixel of pure
 *     vertical screen rise, with no ground movement."
 *
 * So every corner in this file is authored as a `[rightPx, upPx]` pair local
 * to a tree's own ground anchor -- `rightPx` run through `screenOffsetToWorld`
 * for (x, z), `upPx` scaled by `WORLD_Y_PER_LIFT_PIXEL` for true world-Y
 * height -- which is what turns Pixi's flat canopy drawing into standing
 * geometry without inventing a new projection this module would have to
 * re-derive by hand. The ground anchor itself (where in the tile the trunk
 * base sits) is placed exactly like a scatter mark: a full two-axis
 * `screenOffsetToWorld` offset from the tile centre, clamped the same way,
 * for the same reason (`pushMark`'s doc comment in `scatter.ts`).
 *
 * Depth between the tree's own overlapping layers (trunk under crown, dark
 * lobes under the sunlit highlights) is real geometry, not alpha order --
 * this file carries no alpha channel, per the palette-quantised-composite
 * rule every terrain builder follows. Each layer is composited on the CPU
 * over what Pixi actually draws it on top of (the highlight over its own
 * base lobe's colour, matching `scatter.ts`'s blob/highlight chain) and then
 * nudged a hair closer to the camera along world Y, the same guaranteed-safe
 * trick `scatter.ts`'s `HIGHLIGHT_EPSILON` uses (world Y is monotonic with
 * camera distance for this fixed pitch, independent of pan or zoom) so the
 * depth test always resolves the layers in the same order Pixi's paint order
 * would have.
 */
import { WORLD_PER_LEVEL } from './ground';
import { WORLD_Y_PER_LIFT_PIXEL } from '../camera';
import { TILE_W, TILE_H } from '../../project';
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import { screenOffsetToWorld } from './scatter';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

export type { MeshData, TerrainInput };

/** Mirrors `DECOR.grove` (`@lions/data`'s `map.ts`) and the same redeclaration
 *  in `scatter.ts`/`tones.ts` -- `@lions/render` must not depend on
 *  `@lions/data` (ESLint-enforced), so every terrain builder keeps its own
 *  copy of the handful of DECOR values it reads. */
const DECOR_GROVE = 2;

/** Half the unit tile, minus a small margin -- identical to `scatter.ts`'s
 *  own `CLAMP_LIMIT`, redeclared for the same reason every other private
 *  cross-module constant here is: `scatter.ts` does not export it, and is
 *  under review, so this module keeps its own copy rather than widening that
 *  file's surface. A tree's ground anchor is clamped to this from the tile
 *  centre, exactly like a scatter mark. */
const CLAMP_MARGIN = 0.02;
const CLAMP_LIMIT = 0.5 - CLAMP_MARGIN;

/** Marks sit this far above the exact ground plane so a flat mark (the
 *  trunk shadow) does not z-fight the tile-top quad directly beneath it --
 *  same constant, same reasoning as `scatter.ts`'s own `MARK_EPSILON`. */
const MARK_EPSILON = 0.01;

/**
 * Per-layer nudge toward the camera (added to world Y after real height),
 * one per paint layer in the order Pixi actually draws them: trunk body,
 * its lit edge, the crown's three dark lobes (all one layer -- they never
 * need to out-rank each other), the sun-mid highlight over those, and the
 * brightest highlight over that. Each strictly larger than the last, same
 * order of magnitude as `scatter.ts`'s `HIGHLIGHT_EPSILON` (0.02) -- large
 * enough to always win the depth test against a neighbouring layer's own
 * real height variation at this scale, small enough that no tree reads as
 * "floating apart."
 */
const TRUNK_EPSILON = 0.005;
const TRUNK_LIT_EPSILON = 0.01;
const CROWN_EPSILON = 0.02;
const CROWN_MID_EPSILON = 0.03;
const CROWN_LIT_EPSILON = 0.04;

/** Trunk shadow: `renderer.ts:1561`'s flat ellipse, `t.rock` at alpha 0.22,
 *  offset `cy + 3`, radii (9, 4.5). */
const SHADOW_OFFSET_Y = 3;
const SHADOW_RX = 9;
const SHADOW_RY = 4.5;
const SHADOW_ALPHA = 0.22;

function hexToUnit(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Mirrors `ground.ts`'s private `levelAt` (also redeclared in `scatter.ts`
 *  for the same reason): elevation level (0-9) at `(x, y)`, or 0 off the
 *  map. */
function levelAt(input: TerrainInput, x: number, y: number): number {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return 0;
  if (!input.elevation) return 0;
  return input.elevation[y * input.width + x];
}

/** A billboard corner, local to a tree's own ground anchor: `right` in
 *  screen-pixel-equivalent units along the camera's local right axis,
 *  `up` the same along world Y (positive is up, away from the ground). */
type Corner = readonly [right: number, up: number];

/** Four corners approximating an ellipse as a diamond -- top, right, bottom,
 *  left around `(cr, cu)` -- the exact technique `scatter.ts`'s own
 *  `diamondCorners` uses to turn every `g.ellipse().fill()` call in
 *  `renderer.ts` into one flat quad. Same shape, ordered so a single shared
 *  winding (`flip: false` below) is correct for every quad this module
 *  builds -- verified directly by this file's own winding test, not assumed
 *  from `scatter.ts`'s (a different plane, orthogonal reasoning). */
function ellipseCorners(cr: number, cu: number, rr: number, ru: number): readonly [Corner, Corner, Corner, Corner] {
  return [
    [cr, cu + ru],
    [cr + rr, cu],
    [cr, cu - ru],
    [cr - rr, cu],
  ];
}

/** Four corners of a rectangle spanning `[rMin, rMax] x [uMin, uMax]`, in the
 *  same top-left/top-right/bottom-right/bottom-left rotational order. */
function rectCorners(rMin: number, rMax: number, uMin: number, uMax: number): readonly [Corner, Corner, Corner, Corner] {
  return [
    [rMin, uMax],
    [rMax, uMax],
    [rMax, uMin],
    [rMin, uMin],
  ];
}

export function buildGroves(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // A single shared winding for every quad in this file: every one of them
  // lies in one of exactly two planes (a tree's camera-facing billboard
  // plane, or the ground plane the trunk shadow sits flat on), and both were
  // authored so their own top/right/bottom/left (or top-left/.../bottom-left)
  // corner order already traces the correct front-facing perimeter -- see
  // `ellipseCorners`/`rectCorners` above and the flat diamond built by
  // `pushShadow` below. No quad here needs the alternate winding
  // `ground.ts`'s east/south faces do, so there is no `flip` parameter to
  // thread through -- one fan direction, confirmed by this file's own
  // winding test rather than assumed.
  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    color: [number, number, number]
  ): void => {
    const base = positions.length / 3;
    for (const p of [p0, p1, p2, p3]) positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2]);
    indices.push(base + 0, base + 2, base + 1, base + 0, base + 3, base + 2);
  };

  /**
   * The trunk shadow: a flat ground mark, positioned and clamped exactly
   * like `scatter.ts`'s own `pushMark` (that function is private to that
   * module and under review, so this is a small, single-purpose copy rather
   * than a second export added there).
   */
  const pushShadow = (originX: number, originZ: number, topY: number, colorHex: string): void => {
    const color = hexToUnit(colorHex);
    const corners: readonly (readonly [number, number])[] = [
      [0, -SHADOW_RY],
      [SHADOW_RX, 0],
      [0, SHADOW_RY],
      [-SHADOW_RX, 0],
    ];
    const center = screenOffsetToWorld(0, SHADOW_OFFSET_Y);
    const cornerDeltas = corners.map(([cdx, cdy]) => screenOffsetToWorld(cdx, cdy));
    let maxAbsDX = 0;
    let maxAbsDZ = 0;
    for (const d of cornerDeltas) {
      maxAbsDX = Math.max(maxAbsDX, Math.abs(d.dx));
      maxAbsDZ = Math.max(maxAbsDZ, Math.abs(d.dy));
    }
    const limitX = Math.max(0, CLAMP_LIMIT - maxAbsDX);
    const limitZ = Math.max(0, CLAMP_LIMIT - maxAbsDZ);
    const centerX = Math.max(-limitX, Math.min(limitX, center.dx));
    const centerZ = Math.max(-limitZ, Math.min(limitZ, center.dy));
    const roomX = CLAMP_LIMIT - Math.abs(centerX);
    const roomZ = CLAMP_LIMIT - Math.abs(centerZ);
    let scale = 1;
    if (maxAbsDX > 0) scale = Math.min(scale, roomX / maxAbsDX);
    if (maxAbsDZ > 0) scale = Math.min(scale, roomZ / maxAbsDZ);
    const world = cornerDeltas.map(
      (d) =>
        [originX + centerX + d.dx * scale, topY + MARK_EPSILON, originZ + centerZ + d.dy * scale] as [
          number,
          number,
          number,
        ]
    );
    pushQuad(world[0], world[1], world[2], world[3], color);
  };

  /**
   * One tree instance (trunk + crown), anchored at `(originTileX,
   * originTileZ)` -- the tile centre plus a jittered, clamped ground offset
   * -- and standing on `topY`. `tw`/`th` are the trunk's half-width/height,
   * `rx`/`ry` the crown's own half-extents, all still in Pixi's screen-pixel
   * units -- exactly what `renderer.ts:1699-1732` computes, unconverted.
   */
  const pushTree = (
    tileX: number,
    tileZ: number,
    topY: number,
    offsetPxX: number,
    offsetPxY: number,
    tw: number,
    th: number,
    rx: number,
    ry: number,
    trunkHex: string,
    trunkLitHex: string,
    leafDarkHex: string,
    leafMidHex: string,
    leafLitHex: string
  ): void => {
    // Splayed two-stem trunk (renderer.ts:1699-1708): a flared trapezoid,
    // narrower at the top, plus a small lit rect near its crown-facing edge.
    const trunkQuad: readonly [Corner, Corner, Corner, Corner] = [
      [-tw, 0],
      [-tw * 0.45, th],
      [tw * 0.45, th],
      [tw, 0],
    ];
    const trunkHlQuad = rectCorners(-tw * 0.15, tw * 0.35, th - 1, th + 1);

    // Crown: three overlapping dark lobes (renderer.ts:1710-1723), then a
    // sun-mid and a brightest highlight biased toward the upper-left, the
    // 135-degree key the sprites use (renderer.ts:1724).
    const crownBaseU = th + ry * 0.62;
    const lobe0 = ellipseCorners(0, crownBaseU, rx, ry);
    const lobe1 = ellipseCorners(-rx * 0.44, crownBaseU - ry * 0.16, rx * 0.52, ry * 0.72);
    const lobe2 = ellipseCorners(rx * 0.44, crownBaseU - ry * 0.2, rx * 0.46, ry * 0.66);
    const hlMid = ellipseCorners(-rx * 0.22, crownBaseU + ry * 0.3, rx * 0.62, ry * 0.5);
    const hlLit = ellipseCorners(-rx * 0.38, crownBaseU + ry * 0.46, rx * 0.3, ry * 0.26);

    // Every corner across every quad of this one tree, gathered once so the
    // whole tree clamps and scales together -- pushMark's own doc comment
    // (scatter.ts) explains why per-quad clamping is wrong: it can leave
    // some corners of a shared shape repositioned and others not, producing
    // a near-degenerate quad. Only the RIGHT component matters for the
    // ground-footprint clamp -- UP is real world height, never ground
    // position, so it never pushes a vertex outside the tile.
    const allCorners: readonly Corner[] = [
      ...trunkQuad,
      ...trunkHlQuad,
      ...lobe0,
      ...lobe1,
      ...lobe2,
      ...hlMid,
      ...hlLit,
    ];
    let maxAbsDX = 0;
    let maxAbsDZ = 0;
    for (const [right] of allCorners) {
      const g = screenOffsetToWorld(right, 0);
      maxAbsDX = Math.max(maxAbsDX, Math.abs(g.dx));
      maxAbsDZ = Math.max(maxAbsDZ, Math.abs(g.dy));
    }
    const anchorGround = screenOffsetToWorld(offsetPxX, offsetPxY);
    const limitX = Math.max(0, CLAMP_LIMIT - maxAbsDX);
    const limitZ = Math.max(0, CLAMP_LIMIT - maxAbsDZ);
    const centerX = Math.max(-limitX, Math.min(limitX, anchorGround.dx));
    const centerZ = Math.max(-limitZ, Math.min(limitZ, anchorGround.dy));
    const roomX = CLAMP_LIMIT - Math.abs(centerX);
    const roomZ = CLAMP_LIMIT - Math.abs(centerZ);
    let scale = 1;
    if (maxAbsDX > 0) scale = Math.min(scale, roomX / maxAbsDX);
    if (maxAbsDZ > 0) scale = Math.min(scale, roomZ / maxAbsDZ);

    const originX = tileX + centerX;
    const originZ = tileZ + centerZ;

    const toWorld = (corner: Corner, epsilon: number): [number, number, number] => {
      const g = screenOffsetToWorld(corner[0], 0);
      return [originX + g.dx * scale, topY + corner[1] * WORLD_Y_PER_LIFT_PIXEL * scale + epsilon, originZ + g.dy * scale];
    };

    const pushBillboard = (quad: readonly [Corner, Corner, Corner, Corner], colorHex: string, epsilon: number): void => {
      const color = hexToUnit(colorHex);
      const w = quad.map((c) => toWorld(c, epsilon));
      pushQuad(w[0], w[1], w[2], w[3], color);
    };

    pushBillboard(trunkQuad, trunkHex, TRUNK_EPSILON);
    pushBillboard(trunkHlQuad, trunkLitHex, TRUNK_LIT_EPSILON);
    pushBillboard(lobe0, leafDarkHex, CROWN_EPSILON);
    pushBillboard(lobe1, leafDarkHex, CROWN_EPSILON);
    pushBillboard(lobe2, leafDarkHex, CROWN_EPSILON);
    pushBillboard(hlMid, leafMidHex, CROWN_MID_EPSILON);
    pushBillboard(hlLit, leafLitHex, CROWN_LIT_EPSILON);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      if (input.blocked[ti] !== 0) continue;
      if ((input.decor ? input.decor[ti] : 0) !== DECOR_GROVE) continue;

      const levelHere = levelAt(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const baseHex = groundTone(input, tones, ti, PALETTE_HEXES, background);

      pushShadow(cx, cz, topY, quantise(composite(baseHex, tones.rock, SHADOW_ALPHA), PALETTE_HEXES));

      // One dominant tree, a second smaller one on the same threshold Pixi
      // uses (renderer.ts:1690).
      const twin = tileHash(x * 3, y * 7) > 0.62;
      const count = twin ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const a = tileHash(x * 13 + k * 5, y * 29 + k * 3);
        const b = tileHash(x * 37 + k * 2, y * 11 + k * 7);
        const scale = k === 0 ? 1 : 0.68;
        const offsetPxX = (a - 0.5) * (TILE_W - 30) + (k === 0 ? 0 : 9);
        const offsetPxY = (b - 0.5) * (TILE_H - 16) + (k === 0 ? 0 : 4);

        const tw = 3.2 * scale;
        const th = (5.5 + a * 2.5) * scale;
        const rx = (12.5 + b * 4) * scale;
        const ry = rx * tones.crownRatio;

        const trunkHex = quantise(composite(baseHex, tones.trunk, 0.98), PALETTE_HEXES);
        const trunkLitHex = quantise(composite(trunkHex, tones.trunkLit, 0.5), PALETTE_HEXES);
        const leafDarkHex = quantise(composite(baseHex, tones.leafDark, 0.97), PALETTE_HEXES);
        const leafMidHex = quantise(composite(leafDarkHex, tones.leafMid, 0.92), PALETTE_HEXES);
        const leafLitHex = quantise(composite(leafMidHex, tones.leafLit, 0.8), PALETTE_HEXES);

        pushTree(
          cx,
          cz,
          topY,
          offsetPxX,
          offsetPxY,
          tw,
          th,
          rx,
          ry,
          trunkHex,
          trunkLitHex,
          leafDarkHex,
          leafMidHex,
          leafLitHex
        );
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
  };
}
