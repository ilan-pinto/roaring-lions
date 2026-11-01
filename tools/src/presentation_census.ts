// GH-913 L6: the presentation census of a two-seat versus map. REPORT-ONLY (headless, no browser).
//
// The sim treats a versus map as the same for both seats under the half-turn (x, y) -> (W-1-x,
// H-1-y). The CAMERA and the SUN do not turn with it (`VIEW_DIRECTION` and `SUN_DIRECTION` are
// fixed), so a map that is fair to the sim can still look different from each seat. Design
// doc section 3.3 (_coord/net-large-map/design.md) argues the two effects pull opposite ways and
// engineers one of them out of Rujm Sawda. This turns the argument into two numbers per seat.
//
// 1. OCCLUSION. A seat's APPROACH TILES are the passable tiles its men walk to reach the ground
//    that is not theirs: a 3-wide corridor along the foot flow-field path from the seat to the
//    centre of every zone that is the other seat's or contested. A tile is HIDDEN when a building's
//    drawn mesh covers more than half of a rifleman standing on it, as the fixed camera sees him
//    (`map_visibility.ts`'s own instrument, imported so the two cannot disagree).
// 2. RELIEF. A seat's ENEMY-FACING SLOPES are the passable tiles in its own half whose drawn
//    surface tilts at least SLOPE_MIN_TILT_DEG and whose downhill direction points within
//    ENEMY_FACING_HALF_ANGLE_DEG of the way to the other seat (the face a defender shows the
//    attacker). Each reads LIT, NEUTRAL or SHADOWED by how the player sees it: the ground shader
//    lights a slope with the relief read's exaggerated normal (`exaggerateNormal`), and a face
//    reads brighter than flat ground when N.L exceeds the flat ground's (the sun's own y), darker
//    when it falls below, by more than READ_BAND. A face the ground itself shades from the sun
//    (a mesa or wall between it and the sun) is SHADOWED whatever its normal says. The normal and
//    the ground are the renderer's own (`terrain/surface.ts`, crowns lifted as `ThreeRenderer`
//    does), the sun is `DAY_SUN_DIRECTION` imported, not re-derived.
//
//    On a map whose seats sit on the MAIN diagonal the sun is exactly perpendicular to the seat
//    axis (its horizontal part is (-x, +y), the axis is (+x, +y)), so a slope facing the enemy is
//    lit the same from either seat and only the cast shadow can tell them apart. The census exists
//    to confirm that rather than assume it, and the fixture in the test puts the seats on the
//    ANTI-diagonal to show the same instrument reading the opposite.
//
// WHAT IT DOES NOT MEASURE. Props, decor and scatter (an occluder only if it is a building);
// terrain seen through the fog; any unit. It reads the SIM's `blocked` mask for terraces, as the
// ground shader does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMap, type MapJson, type ParsedMap } from '../../packages/data/src/index';
import { DAY_SUN_DIRECTION } from '../../packages/render/src/three/time-of-day';
import {
  crownMask,
  crownIsEmpty,
  liftCrowns,
  unterraceCrowns,
} from '../../packages/render/src/three/terrain/crown';
import { DECOR_RIDGE } from '../../packages/render/src/three/terrain/shared';
import { exaggerateNormal } from '../../packages/render/src/three/terrain/relief-read';
import {
  smoothNormal,
  surfaceWorldY,
  terrainSurfaceFrom,
  type TerrainSurface,
} from '../../packages/render/src/three/terrain/surface';
import {
  HIDDEN_BODY_SHARE,
  ROUTE_HALF_WIDTH,
  bodyHiddenShare,
  footPath,
  nearestOpen,
  placeBuildings,
  rectCentre,
  type Rect,
} from './map_visibility';

