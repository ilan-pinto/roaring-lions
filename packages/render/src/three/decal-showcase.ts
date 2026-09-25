/**
 * The decal showcase (D4, Task 15 of `docs/superpowers/plans/2026-09-25-
 * ground-plan-1.md`): a fixed, dated set of ground marks -- every decal kind,
 * at three sizes each -- stamped near an anchor so one frame shows the whole
 * vocabulary the ground can remember a battle in.
 *
 * Pure and three-free, like `decal-maths.ts` (F-27): `tools` imports
 * `showcaseSites` to aim the gated `aftermath` scenario's camera, and a tools
 * test must not pull `three` into `pnpm test`. `ThreeRenderer` does the
 * stamping, and it does it through `stampGroundDecal` -- the SAME entry a
 * vehicle kill, a shell landing, a collapse and a moving vehicle use -- so the
 * showcase photographs the real path rather than a parallel one that could
 * drift from it. It reaches the renderer as the three-only
 * `RendererOptions.decalShowcase` (R-16), never as a `Renderer` method.
 *
 * ## Sites
 *
 * Up to three, one of each kind, every one inside `SHOWCASE_RING` (measured
 * from the anchor's tile centre to the site's) and at least
 * `SHOWCASE_SEPARATION` tiles from every site already chosen:
 *
 * - `road`: an unblocked `r` tile -- the decal's ground tone is the road's,
 *   not the sand's, which is what fix round 2's per-decal denominator exists
 *   for.
 * - `relief`: an open tile whose drawn-surface normal has `y <
 *   SHOWCASE_RELIEF_NORMAL_Y`, steepest first -- the conforming grid and the
 *   sag lift (F-23) on a real slope. A flat map has none, and the site is
 *   simply absent.
 * - `flat`: an open tile with `normal.y >= SHOWCASE_FLAT_NORMAL_Y` whose
 *   eight neighbours are open too -- the reference the other two are judged
 *   against.
 *
 * "Open" is unblocked plain ground: `blocked === 0` and no decor at all. A
 * grove's trees would hide the marks, a knoll or a ditch has its own albedo,
 * and a road tile belongs to the road site.
 *
 * Chosen in the order road, relief, flat -- scarcest first, so the kind most
 * likely to have a single candidate is not shut out by the separation rule
 * from a kind that has hundreds. Every ordering tie is broken by
 * `(distance, y, x)`, so the answer is a pure function of the map.
 *
 * ## Stamps (per site, 24)
 *
 * - A 3 x 4 lattice at a 1-tile pitch centred on the site's tile centre.
 *   Columns west to east are `SHOWCASE_POWERS`; rows north to south are
 *   crater, scorch, oil, rubble. Crater and scorch take the power through
 *   their own approved curves (`craterRadiusTiles`, `scorchRadiusTiles`);
 *   oil has one size; rubble takes a 1x1, 2x2 and 3x3 footprint by column
 *   (`rubbleRadiusTiles`).
 * - A tread run (east-west) and a tyre run (north-south), `SHOWCASE_RUN`
 *   stamps each at `STAMP_SPACING_TILES`, centred on the site -- one mark
 *   per stamp, not a vehicle's pair, so the run reads as one clean print.
 *
 * Every stamp is dated `simMs: 0` (R-14): its fade then depends only on the
 * tick a capture pins, never on how many ticks a boot loop happened to run
 * first. Its seed is `tileHash(site.x * 31 + k, site.y * 17 + k)` for the
 * stamp's index `k` within its site.
 */
import { tileHash } from '../tile-hash';
import {
  craterRadiusTiles,
  OIL_RADIUS_TILES,
  rubbleRadiusTiles,
  TRACK_STAMP_HALF_LENGTH,
  type DecalKind,
  type DecalStamp,
} from './decal-maths';
import { scorchRadiusTiles } from './scorch-decals';
import { STAMP_SPACING_TILES, TRACK_FOOTPRINT } from './vehicle-tracks';
import { DECOR_ROAD } from './terrain/shared';
import { surfaceNormal, type TerrainSurface } from './terrain/surface';
import type { TerrainInput } from './terrain/types';

