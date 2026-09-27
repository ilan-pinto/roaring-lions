/**
 * Where props (ground plan 2, Task 3's seven-shape kit) stand: a headless,
 * three-free rule, the same shape `decor-place.ts` already gives grass, sand,
 * trees, rock and the ditch -- unit-tested directly rather than inferred from
 * a render.
 *
 * N-8/N-12, approved by the lead: a yard object (water tank, satellite dish,
 * laundry line, tyre pile, rebar) rolls at 0.10 within 1-2 tiles of a building
 * tile (Chebyshev), a roadside object (jersey barrier, wrecked car, tyre pile,
 * rebar) rolls at 0.07 within 0.54-0.96 tile of the road centreline, every
 * prop keeps 1.5 tiles from every other, and a map carries at most 150.
 *
 * Randomness is `tileHash`, the same deterministic hash `decor-place.ts` uses
 * and for the same reason: two hashes that merely both looked random would
 * scatter differently per backend. Each roll gets its own offset stream so
 * one roll's outcome never leaks into another's.
 */
import { tileHash } from '../../tile-hash';
import { cachedRoadGraph, SCATTER_ROAD_CLEAR } from './decor-place';
import { roadDistanceAt, type RoadGraph } from './road-graph';
import { DECOR_GROVE, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { PropKind } from './prop-role';
import { buildTerrainSurface, surfaceWorldY } from './surface';
import type { TerrainInput } from './types';

const TAU = Math.PI * 2;

/** A map carries at most this many props (N-8, lead-approved). */
export const PROP_CAP = 150;

/** Minimum distance, in tiles, between any two accepted props (N-8). */
export const PROP_SPACING = 1.5;

/** Chebyshev tiles from a building tile (`isBuildingTile`) a yard candidate's
 *  own tile must fall in -- inclusive both ends (N-9). */
export const YARD_BAND: readonly [number, number] = [1, 2];

/** Distance in tiles from the road centreline (`roadDistanceAt`) a roadside
 *  candidate's own (jittered) point must fall in -- inclusive both ends
 *  (N-9). The low end is `SCATTER_ROAD_CLEAR` (`decor-place.ts`'s R-3
 *  clearance, `ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF`), so a roadside prop never
 *  stands closer to the road than a scattered grass tuft is allowed to --
 *  the same shoulder every other family already respects. */
export const ROADSIDE_BAND: readonly [number, number] = [SCATTER_ROAD_CLEAR, 0.96];

/** Chance a qualifying tile seeds a yard candidate (N-9, lead-approved). */
export const YARD_P = 0.1;

/** Chance a qualifying tile seeds a roadside candidate (N-9, lead-approved). */
export const ROADSIDE_P = 0.07;

/**
 * The yard band's weighted kind mix (R-5). Every entry here is a kind that
 * never stands roadside (`ROADSIDE_MIX` below carries none of them) --
 * `water_tank`, `satellite_dish` and `laundry_line` are fixtures of a
 * building's own plot, and a jersey barrier or a wrecked car in someone's
 * yard would read as a road object that wandered off its own set-dressing
 * class.
 *
 * Weights are a variety call, not a spec-mandated number (N-8/N-12 fix the
 * PROBABILITY a tile seeds at all; nothing in the plan fixes the split
 * between kinds once it does) -- chosen so no single kind dominates a yard
 * cluster: a water tank or a laundry line reads as an everyday household
 * fixture and gets the heavier weight, rebar and the tyre pile are rarer
 * construction/junk dressing and get less. `prop-place.test.ts`'s "puts yard
 * kinds in the yard band" falsifies the wrong SET, not the wrong weights --
 * there is no numeric floor to falsify here beyond "every listed kind can
 * actually appear", which a weight of zero would fail and none of these are.
 */
export const YARD_MIX: readonly (readonly [PropKind, number])[] = [
  ['water_tank', 3],
  ['satellite_dish', 2],
  ['laundry_line', 3],
  ['tyre_pile', 2],
  ['rebar', 2],
];

/**
 * The roadside band's weighted kind mix (R-5). Every entry here is a kind
 * that never stands in a yard (`YARD_MIX` above carries none of them) --
 * `jersey_barrier` and `wrecked_car` are road furniture by definition, and a
 * water tank beside a road with no building nearby would have nothing to be
 * plumbed to.
 *
 * Same "variety, not a fixed spec number" reasoning as `YARD_MIX`. A jersey
 * barrier is the single most common roadside object in the source material
 * this kit draws from (a checkpoint chicane, a lane closure) and gets the
 * heaviest weight; a wrecked car is a rarer, more dramatic beat and gets the
 * lightest.
 */
export const ROADSIDE_MIX: readonly (readonly [PropKind, number])[] = [
  ['jersey_barrier', 4],
  ['wrecked_car', 2],
  ['tyre_pile', 2],
  ['rebar', 2],
];

export interface PropPlacement {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly yawTurns: number;
}

/**
 * A blocked tile that is not a ridge: `buildings.ts`'s own definition
 * (`visitTile`'s `if (input.blocked[ti] === 0) return; ... if (decorHere ===
 * DECOR_RIDGE) return;`), restated as a query rather than an early return so
 * both this module and its tests can ask it of an arbitrary tile. Out of
 * bounds is never a building tile.
 */
export function isBuildingTile(input: TerrainInput, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= input.width || y >= input.height) return false;
  const t = y * input.width + x;
  if (input.blocked[t] === 0) return false;
  const decorHere = input.decor ? input.decor[t] : 0;
  return decorHere !== DECOR_RIDGE;
}

