/**
 * Crown summits (`packages/render/src/three/terrain/crown.ts`) against the
 * REAL shipped maps -- here rather than in `packages/render`, which may not
 * import `@lions/data` (the same reason `ground-texture-slots.test.ts` lives
 * here).
 *
 * The summit oracle is LITERALS: the per-map counts below were computed from
 * the map rows by an independent script (`_coord/crown-summit/`, a Python
 * flood fill reading the symbols `^ # m` rather than the sim's mask), never
 * by calling `crownMask`.
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, type MapId } from '@lions/data';
import {
  CROWN_LIFT_LEVELS,
  CROWN_MAX_TILES,
  CROWN_SEAT_TILES,
  DECOR_RIDGE,
  buildTerrainSurface,
  crownMask,
  decorPlacements,
  liftCrowns,
  surfaceWorldY,
  unterraceCrowns,
  type TerrainInput,
} from '@lions/render/terrain';
import { BLOCK_RISE } from '../../sim/src/sim';

const MAP_IDS = Object.keys(maps) as MapId[];

function load(id: MapId) {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20261015, width: parsed.width, height: parsed.height, capacity: 64 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsed.structures) {
    const t = typeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return { parsed, sim };
}

/** 4-connected `^` clusters of at most CROWN_MAX_TILES tiles, as a list of tile sets. */
function smallClusters(decor: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(decor.length);
  const out: number[][] = [];
  for (let i = 0; i < decor.length; i++) {
    if (decor[i] !== DECOR_RIDGE || seen[i]) continue;
    const c: number[] = [];
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const j = st.pop() as number;
      c.push(j);
      const x = j % w;
      const y = (j - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (decor[k] === DECOR_RIDGE && !seen[k]) {
          seen[k] = 1;
          st.push(k);
        }
      }
    }
    if (c.length <= CROWN_MAX_TILES) out.push(c);
  }
  return out;
}

/**
 * Summits per map, from the independent script: a `^` cluster of at most 12
 * tiles none of whose 8-neighbours is another `^` or ANY building symbol
 * (`data/structures.json`'s twelve, low-profile walls and fences included) or
 * stands above the cluster's lowest level. Every other map: 0.
 *
 * The mock's first count, 29 of 61, read only `^ # m` as blocked and missed
 * nine clusters that touch a shanty (`s`), a pump house (`p`) or a
 * compound wall (`=`): fortified hilltops, not bare crowns.
 */
const SUMMITS: Partial<Record<MapId, number>> = {
  beit_sahwan_2: 4,
  deir_amun_2: 3,
  deir_amun_3: 1,
  milh_flats: 2,
  qarn_hadid: 1,
  qarn_hadid_3: 4,
  tel_marum: 1,
  tel_marum_1: 1,
  tel_marum_2: 2,
  umm_zeitoun_4: 1,
};

describe('crown summits on the shipped maps', () => {
  const tally = { summits: 0, rejected: 0 };

  it.each(MAP_IDS)('%s: picks exactly the summits, and nothing else', (id) => {
    const { parsed, sim } = load(id);
    if (!parsed.decor) {
      expect(SUMMITS[id] ?? 0).toBe(0);
      return;
    }
    const mask = crownMask(parsed.decor, sim.blocked, parsed.elevation, parsed.width, parsed.height);
    let crowns = 0;
    let rejected = 0;
    for (const c of smallClusters(parsed.decor, parsed.width, parsed.height)) {
      const on = c.filter((t) => mask[t]).length;
      // A cluster is all crown or none of it.
      expect(on === 0 || on === c.length, `${id}: a cluster split ${on}/${c.length}`).toBe(true);
      if (on) crowns++;
      else rejected++;
    }
    // Nothing outside a small cluster is ever a crown.
    let stray = 0;
    const inSmall = new Set(smallClusters(parsed.decor, parsed.width, parsed.height).flat());
    for (let t = 0; t < mask.length; t++) if (mask[t] && !inSmall.has(t)) stray++;
    expect(stray).toBe(0);
    expect(crowns).toBe(SUMMITS[id] ?? 0);
    tally.summits += crowns;
    tally.rejected += rejected;
  });

  it('20 summits in all, and none of the other 41 small clusters', () => {
    expect(tally).toEqual({ summits: 20, rejected: 41 });
  });

  it('lifts a crown by exactly the sim\'s BLOCK_RISE -- the lift at which what the player sees is what blocks sight', () => {
    expect(CROWN_LIFT_LEVELS).toBe(BLOCK_RISE);
  });

  it('never writes the sim: the lift and the unterraced mask are copies', () => {
    const { parsed, sim } = load('milh_flats');
    const blocked = Uint8Array.from(sim.blocked);
    const levels = Uint8Array.from(parsed.elevation as Uint8Array);
    const mask = crownMask(parsed.decor as Uint8Array, sim.blocked, parsed.elevation, parsed.width, parsed.height);
    liftCrowns(parsed.elevation, mask);
    unterraceCrowns(sim.blocked, mask);
    expect(sim.blocked).toEqual(blocked);
    expect(parsed.elevation).toEqual(levels);
  });
});

