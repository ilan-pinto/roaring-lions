/**
 * The kit mark: the small steel plate with one to three bars that sits over
 * every living side-0 unit whose type has bought kit (garage uplift spec
 * §3.4 A, `docs/superpowers/specs/2026-09-25-garage-uplift-design.md`).
 * Kit is BOUGHT, per type, and it is a steel plate; veterancy is EARNED, per
 * named unit, and it is a gold chevron. So the mark borrows the kit family's
 * plate from the garage glyph (`packages/app/src/ui/kit-sign.ts`) and never a
 * shape or a colour from the chevron (D2, D3): steel `gunmetal.0` with a
 * `shadow.0` outline and bars, clear of veterancy's `dust.0` gold, the team
 * blue and the lime selection. It is drawn into the existing `OverlayBatch`
 * at band 4 (D1: +0 draw calls) and scales with zoom like every other
 * overlay, with no minimum size (D6).
 *
 * ## Why this file is pure
 *
 * The same split `overlay-geometry.ts` makes: the shape is arithmetic, so it
 * lives here with no `THREE.*` and is tested to the pixel, and the renderer
 * only pushes the triangles this file hands it. Nothing here allocates per
 * unit per frame -- `kitMarkTriangles` builds each (radius, level) pair once
 * and returns the same frozen lists thereafter.
 *
 * ## The pixel convention
 *
 * Box-local numbers (`kitPlateOutline`, `kitPlateSteel`, `kitBarRects`) are
 * measured from the box's top-left corner, x right, y DOWN. `kitMarkTriangles`
 * places them relative to the unit's overlay anchor in Pixi's own screen
 * convention, x right and y down, at zoom 1 -- the convention every push*
 * function in `overlay-geometry.ts` takes, so a call site reads as
 * `rect(anchor, x0, y0, x1, y1)` like the HP bar beside it.
 *
 * ## The numbers
 *
 * `KIT_MARK` is the table the lead approved at gate G-N (2026-09-26, option
 * A: a 10 x 12 box). `kit-mark.test.ts` compares the two one for one; change
 * a number in both places or in neither.
 */

export type MarkPoint = readonly [number, number];
export type KitMarkLevel = 1 | 2 | 3;

/** G-N's table, as code. Box-local numbers are measured from the box's
 *  top-left, y down; `bottomAboveR` is how far the box's bottom edge sits
 *  above the anchor, as an offset from the overlay radius r. */
export const KIT_MARK = Object.freeze({
  widthPx: 10,
  heightPx: 12,
  /** One pixel over the HP bar, whose top edge is r + 10 above the anchor. */
  bottomAboveR: 11,
  bevelUpPx: 3,
  /** `packages/app/src/ui/mark.ts`'s chevron: 14 across for every 24 up (`CHEVRON_SWEEP`, `kit-sign.ts`). */
  bevelSweep: 14 / 24,
  outlinePx: 1,
  barWidthPx: 4,
  barHeightPx: 2,
  barGapPx: 1,
  /** The lowest bar's bottom edge, box-local: bar 1 sits at the bottom and the level climbs. */
  firstBarBottomPx: 10,
});

export const KIT_COLOR_KEY = 'gunmetal.0';
export const KIT_EDGE_COLOR_KEY = 'shadow.0';
export const KIT_COLOR_FALLBACK = '#C3C7C4';
export const KIT_EDGE_COLOR_FALLBACK = '#23241F';

/** Three flat triangle lists (every three points are one triangle), in
 *  anchor-relative Pixi pixels: the whole plate in the edge colour, the
 *  steel drawn over it, and the bars drawn over that in the edge colour. */
export interface KitMarkTriangles {
  readonly edge: readonly MarkPoint[];
  readonly steel: readonly MarkPoint[];
  readonly bars: readonly MarkPoint[];
}

/** The plate's outer hexagon, box-local: the box with its two upper corners
 *  bevelled `bevelUpPx` down and `bevelUpPx * bevelSweep` across. */
export function kitPlateOutline(): readonly MarkPoint[] {
  const { widthPx: w, heightPx: h, bevelUpPx: b, bevelSweep: s } = KIT_MARK;
  const run = b * s;
  return [
    [0, h],
    [0, b],
    [run, 0],
    [w - run, 0],
    [w, b],
    [w, h],
  ];
}