/** A tile tilts at least this many degrees off the horizontal to count as a slope. */
export const SLOPE_MIN_TILT_DEG = 4;
/** A slope is enemy-facing when its downhill direction is within this of the enemy-ward line. */
export const ENEMY_FACING_HALF_ANGLE_DEG = 60;
/** A face reads lit (shadowed) when its exaggerated N.L is more (less) than flat ground's by this. */
export const READ_BAND = 0.03;
/** Cast-shadow march: step along the sun ray (tiles) and the longest ray looked along. */
export const SHADOW_STEP = 0.25;
export const SHADOW_MAX_TILES = 40;
/** The ray starts this far above the ground so a tile does not shadow itself on a rounding step. */
const SHADOW_LIFT = 0.02;

/** The proposed bar, GH-913 design section 7 L6: the two seats within this share of each other. */
export const SEAT_TOLERANCE = 0.1;
/**
 * A share below this on BOTH seats reads as "nothing to be unfair about", and its relative
 * difference is not meaningful: 0.2% against 0.4% is a doubling and not a problem. The gate
 * compares `max(a, b, SHARE_FLOOR)` so a pair of tiny numbers cannot fail on noise, and a large
 * one against a small one still does.
 */
export const SHARE_FLOOR = 0.02;

export type Point = readonly [number, number];

export interface SeatPlan {
  /** Seat anchor, the versus marker (tile). */
  anchor: Point;
  /** The tile at the centre of every zone this seat walks to: contested or the other seat's. */
  goals: { zone: string; at: Point }[];
}

/** Tiles by which the two seats' distances to a zone centre may differ for it to be contested. */
export const CONTESTED_TOLERANCE_TILES = 3;

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Plans for seats 0 and 1 from the map's `versus_0` / `versus_1` markers and its zones. A zone
 * belongs to the nearer seat unless its distances differ by under CONTESTED_TOLERANCE_TILES, in
 * which case it is contested. Seat s walks to every zone not its own, so the two goal lists are
 * the half-turn of each other on a half-turn symmetric map.
 */
export function planSeats(map: ParsedMap, seats?: readonly [Point, Point]): [SeatPlan, SeatPlan] {
  const m0 = seats ? seats[0] : map.markers.versus_0;
  const m1 = seats ? seats[1] : map.markers.versus_1;
  if (!m0 || !m1) throw new Error('presentation census: the map has no versus_0 / versus_1 marker');
  const a0: Point = [Math.floor(m0[0]), Math.floor(m0[1])];
  const a1: Point = [Math.floor(m1[0]), Math.floor(m1[1])];
  const plans: [SeatPlan, SeatPlan] = [
    { anchor: a0, goals: [] },
    { anchor: a1, goals: [] },
  ];
  for (const [zone, rect] of Object.entries(map.zones)) {
    const c = rectCentre(rect as Rect);
    const at = nearestOpen(map, c[0], c[1]);
    if (!at) continue;
    const d0 = dist(c, a0);
    const d1 = dist(c, a1);
    const contested = Math.abs(d0 - d1) < CONTESTED_TOLERANCE_TILES;
    if (contested || d0 > d1) plans[0].goals.push({ zone, at });
    if (contested || d1 > d0) plans[1].goals.push({ zone, at });
  }
  return plans;
}

/** The drawn ground exactly as `ThreeRenderer.applyCrowns` / `refreshSurface` build it. */
export function drawnSurface(map: ParsedMap, rows: readonly string[]): TerrainSurface {
  const decor = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) if (rows[y][x] === '^') decor[y * map.width + x] = DECOR_RIDGE;
  const levels = map.elevation;
  const mask = crownMask(decor, map.blocked, levels, map.width, map.height);
  const crown = crownIsEmpty(mask) ? null : mask;
  return terrainSurfaceFrom(
    crown && levels ? liftCrowns(levels, crown) : levels,
    crown ? unterraceCrowns(map.blocked, crown) : map.blocked,
    map.width,
    map.height
  );
}

export interface SeatReading {
  approachTiles: number;
  hiddenTiles: number;
  /** hidden / approach, 0..1. */
  hiddenShare: number;
  slopeTiles: number;
  lit: number;
  neutral: number;
  shadowed: number;
  /** lit / slopeTiles and shadowed / slopeTiles, 0..1. */
  litShare: number;
  shadowedShare: number;
}