export type ShowcaseSiteKind = 'flat' | 'relief' | 'road';

/** A tile, not a point: the site's marks centre on `(x + 0.5, y + 0.5)`. */
export interface ShowcaseSite {
  readonly kind: ShowcaseSiteKind;
  readonly x: number;
  readonly y: number;
}

/** Inner and outer radius, tiles, from the anchor's tile centre. Outside
 *  the inner one so the showcase does not sit under the sandbox force the
 *  anchor spawns; inside the outer one so all three sites share a frame. */
export const SHOWCASE_RING: readonly [number, number] = [4, 9];

/** The three columns' power: a mortar bomb, a Grad rocket, a full kill. */
export const SHOWCASE_POWERS: readonly [number, number, number] = [0.3, 0.45, 1];

/** The least distance between two sites, tiles -- a site's lattice spans
 *  3 x 4 tiles, so two sites this far apart do not share a mark. */
export const SHOWCASE_SEPARATION = 4;

/** A relief site's normal must tip at least this far from vertical. */
export const SHOWCASE_RELIEF_NORMAL_Y = 0.98;

/** A flat site's normal must be at least this close to vertical. */
export const SHOWCASE_FLAT_NORMAL_Y = 0.999;

/** Stamps in each of the two track runs. */
export const SHOWCASE_RUN = 6;

/** The lattice's rows, north to south. */
const LATTICE_ROWS: readonly Exclude<DecalKind, 'tread' | 'tyre'>[] = ['crater', 'scorch', 'oil', 'rubble'];

interface Candidate {
  readonly x: number;
  readonly y: number;
  readonly d: number;
  /** Normal y at the tile centre; only relief orders by it. */
  readonly ny: number;
}

function byDistanceYX(a: Candidate, b: Candidate): number {
  return a.d - b.d || a.y - b.y || a.x - b.x;
}

/**
 * The showcase's sites around `anchor` (a tile), in the order they were
 * chosen: road, relief, flat, each present only if the map has one. See this
 * file's top comment for the rules.
 */
export function showcaseSites(
  input: TerrainInput,
  surface: TerrainSurface,
  anchor: { x: number; y: number }
): readonly ShowcaseSite[] {
  const { width: w, height: h, blocked, decor } = input;
  const acx = Math.floor(anchor.x) + 0.5;
  const acy = Math.floor(anchor.y) + 0.5;
  const [inner, outer] = SHOWCASE_RING;
  const decorAt = (x: number, y: number): number => (decor === null ? 0 : decor[y * w + x]);
  const isOpen = (x: number, y: number): boolean =>
    x >= 0 && x < w && y >= 0 && y < h && blocked[y * w + x] === 0 && decorAt(x, y) === 0;

  const road: Candidate[] = [];
  const relief: Candidate[] = [];
  const flat: Candidate[] = [];
  const y0 = Math.max(0, Math.floor(acy - outer));
  const y1 = Math.min(h - 1, Math.ceil(acy + outer));
  const x0 = Math.max(0, Math.floor(acx - outer));
  const x1 = Math.min(w - 1, Math.ceil(acx + outer));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - acx, y + 0.5 - acy);
      if (d < inner || d > outer) continue;
      if (blocked[y * w + x] !== 0) continue;
      if (decorAt(x, y) === DECOR_ROAD) {
        road.push({ x, y, d, ny: 1 });
        continue;
      }
      if (!isOpen(x, y)) continue;
      const ny = surfaceNormal(surface, x + 0.5, y + 0.5)[1];
      if (ny < SHOWCASE_RELIEF_NORMAL_Y) {
        relief.push({ x, y, d, ny });
      } else if (ny >= SHOWCASE_FLAT_NORMAL_Y) {
        let ring = true;
        for (let dy = -1; dy <= 1 && ring; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx !== 0 || dy !== 0) && !isOpen(x + dx, y + dy)) {
              ring = false;
              break;
            }
          }
        }
        if (ring) flat.push({ x, y, d, ny });
      }
    }
  }
  road.sort(byDistanceYX);
  relief.sort((a, b) => a.ny - b.ny || byDistanceYX(a, b));
  flat.sort(byDistanceYX);

  const sites: ShowcaseSite[] = [];
  const pick = (kind: ShowcaseSiteKind, pool: readonly Candidate[]): void => {
    for (const c of pool) {
      if (sites.every((s) => Math.hypot(s.x - c.x, s.y - c.y) >= SHOWCASE_SEPARATION)) {
        sites.push({ kind, x: c.x, y: c.y });
        return;
      }
    }
  };
  pick('road', road);
  pick('relief', relief);
  pick('flat', flat);
  return sites;
}