/** Contact radius and height in tiles at scale 1, off the decor GLBs'
 *  POSITION bounds by hand (largest variant: boulder 2.5 x 2.3 tall, rock
 *  0.75 x 0.32, slab 1.5 long x 0.27): half the half-extent, a quarter of the
 *  slab's length -- the oracle, not an import of the table it checks. */
const FOOTPRINT: Record<string, { radius: number; height: number }> = {
  boulder: { radius: 0.6, height: 2.3 },
  rock: { radius: 0.19, height: 0.32 },
  slab: { radius: 0.37, height: 0.27 },
};

describe('rocks on a crown\'s tell sit ON its slope', () => {
  it.each(['milh_flats', 'tel_marum', 'beit_sahwan_2', 'tel_marum_2'] as MapId[])('%s', (id) => {
    const { parsed, sim } = load(id);
    const decor = parsed.decor as Uint8Array;
    const crown = crownMask(decor, sim.blocked, parsed.elevation, parsed.width, parsed.height);
    const input: TerrainInput = {
      width: parsed.width,
      height: parsed.height,
      decor,
      cover: sim.cover,
      boulder: sim.boulder,
      elevation: liftCrowns(parsed.elevation, crown),
      blocked: unterraceCrowns(sim.blocked, crown),
      crown,
    };
    const surface = buildTerrainSurface(input);
    const onTell = (x: number, z: number): boolean => {
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      for (let dz = -CROWN_SEAT_TILES; dz <= CROWN_SEAT_TILES; dz++)
        for (let dx = -CROWN_SEAT_TILES; dx <= CROWN_SEAT_TILES; dx++) {
          const x2 = tx + dx;
          const z2 = tz + dz;
          if (x2 >= 0 && z2 >= 0 && x2 < parsed.width && z2 < parsed.height && crown[z2 * parsed.width + x2]) return true;
        }
      return false;
    };
    let seated = 0;
    let sunk = 0;
    for (const d of decorPlacements(input, 1, surface)) {
      const fp = FOOTPRINT[d.family];
      const centre = surfaceWorldY(surface, d.x, d.z);
      if (!fp) continue; // not a rock family: this rule does not touch it
      if (!onTell(d.x, d.z)) {
        // Off a crown's tell: placed by its centre, exactly as before.
        expect(d.y).toBe(centre);
        continue;
      }
      let low = centre;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        low = Math.min(low, surfaceWorldY(surface, d.x + Math.cos(a) * fp.radius * d.scale, d.z + Math.sin(a) * fp.radius * d.scale));
      }
      // Its contact patch touches the ground on the downhill side, unless
      // that would bury more than a fifth of it -- then it sinks a fifth.
      const floor = centre - 0.2 * fp.height * d.scale;
      expect(d.y).toBeCloseTo(Math.max(low, floor), 9);
      seated++;
      if (centre - d.y > 1e-6) sunk++;
    }
    // Not vacuous: there are rocks on the tell, and some stand on a slope.
    expect(seated).toBeGreaterThan(0);
    expect(sunk).toBeGreaterThan(0);
  });
});