export interface Census {
  seats: [SeatReading, SeatReading];
  /** `gap` of the two seats' hidden shares. */
  hiddenGap: number;
  /** The larger of `gap` of the two lit shares and `gap` of the two shadowed shares. */
  reliefGap: number;
  /** The hidden approach tiles, for drawing. */
  hidden: [Set<number>, Set<number>];
  /** Tiles each seat's relief reading counted, with their verdict (1 lit, 0 shadowed). */
  slope: [Map<number, Light>, Map<number, Light>];
  approach: [Set<number>, Set<number>];
}

/**
 * GH-913 look pass: the two ABSOLUTE relief checks that replaced the relative ratchet (`reliefGap`
 * <= 0.125). The relative gap divides by the lit share, and the lit share is padded by every
 * scallop a 2x2-cell bank leaves in the contour: facets that read lit for one seat and shadowed on
 * its twin, in large and nearly balanced numbers. Smoothing the banks removes about 170 of them,
 * the fixed skew stays at 19 tiles, and the ratio rose from 12.2% to 27% with the map no less
 * fair. Counts of tiles do not move with the denominator. Report-only (the lead, 1 Nov 2026): a
 * per-map no-worse ratchet, not a pass/fail bar. See _coord/rujm-sawda-look/plan.md section 4.
 */
export const LIT_DIFFERENCE_MAX = 0.07;
export const TWIN_MISMATCH_MAX = 150;

/** |lit(seat 0) - lit(seat 1)| as a share of the slope tiles (the larger seat's, so 0 counts as 0). */
export function litDifferenceShare(c: Census): number {
  const n = Math.max(c.seats[0].slopeTiles, c.seats[1].slopeTiles);
  return n === 0 ? 0 : Math.abs(c.seats[0].lit - c.seats[1].lit) / n;
}

/**
 * Seat 0's slope tiles whose half-turn twin (the map's own W*H-1-t) is not the same reading for
 * seat 1, a missing twin included. Zero on a map whose two halves look identical from their seats.
 */
export function twinMismatches(c: Census, width: number, height: number): number {
  let n = 0;
  for (const [t, light] of c.slope[0]) if (c.slope[1].get(width * height - 1 - t) !== light) n++;
  return n;
}

/** |a - b| / max(a, b, SHARE_FLOOR). */
export function gap(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b, SHARE_FLOOR);
}

function approachTiles(map: ParsedMap, plan: SeatPlan): Set<number> {
  const out = new Set<number>();
  const start = nearestOpen(map, plan.anchor[0], plan.anchor[1]);
  if (!start) return out;
  for (const g of plan.goals) {
    const goal: [number, number] = [g.at[0], g.at[1]];
    for (const t of footPath(map, start, goal)) {
      const x = t % map.width;
      const y = Math.floor(t / map.width);
      for (let dy = -ROUTE_HALF_WIDTH; dy <= ROUTE_HALF_WIDTH; dy++)
        for (let dx = -ROUTE_HALF_WIDTH; dx <= ROUTE_HALF_WIDTH; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const u = ty * map.width + tx;
          if (map.blocked[u] === 0) out.add(u);
        }
    }
  }
  return out;
}

const [SUN_X, SUN_Y, SUN_Z] = (() => {
  const [x, y, z] = DAY_SUN_DIRECTION;
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n] as const;
})();

/** Whether ground between world point (x, y, z) and the sun rises above the ray. */
export function castShadowed(s: TerrainSurface, map: ParsedMap, x: number, y: number, z: number): boolean {
  for (let t = SHADOW_STEP; t <= SHADOW_MAX_TILES; t += SHADOW_STEP) {
    const px = x + SUN_X * t;
    const pz = z + SUN_Z * t;
    if (px < 0 || pz < 0 || px >= map.width || pz >= map.height) return false;
    if (surfaceWorldY(s, px, pz) > y + SUN_Y * t) return true;
  }
  return false;
}

/** How a slope reads to the player: 1 brighter than flat ground, 0 about the same, -1 darker. */
export type Light = 1 | 0 | -1;

