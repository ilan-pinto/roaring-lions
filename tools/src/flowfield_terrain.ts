// Terrain for the flow-field witnesses and the compute bench (GH-913 L1, L2): every shipped map as
// the sim's own masks, nearest-neighbour stretches of a few to 80x80 (in memory, nothing is written
// to data/), and seeded random terrain. Pure arrays in, pure arrays out: no Sim is built, so a
// witness over hundreds of goals costs milliseconds and measures `FlowField` alone.
import { maps, parseMap, type MapJson } from '@lions/data';

export interface Terrain {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  /** Foot mask: `blocked`, structures included (they are `#` tiles in the grid). */
  readonly foot: Uint8Array;
  /** Wheeled mask: `blocked | boulder`. The SAME bytes as `foot` on a map with no boulders. */
  readonly wheels: Uint8Array;
  readonly elevation: Uint8Array;
}

function fromParsed(id: string, p: ReturnType<typeof parseMap>): Terrain {
  const wheels = new Uint8Array(p.blocked.length);
  for (let t = 0; t < wheels.length; t++) wheels[t] = p.blocked[t] | p.boulder[t];
  return { id, w: p.width, h: p.height, foot: p.blocked, wheels, elevation: p.elevation };
}

/** Every shipped map, in a fixed order. */
export function shippedTerrains(): Terrain[] {
  return Object.keys(maps)
    .sort()
    .map((id) => fromParsed(id, parseMap((maps as Record<string, MapJson>)[id])));
}

/** Nearest-neighbour stretch to `size` x `size`, sampled at tile centres (as the GH-913 scale probe does). */
export function stretched(t: Terrain, size: number): Terrain {
  const k = size / t.w;
  const at = (v: number, n: number): number => Math.min(n - 1, Math.floor((v + 0.5) / k));
  const foot = new Uint8Array(size * size);
  const wheels = new Uint8Array(size * size);
  const elevation = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = at(y, t.h) * t.w + at(x, t.w);
      foot[y * size + x] = t.foot[s];
      wheels[y * size + x] = t.wheels[s];
      elevation[y * size + x] = t.elevation[s];
    }
  }
  return { id: `${t.id}@${size}`, w: size, h: size, foot, wheels, elevation };
}

/** A small seeded generator (mulberry32). Tools may use it; the sim may not and does not. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random terrain: `wallPct` percent walls, `boulderPct` percent boulders (wheels only), relief 0..`maxLevel`
 *  in blobs (smooth enough to make real slopes, steep enough to make real climbs). */
export function randomTerrain(id: string, w: number, h: number, seed: number, wallPct: number, boulderPct: number, maxLevel: number): Terrain {
  const r = prng(seed);
  const foot = new Uint8Array(w * h);
  const wheels = new Uint8Array(w * h);
  const elevation = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t++) {
    const roll = r() * 100;
    if (roll < wallPct) {
      foot[t] = 1;
      wheels[t] = 1;
    } else if (roll < wallPct + boulderPct) {
      wheels[t] = 1;
    }
  }
  if (maxLevel > 0) {
    const blobs = 2 + Math.floor((w * h) / 150);
    for (let b = 0; b < blobs; b++) {
      const cx = Math.floor(r() * w);
      const cy = Math.floor(r() * h);
      const rad = 2 + Math.floor(r() * 6);
      const lvl = 1 + Math.floor(r() * maxLevel);
      for (let y = Math.max(0, cy - rad); y <= Math.min(h - 1, cy + rad); y++) {
        for (let x = Math.max(0, cx - rad); x <= Math.min(w - 1, cx + rad); x++) {
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) elevation[y * w + x] = Math.max(elevation[y * w + x], lvl);
        }
      }
    }
    // single-tile spikes: steep, narrow, cost-bucket-spreading
    for (let s = 0; s < (w * h) / 40; s++) elevation[Math.floor(r() * w * h)] = Math.floor(r() * (maxLevel + 1));
  }
  return { id, w, h, foot, wheels, elevation };
}

/** `n` goal tiles on `mask`'s open ground, spread evenly through it and the same every call. */
export function goalsOn(mask: Uint8Array, n: number): number[] {
  const open: number[] = [];
  for (let t = 0; t < mask.length; t++) if (mask[t] === 0) open.push(t);
  if (open.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(open[Math.floor(((i + 0.5) * open.length) / n) % open.length]);
  return out;
}