/**
 * Whether a prop may stand at all on tile `(x, y)`: N-10's list, verbatim --
 * "never on a building, ridge, road surface, grove or cover tile". A
 * building and a ridge are both simply `blocked !== 0` (the ridge is the one
 * blocked tile that is not a building, but it is still blocked ground); a
 * road surface and a grove are specific `decor` values; cover is its own
 * layer. Out of bounds is forbidden.
 *
 * Deliberately narrower than `decor-place.ts`'s `isOpenScatterAt`, which also
 * excludes a knoll, a ditch and a boulder tile -- N-10 names five things, not
 * eight, and a prop standing on open rocky ground (a knoll, `n`) is not one
 * of the shapes this rule forbids.
 */
function isForbiddenPropTile(input: TerrainInput, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= input.width || y >= input.height) return true;
  const t = y * input.width + x;
  if (input.blocked[t] !== 0) return true;
  const d = input.decor ? input.decor[t] : 0;
  if (d === DECOR_ROAD || d === DECOR_GROVE) return true;
  return input.cover[t] !== 0;
}

/**
 * The minimum Chebyshev distance from `(x, y)` to any building tile
 * (`isBuildingTile`), capped at `maxR` -- returns `maxR + 1` (read as "out of
 * band") the moment nothing closer is found, rather than scanning the whole
 * map. A candidate tile is never itself a building tile (`isForbiddenPropTile`
 * excludes it before this is ever called), so the true minimum is always
 * `>= 1`; this walks outward ring by ring from radius 1.
 */
function minChebyshevToBuilding(input: TerrainInput, x: number, y: number, maxR: number): number {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      const rowIsEdge = Math.abs(dy) === r;
      for (let dx = -r; dx <= r; dx++) {
        // Only the ring's own boundary at this radius -- an interior cell was
        // already checked (and would have returned) at a smaller `r`.
        if (!rowIsEdge && Math.abs(dx) !== r) continue;
        if (isBuildingTile(input, x + dx, ny)) return r;
      }
    }
  }
  return maxR + 1;
}