/** How tile (tx, ty)'s centre reads under the side light, by exaggerated normal and cast shadow. */
export function lightAt(
  s: TerrainSurface,
  map: ParsedMap,
  tx: number,
  ty: number,
  readBand: number = READ_BAND
): Light {
  const cx = tx + 0.5;
  const cz = ty + 0.5;
  const y = surfaceWorldY(s, cx, cz) + SHADOW_LIFT;
  if (castShadowed(s, map, cx, y, cz)) return -1;
  const [nx, ny, nz] = exaggerateNormal(smoothNormal(s, cx, cz));
  const ndl = nx * SUN_X + ny * SUN_Y + nz * SUN_Z;
  if (ndl > SUN_Y + readBand) return 1;
  if (ndl < SUN_Y - readBand) return -1;
  return 0;
}

function slopeTiles(
  map: ParsedMap,
  s: TerrainSurface,
  own: Point,
  enemy: Point,
  opts: CensusOptions
): Map<number, Light> {
  const out = new Map<number, Light>();
  // the enemy-ward unit vector on the ground plane (x, z)
  // Tile indices name the tile's corner; the half-turn is about the map's centre, which is a
  // tile CENTRE for each anchor (+0.5), or the midpoint lands half a tile off and one seat gets
  // an extra strip of tiles.
  const ex = enemy[0] - own[0];
  const ey = enemy[1] - own[1];
  const en = Math.hypot(ex, ey);
  const ux = ex / en;
  const uz = ey / en;
  const cosLimit = Math.cos((opts.facingHalfAngleDeg * Math.PI) / 180);
  const minTilt = Math.sin((opts.slopeMinTiltDeg * Math.PI) / 180);
  const mid = (own[0] + enemy[0]) / 2 + 0.5;
  const midZ = (own[1] + enemy[1]) / 2 + 0.5;
  for (let ty = 0; ty < map.height; ty++)
    for (let tx = 0; tx < map.width; tx++) {
      const t = ty * map.width + tx;
      if (map.blocked[t] !== 0) continue;
      // the seat's own half: behind the midpoint, looking along its enemy-ward axis
      const side = (tx + 0.5 - mid) * ux + (ty + 0.5 - midZ) * uz;
      if (side >= 0) continue;
      const [nx, , nz] = smoothNormal(s, tx + 0.5, ty + 0.5);
      const tilt = Math.hypot(nx, nz); // sin of the angle off vertical, as n is a unit vector
      if (tilt < minTilt) continue;
      // The normal's horizontal part points DOWNHILL, and (ux, uz) already points at THIS seat's enemy.
      const facing = (nx * ux + nz * uz) / tilt;
      if (facing < cosLimit) continue;
      out.set(t, lightAt(s, map, tx, ty, opts.readBand));
    }
  return out;
}

/** The choices this census makes that are not the renderer's. The defaults are what is gated. */
export interface CensusOptions {
  facingHalfAngleDeg: number;
  slopeMinTiltDeg: number;
  readBand: number;
  /** A tile is hidden when MORE than this share of a rifleman standing on it is. */
  hiddenBodyShare: number;
  /** Seat axes, overriding `versus_0` / `versus_1`, for a fixture. */
  seats?: readonly [Point, Point];
}
export const DEFAULT_OPTIONS: CensusOptions = {
  facingHalfAngleDeg: ENEMY_FACING_HALF_ANGLE_DEG,
  slopeMinTiltDeg: SLOPE_MIN_TILT_DEG,
  readBand: READ_BAND,
  hiddenBodyShare: HIDDEN_BODY_SHARE,
};