/** Every edge of a convex polygon moved `d` inward, and neighbours
 *  intersected: vertex i lies on the inset of edges i-1 and i. The inward
 *  side is found from the centroid, so winding does not matter.
 *
 *  Each edge a->b becomes the line n.p = c with n its unit normal turned to
 *  face the centroid and c = n.a + d; two neighbouring lines meet where
 *  Cramer's rule says. At a corner that turns by angle phi, the inset vertex
 *  therefore sits d * tan(phi / 2) along each edge from where the outer
 *  corner's perpendicular foot would be -- which is what puts the plate's
 *  bevel inner corners at (1, 3.270) and (2.324, 1). */
function insetConvex(poly: readonly MarkPoint[], d: number): MarkPoint[] {
  const n = poly.length;
  const cx = poly.reduce((s, p) => s + p[0], 0) / n;
  const cy = poly.reduce((s, p) => s + p[1], 0) / n;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny);
    nx /= len;
    ny /= len;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny, c: nx * a[0] + ny * a[1] + d };
  });
  return lines.map((l, i) => {
    const k = lines[(i - 1 + n) % n];
    const det = k.nx * l.ny - k.ny * l.nx;
    return [(k.c * l.ny - k.ny * l.c) / det, (k.nx * l.c - k.c * l.nx) / det] as const;
  });
}

/** The steel face: the plate inset by the outline width, so a
 *  `outlinePx`-wide band of the edge colour shows round it. */
export function kitPlateSteel(): readonly MarkPoint[] {
  return insetConvex(kitPlateOutline(), KIT_MARK.outlinePx);
}

/** One `[x0, y0, x1, y1]` rect per level, box-local, bar 0 lowest. */
export function kitBarRects(level: KitMarkLevel): readonly (readonly [number, number, number, number])[] {
  const { widthPx: w, barWidthPx: bw, barHeightPx: bh, barGapPx: g, firstBarBottomPx: y0 } = KIT_MARK;
  const x0 = (w - bw) / 2;
  const out: (readonly [number, number, number, number])[] = [];
  for (let k = 0; k < level; k++) {
    const bottom = y0 - k * (bh + g);
    out.push([x0, bottom - bh, x0 + bw, bottom]);
  }
  return out;
}

/** Vertices one marked unit costs: two fanned hexagons (4 triangles each)
 *  plus two triangles a bar -- 24 + 6 x level. */
export function kitMarkVertexCount(level: KitMarkLevel): number {
  return 2 * 3 * (6 - 2) + 6 * level;
}

function fan(poly: readonly MarkPoint[]): MarkPoint[] {
  const out: MarkPoint[] = [];
  for (let i = 1; i < poly.length - 1; i++) out.push(poly[0], poly[i], poly[i + 1]);
  return out;
}

function rectTriangles([x0, y0, x1, y1]: readonly [number, number, number, number]): MarkPoint[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Box-local to anchor-relative: centred in x, bottom edge r + bottomAboveR up. */
function place(points: readonly MarkPoint[], r: number): readonly MarkPoint[] {
  const top = -(r + KIT_MARK.bottomAboveR + KIT_MARK.heightPx);
  return Object.freeze(points.map(([x, y]) => Object.freeze([x - KIT_MARK.widthPx / 2, top + y] as const)));
}

/** `RendererOptions.unitKit` as one byte per sim type index, rebuilt by the
 *  caller when the sim's type count changes. Own keys only, and only an
 *  integer 1-3 is a level: anything else draws no mark, never a wrong one. */
export function kitLevelsByType(
  typeIds: readonly string[],
  unitKit: Readonly<Record<string, number>> | undefined
): Uint8Array {
  const out = new Uint8Array(typeIds.length);
  if (unitKit === undefined) return out;
  typeIds.forEach((id, i) => {
    if (!Object.prototype.hasOwnProperty.call(unitKit, id)) return;
    const v = unitKit[id];
    if (v === 1 || v === 2 || v === 3) out[i] = v;
  });
  return out;
}

/** Keyed `r * 4 + level`, a number, so a lookup allocates nothing: this is
 *  called per own kitted unit per frame. r is the zoom-1 overlay radius
 *  (`unitOverlayRadiusPx`, an integer), and level is 1-3, so no two pairs
 *  share a key. */
const cache = new Map<number, KitMarkTriangles>();

/** The mark for a unit of overlay radius `r` at kit `level`, built once per
 *  (r, level) and returned as the same frozen object on every later call. */
export function kitMarkTriangles(r: number, level: KitMarkLevel): KitMarkTriangles {
  const key = r * 4 + level;
  const hit = cache.get(key);
  if (hit) return hit;
  const built: KitMarkTriangles = Object.freeze({
    edge: place(fan(kitPlateOutline()), r),
    steel: place(fan(kitPlateSteel()), r),
    bars: place(kitBarRects(level).flatMap(rectTriangles), r),
  });
  cache.set(key, built);
  return built;
}