/**
 * The road's direction at `(px, pz)`, as yaw turns that put a prop's +X along
 * it (N-9's "lays a jersey barrier along its road").
 *
 * A central difference of `roadDistanceAt` (epsilon 0.05 tile) gives the
 * distance field's gradient, which points AWAY from the centreline, across
 * it; the tangent -- along the centreline, which is what a barrier's long
 * axis should follow -- is perpendicular to that gradient. `theta =
 * atan2(-tz, tx)` is the yaw about +Y that maps +X to `(cos theta, 0, -sin
 * theta)` (three.js's own right-handed convention, `-Z` forward under a
 * positive yaw), so a tangent of `(tx, tz)` is realised by that angle
 * directly. A straight road's tangent is only defined up to sign (the two
 * directions along it are equally "along"), which is exactly the ambiguity
 * the caller resolves for `jersey_barrier` with its own half-turn coin flip
 * -- this function does not need to and does not try to pick one.
 */
export function roadYawTurns(graph: RoadGraph, px: number, pz: number): number {
  const EPS = 0.05;
  const gx = (roadDistanceAt(graph, px + EPS, pz) - roadDistanceAt(graph, px - EPS, pz)) / (2 * EPS);
  const gz = (roadDistanceAt(graph, px, pz + EPS) - roadDistanceAt(graph, px, pz - EPS)) / (2 * EPS);
  // Rotate the gradient (gx, gz) a quarter turn to get a tangent.
  const tx = -gz;
  const tz = gx;
  const theta = Math.atan2(-tz, tx);
  const turns = theta / TAU;
  return turns < 0 ? turns + 1 : turns;
}

/** A weighted pick from a `[kind, weight]` mix by a hash in `[0, 1)`. Falls
 *  back to the mix's last entry for a `hash` of exactly the sum of weights'
 *  own floating-point image (unreachable for `tileHash`'s strictly-under-1
 *  output, kept only so this never returns `undefined`). */
function pickKind(mix: readonly (readonly [PropKind, number])[], hash: number): PropKind {
  const total = mix.reduce((sum, [, w]) => sum + w, 0);
  const target = hash * total;
  let acc = 0;
  for (const [kind, weight] of mix) {
    acc += weight;
    if (target < acc) return kind;
  }
  return mix[mix.length - 1][0];
}

/**
 * Every prop this map places, in acceptance order (so `propPlacements(input,
 * 75)` is a prefix of `propPlacements(input)` -- N-22).
 *
 * Two independent candidate rules run over every non-forbidden tile (N-10):
 * a YARD candidate at the tile's own centre when it sits 1-2 Chebyshev tiles
 * from a building and rolls under `YARD_P`; a ROADSIDE candidate at the tile
 * centre plus a +/-0.3 jitter when that jittered point sits inside
 * `ROADSIDE_BAND` of the road centreline and rolls under `ROADSIDE_P`. A tile
 * that qualifies for both takes roadside (checked first, below) -- the two
 * rules are not mutually exclusive by construction (a building can stand
 * close enough to a road for both bands to overlap on the same tile), and
 * the spec resolves the tie toward the road.
 *
 * A yard candidate's own point is ALSO required to clear `ROADSIDE_BAND[0]`
 * of the road -- not because N-9 says so for yard directly, but because N-10
 * forbids a prop standing on the road's own packed surface, and a yard tile
 * hugging a building that itself hugs the road can otherwise land inside
 * that surface's own clearance margin.
 *
 * Every candidate is collected before any acceptance decision is made, and
 * candidates are sorted by their OWN tile's hash (not scan order) before the
 * spacing pass runs -- the fixed point of N-22's prefix property and of "no
 * north-west bias when the cap binds": accepting a candidate depends only on
 * candidates already accepted (which do not depend on `cap`), never on
 * whether a later one will be considered.
 */