/** Run the census on a parsed map. `rows` is the map JSON's row strings (for the `^` decor). */
export async function census(
  map: ParsedMap,
  rows: readonly string[],
  options: Partial<CensusOptions> = {}
): Promise<Census> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const plans = planSeats(map, opts.seats);
  const placed = await placeBuildings(map);
  const surface = drawnSurface(map, rows);
  const read = (seat: 0 | 1): { r: SeatReading; hidden: Set<number>; slope: Map<number, Light>; app: Set<number> } => {
    const app = approachTiles(map, plans[seat]);
    const hidden = new Set<number>();
    for (const t of app) {
      if (bodyHiddenShare(map, placed, t % map.width, Math.floor(t / map.width)) > opts.hiddenBodyShare) hidden.add(t);
    }
    const slope = slopeTiles(map, surface, plans[seat].anchor, plans[1 - seat].anchor, opts);
    let lit = 0;
    let shadowed = 0;
    for (const v of slope.values()) {
      if (v === 1) lit++;
      else if (v === -1) shadowed++;
    }
    return {
      r: {
        approachTiles: app.size,
        hiddenTiles: hidden.size,
        hiddenShare: app.size === 0 ? 0 : hidden.size / app.size,
        slopeTiles: slope.size,
        lit,
        neutral: slope.size - lit - shadowed,
        shadowed,
        litShare: slope.size === 0 ? 0 : lit / slope.size,
        shadowedShare: slope.size === 0 ? 0 : shadowed / slope.size,
      },
      hidden,
      slope,
      app,
    };
  };
  const a = read(0);
  const b = read(1);
  return {
    seats: [a.r, b.r],
    hiddenGap: gap(a.r.hiddenShare, b.r.hiddenShare),
    reliefGap: Math.max(gap(a.r.litShare, b.r.litShare), gap(a.r.shadowedShare, b.r.shadowedShare)),
    hidden: [a.hidden, b.hidden],
    slope: [a.slope, b.slope],
    approach: [a.app, b.app],
  };
}

export const ROOT = join(import.meta.dirname, '..', '..');

/** A shipped map's JSON, parsed, with its rows for the `^` decor. */
export function loadMap(id: string): { json: MapJson; map: ParsedMap } {
  const json = JSON.parse(readFileSync(join(ROOT, 'data', 'maps', `${id}.json`), 'utf8')) as MapJson;
  return { json, map: parseMap(json) };
}

/** Print one census as the CLI and the PR body show it. */
export function report(id: string, c: Census, size?: readonly [number, number]): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const row = (label: string, a: string, b: string) => `  ${label.padEnd(26)}${a.padStart(14)}${b.padStart(14)}`;
  const both = (label: string, f: (r: SeatReading) => string) => row(label, f(c.seats[0]), f(c.seats[1]));
  return [
    `${id}  (seat 0 = versus_0, seat 1 = versus_1)`,
    row('', 'seat 0', 'seat 1'),
    both('approach tiles', (r) => String(r.approachTiles)),
    both('hidden behind a building', (r) => String(r.hiddenTiles)),
    both('  hidden share', (r) => pct(r.hiddenShare)),
    both('enemy-facing slope tiles', (r) => String(r.slopeTiles)),
    both('  lit', (r) => `${r.lit} (${pct(r.litShare)})`),
    both('  neutral', (r) => String(r.neutral)),
    both('  shadowed', (r) => `${r.shadowed} (${pct(r.shadowedShare)})`),
    `  occlusion gap ${pct(c.hiddenGap)}   relief gap ${pct(c.reliefGap)}   (bar ${pct(SEAT_TOLERANCE)})`,
    `  lit difference ${pct(litDifferenceShare(c))} of slope tiles   (max ${pct(LIT_DIFFERENCE_MAX)})`,
    ...(size ? [`  tiles reading differently from their twin ${twinMismatches(c, size[0], size[1])}   (max ${TWIN_MISMATCH_MAX})`] : []),
  ].join('\n');
}

// CLI: npx tsx tools/src/presentation_census.ts [map id ...]   (default: the versus maps)
if (process.argv[1] && process.argv[1].endsWith('presentation_census.ts')) {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  for (const id of ids.length > 0 ? ids : ['rujm_sawda', 'wadi_tarfan']) {
    const { json, map } = loadMap(id);
    console.log(report(id, await census(map, json.rows), [map.width, map.height]) + '\n');
  }
}