/** The half extents of a lattice cell's mark, by row kind and column. */
function latticeRadius(kind: Exclude<DecalKind, 'tread' | 'tyre'>, col: number): number {
  const power = SHOWCASE_POWERS[col];
  switch (kind) {
    case 'crater':
      return craterRadiusTiles(power);
    case 'scorch':
      return scorchRadiusTiles(power);
    case 'oil':
      return OIL_RADIUS_TILES;
    case 'rubble':
      // A 1x1, 2x2 and 3x3 footprint, as inclusive tile bounds.
      return rubbleRadiusTiles(0, 0, col, col);
  }
}

/**
 * Every stamp the showcase lays over `sites`, 24 per site, in a fixed order:
 * the lattice row by row, then the tread run, then the tyre run. See this
 * file's top comment.
 */
export function decalShowcase(sites: readonly ShowcaseSite[]): readonly DecalStamp[] {
  const out: DecalStamp[] = [];
  for (const site of sites) {
    const cx = site.x + 0.5;
    const cz = site.y + 0.5;
    let k = 0;
    const seed = (): number => {
      const s = tileHash(site.x * 31 + k, site.y * 17 + k);
      k++;
      return s;
    };
    for (let row = 0; row < LATTICE_ROWS.length; row++) {
      const kind = LATTICE_ROWS[row];
      for (let col = 0; col < SHOWCASE_POWERS.length; col++) {
        const r = latticeRadius(kind, col);
        out.push({
          kind,
          x: cx + (col - (SHOWCASE_POWERS.length - 1) / 2),
          z: cz + (row - (LATTICE_ROWS.length - 1) / 2),
          halfLength: r,
          halfWidth: r,
          facingRad: 0,
          seed: seed(),
          simMs: 0,
        });
      }
    }
    // Tread east-west (facing 0 lays the length along +X), tyre north-south
    // (a quarter turn lays it along +Z) -- `GridPlacement`'s convention.
    // The unit vectors are written out rather than taken from `cos`/`sin`,
    // which would leave the tyre run 6e-17 off its column.
    const runs: readonly { kind: 'tread' | 'tyre'; facingRad: number; ux: number; uz: number; halfWidth: number }[] = [
      { kind: 'tread', facingRad: 0, ux: 1, uz: 0, halfWidth: TRACK_FOOTPRINT.tracked.halfWidthTiles },
      { kind: 'tyre', facingRad: Math.PI / 2, ux: 0, uz: 1, halfWidth: TRACK_FOOTPRINT.wheeled.halfWidthTiles },
    ];
    for (const run of runs) {
      const { ux, uz } = run;
      for (let i = 0; i < SHOWCASE_RUN; i++) {
        const along = (i - (SHOWCASE_RUN - 1) / 2) * STAMP_SPACING_TILES;
        out.push({
          kind: run.kind,
          x: cx + ux * along,
          z: cz + uz * along,
          halfLength: TRACK_STAMP_HALF_LENGTH,
          halfWidth: run.halfWidth,
          facingRad: run.facingRad,
          seed: seed(),
          simMs: 0,
        });
      }
    }
  }
  return out;
}