export function propPlacements(input: TerrainInput, cap: number = PROP_CAP): PropPlacement[] {
  const { width, height } = input;
  const graph = cachedRoadGraph(input);

  let anyBuilding = false;
  for (let y = 0; y < height && !anyBuilding; y++) {
    for (let x = 0; x < width; x++) {
      if (isBuildingTile(input, x, y)) {
        anyBuilding = true;
        break;
      }
    }
  }

  interface Candidate {
    readonly kind: PropKind;
    readonly x: number;
    readonly z: number;
    readonly yawTurns: number;
    readonly sortHash: number;
  }
  const candidates: Candidate[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isForbiddenPropTile(input, x, y)) continue;

      // Roadside: tile centre plus a +/-0.3 jitter, own hash streams for the
      // jitter (6007/811, 811/6007 -- a deliberately swapped pair rather than
      // two independent offsets, the same "cheap second stream" trick
      // `decor-place.ts` uses throughout) and for the acceptance roll
      // (7919/3571).
      const jrx = (tileHash(x + 6007, y + 811) - 0.5) * 0.6;
      const jrz = (tileHash(x + 811, y + 6007) - 0.5) * 0.6;
      const rpx = x + 0.5 + jrx;
      const rpz = y + 0.5 + jrz;
      const roadDist = roadDistanceAt(graph, rpx, rpz);
      const roadsideQualifies =
        roadDist >= ROADSIDE_BAND[0] &&
        roadDist <= ROADSIDE_BAND[1] &&
        tileHash(x + 7919, y + 3571) < ROADSIDE_P;

      let chosen: { x: number; z: number; mix: readonly (readonly [PropKind, number])[] } | null = null;
      if (roadsideQualifies) {
        chosen = { x: rpx, z: rpz, mix: ROADSIDE_MIX };
      } else if (anyBuilding) {
        const d = minChebyshevToBuilding(input, x, y, YARD_BAND[1]);
        if (d >= YARD_BAND[0] && d <= YARD_BAND[1] && tileHash(x + 5101, y + 2903) < YARD_P) {
          const cx = x + 0.5;
          const cz = y + 0.5;
          // N-10's road-surface exclusion, at the point level -- see this
          // function's own doc comment above.
          if (roadDistanceAt(graph, cx, cz) >= ROADSIDE_BAND[0]) {
            chosen = { x: cx, z: cz, mix: YARD_MIX };
          }
        }
      }
      if (!chosen) continue;

      const kind = pickKind(chosen.mix, tileHash(x + 4273, y + 1777));

      let yawTurns: number;
      if (kind === 'jersey_barrier') {
        yawTurns = roadYawTurns(graph, chosen.x, chosen.z);
        // Barriers face both ways along the road (N-9): a coin flip adds a
        // half turn on its own stream (8443/6199), independent of the road
        // direction and of the kind roll above.
        if (tileHash(x + 8443, y + 6199) < 0.5) yawTurns = (yawTurns + 0.5) % 1;
      } else {
        // Every other kind gets an ordinary free yaw, own stream (991/337).
        yawTurns = tileHash(x + 991, y + 337);
      }

      candidates.push({
        kind,
        x: chosen.x,
        z: chosen.z,
        yawTurns,
        // The acceptance sort key: the CANDIDATE TILE's own hash (9137/2213),
        // not the jittered/chosen position -- so the ordering is a property
        // of the map's tile grid, independent of how far a roadside pick
        // jittered off its own tile centre.
        sortHash: tileHash(x + 9137, y + 2213),
      });
    }
  }

  candidates.sort((a, b) => a.sortHash - b.sortHash);

  const surface = buildTerrainSurface(input);
  const accepted: { kind: PropKind; x: number; z: number; yawTurns: number }[] = [];
  for (const c of candidates) {
    if (accepted.length >= cap) break;
    let clear = true;
    for (const a of accepted) {
      if (Math.hypot(c.x - a.x, c.z - a.z) < PROP_SPACING) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    accepted.push({ kind: c.kind, x: c.x, z: c.z, yawTurns: c.yawTurns });
  }

  return accepted.map((a) => ({
    kind: a.kind,
    x: a.x,
    z: a.z,
    y: surfaceWorldY(surface, a.x, a.z),
    yawTurns: a.yawTurns,
  }));
}
