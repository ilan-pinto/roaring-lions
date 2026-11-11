/**
 * GH-1197 P5: the flying debris of a building's final collapse, ADDED under today's dense shroud (the lead's ruling 2,
 * 9 Nov: the shroud stays 2.4 s, hold 0.35, cover 1.25, the swap at 420 ms).
 *
 * - **How many:** 40 chunks for a 3x3 footprint, by footprint area, capped at 48 a building (an uncapped house threw
 *   70, mostly hidden); a per-tile wall throws 6 a tile (design 3.3).
 * - **From where, when:** the roof line -- a hashed point on the roof -- between 0 and 300 ms after the event.
 * - **Which way:** biased 60/40 AWAY from the side the building was last hit from: walls fail away from the blast
 *   (explosion-physics, "Buildings"). With no recorded hit, all round.
 * - **How far:** 1.5-3.0 t with an apex of 2-4 t, clamped so every chunk comes to rest INSIDE the rubble decal's
 *   radius (design 3.4: "a settled chunk stays inside the rubble decal's radius"); the clamp wins where the two meet.
 *
 * Every number is a hash of the structure and the chunk's index (`tileHash(structure, k)`), so a collapse throws the
 * same chunks every time. Pure, three-free; the renderer flies them through the P2 pool (`debris-pool.ts`), whose
 * sim-clock fade sinks them into the rubble decal 90 s on. Presentation only.
 */
import { tileHash } from '../../tile-hash';
import type { FlipbookLayerSpec } from '../../vfx/emitters';
import { FLIPBOOK_SMOKE_ALPHA } from './flipbook-fx';

export const COLLAPSE_CHUNKS_PER_3X3 = 40;
export const COLLAPSE_CHUNK_CAP = 48;
export const PER_TILE_WALL_CHUNKS = 6;
export const COLLAPSE_LAUNCH_MS = 300;
export const COLLAPSE_THROW_TILES: readonly [number, number] = [1.5, 3.0];
export const COLLAPSE_APEX_TILES: readonly [number, number] = [2, 4];
/** The share of chunks thrown to the side AWAY from the last hit. */
export const COLLAPSE_AWAY_SHARE = 0.6;
/** A chunk comes to rest this far inside the rubble decal's edge, at least. */
export const COLLAPSE_EDGE_MARGIN_TILES = 0.2;
/** The shortest throw the clamp leaves a chunk: one that would otherwise rest past the decal drops close. */
export const COLLAPSE_MIN_THROW_TILES = 0.3;
/** The landing debris' dust (design 3.5: "plus 12 billows from the landing debris"). */
export const COLLAPSE_DUST_BILLOWS = 12;
/** After 0.6 s every presentation dust stays at or under this (design 3, "keeping the fight visible"). */
export const COLLAPSE_DUST_ALPHA = 0.45;

/** Chunks a collapse throws: 40 per 3x3 by area, capped at 48; 6 a tile for a per-tile wall (also capped). */
export function collapseChunkCount(footprintTiles: number, perTile: boolean): number {
  const n = perTile ? PER_TILE_WALL_CHUNKS * footprintTiles : Math.round((COLLAPSE_CHUNKS_PER_3X3 * footprintTiles) / 9);
  return Math.max(0, Math.min(COLLAPSE_CHUNK_CAP, n));
}

/** One planned chunk: where on the roof it leaves, which way, how far and how high, and when. */
export interface CollapseChunk {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
  readonly rangeTiles: number;
  readonly apexTiles: number;
  readonly delayMs: number;
  /** Thrown to the side away from the last hit (a no-hit collapse reads false throughout). */
  readonly away: boolean;
}

/** The farthest a chunk leaving (x, z) along `heading` may travel and still rest `margin` inside a circle. */
export function rangeInsideCircle(x: number, z: number, heading: number, cx: number, cz: number, radius: number): number {
  const ux = Math.cos(heading);
  const uz = Math.sin(heading);
  const lx = x - cx;
  const lz = z - cz;
  const b = lx * ux + lz * uz;
  const c = lx * lx + lz * lz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return 0;
  return -b + Math.sqrt(disc);
}

/**
 * The chunks of structure `s` over the footprint `[minX, maxX + 1) x [minY, maxY + 1)`, last hit from `hitFrom` (or
 * null), coming to rest inside the rubble decal of radius `rubbleRadius` about the footprint's centre.
 */
export function planCollapseChunks(
  s: number,
  minX: number, minY: number, maxX: number, maxY: number,
  hitFrom: { x: number; y: number } | null,
  rubbleRadius: number,
  count: number
): CollapseChunk[] {
  const cx = (minX + maxX + 1) / 2;
  const cz = (minY + maxY + 1) / 2;
  const h = (k: number, salt: number): number => tileHash(s * 64 + salt, k);
  const awayRad = hitFrom === null ? null : Math.atan2(cz - hitFrom.y, cx - hitFrom.x);
  const out: CollapseChunk[] = [];
  for (let k = 0; k < count; k++) {
    // The roof line: a point on the roof, a little inside its edge.
    const x = minX + 0.1 + (maxX + 1 - minX - 0.2) * h(k, 1);
    const z = minY + 0.1 + (maxY + 1 - minY - 0.2) * h(k, 2);
    let heading: number;
    let away = false;
    if (awayRad === null) heading = h(k, 3) * Math.PI * 2;
    else {
      away = h(k, 3) < COLLAPSE_AWAY_SHARE;
      // Anywhere in the chosen half-plane: +-90 degrees about the away (or toward) direction.
      heading = (away ? awayRad : awayRad + Math.PI) + (h(k, 4) - 0.5) * Math.PI;
    }
    const want = COLLAPSE_THROW_TILES[0] + (COLLAPSE_THROW_TILES[1] - COLLAPSE_THROW_TILES[0]) * h(k, 5);
    const room = rangeInsideCircle(x, z, heading, cx, cz, rubbleRadius) - COLLAPSE_EDGE_MARGIN_TILES;
    out.push({
      x,
      z,
      headingRad: heading,
      rangeTiles: Math.max(COLLAPSE_MIN_THROW_TILES, Math.min(want, room)),
      apexTiles: COLLAPSE_APEX_TILES[0] + (COLLAPSE_APEX_TILES[1] - COLLAPSE_APEX_TILES[0]) * h(k, 6),
      delayMs: COLLAPSE_LAUNCH_MS * h(k, 7),
      away,
    });
  }
  return out;
}

/** The landing debris' dust: 12 billows rising where the chunks come down (from 0.7 s), rolling out over the rubble's
 *  radius, at most `COLLAPSE_DUST_ALPHA`. Spawned at the footprint's centre on the ground, power 0. */
export function collapseDustRecipe(rubbleRadius: number): FlipbookLayerSpec[] {
  const reach = rubbleRadius * 0.8;
  return [
    {
      type: 'smoke',
      count: COLLAPSE_DUST_BILLOWS,
      delay_ms: [700, 40],
      duration_ms: [2500, 3500],
      scale: { base: 0.6, rand: 0.35 },
      // Smoke drags at 1.2/s: a radial of d x 1.2 comes to rest d out.
      velocity: { radial: [reach * 0.6 * 1.2, reach * 1.2], up: [0.1, 0.4], ring: true, ring_jitter_rad: 0.4 },
      at_ground: true,
      tint: 1,
      alpha: COLLAPSE_DUST_ALPHA / FLIPBOOK_SMOKE_ALPHA,
    },
  ];
}
