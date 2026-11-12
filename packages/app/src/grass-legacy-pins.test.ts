/**
 * GH-1167 S3, pin P2 (design 2026-11-11-wadi-halam-3d-grass-design.md, 3.6): the legacy builders on the five green
 * maps and the `tile_green` fixture do not move when the node grass lands (S4/S5). `decorPlacements` and
 * `buildScatter` at their DEFAULT options are hashed and pinned against the values read on main (e8da5117c + the
 * 11 Nov design commit), BEFORE any grass code. The expected hashes are literals: never recompute them from the code
 * under test. Lives in `app` because `render` cannot import `@lions/data` (see `scatter-density.test.ts`).
 *
 * Falsified by (run red, then put back): filtering `grass` out of `decorPlacements`; making the sward strokes
 * vanish from `buildScatter` (S1 adds a `swardMarks` option: flipping its default to `false` is the same red).
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapId } from '@lions/data';
import { buildScatter, decorPlacements, type TerrainInput } from '@lions/render/terrain';
import { terrainTonesFor } from './terrain-themes';

/** The same bring-up as `scatter-density.test.ts`'s `loadInput`. */
function loadInput(id: MapId): { input: TerrainInput; tones: ReturnType<typeof terrainTonesFor> } {
  const pm = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: pm.width, height: pm.height, capacity: 256 });
  applyTerrain(pm, sim);
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of pm.structures) {
    const t = idx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = terrainTonesFor(pm);
  return {
    input: {
      width: pm.width,
      height: pm.height,
      decor: pm.decor,
      elevation: pm.elevation,
      blocked: sim.blocked,
      cover: sim.cover,
      boulder: pm.boulder,
      familyRemap: tones.familyRemap,
      waterside: tones.waterside,
    },
    tones,
  };
}

/** FNV-1a 32 over a byte view. */
function fnv(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const hex = (n: number): string => n.toString(16).padStart(8, '0');
const view = (a: Float32Array | Uint32Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

function placementsHash(input: TerrainInput): { n: number; grass: number; hash: string } {
  const ps = decorPlacements(input);
  const text = ps.map((p) => `${p.family}|${p.variant}|${p.x}|${p.z}|${p.y}|${p.yawTurns}|${p.scale}`).join('\n');
  return {
    n: ps.length,
    grass: ps.filter((p) => p.family === (input.familyRemap?.grass ?? 'grass')).length,
    hash: hex(fnv(new TextEncoder().encode(text))),
  };
}

function scatterHash(input: TerrainInput, tones: ReturnType<typeof terrainTonesFor>): { verts: number; hash: string } {
  const m = buildScatter(input, tones, '#14150F');
  return { verts: m.positions.length / 3, hash: hex(fnv(view(m.indices), fnv(view(m.colors), fnv(view(m.positions))))) };
}

/** Read on main, 11 Nov 2026. */
const PINNED: Record<string, { placements: { n: number; grass: number; hash: string }; scatter: { verts: number; hash: string } }> = {
  wadi_halam_basin: { placements: { n: 1532, grass: 650, hash: '84849492' }, scatter: { verts: 85180, hash: 'ba7cef8b' } },
  wadi_halam_2: { placements: { n: 1484, grass: 660, hash: '9c2a8212' }, scatter: { verts: 97196, hash: '4306f402' } },
  wadi_halam_3: { placements: { n: 1617, grass: 692, hash: '4f020200' }, scatter: { verts: 91040, hash: 'f5ce227b' } },
  wadi_halam_4: { placements: { n: 1449, grass: 633, hash: '62687d9b' }, scatter: { verts: 90180, hash: 'c1168582' } },
  wadi_halam_5: { placements: { n: 1352, grass: 605, hash: '457b3517' }, scatter: { verts: 80272, hash: '9d801db4' } },
  tile_green: { placements: { n: 1575, grass: 690, hash: '146f3cf4' }, scatter: { verts: 99260, hash: '4b565dbc' } },
};

const IDS = ['wadi_halam_basin', 'wadi_halam_2', 'wadi_halam_3', 'wadi_halam_4', 'wadi_halam_5', 'tile_green'] as const;

describe('GH-1167 S3 P2: the legacy builders on the green maps are pinned to main', () => {
  it.each(IDS)('%s: decorPlacements and buildScatter (default options) hash to main\'s values', (id) => {
    const { input, tones } = loadInput(id as MapId);
    expect(tones.scatter).toBe('sward');
    const got = { placements: placementsHash(input), scatter: scatterHash(input, tones) };
    if (process.env.PIN_PRINT) console.log(`PIN ${id} ${JSON.stringify(got)}`);
    expect(got).toEqual(PINNED[id]);
  });
  it('the pins are not vacuous: every green map carries grass tufts and sward vertices', () => {
    for (const id of IDS) {
      const p = PINNED[id];
      expect(p?.placements.grass, id).toBeGreaterThan(100);
      expect(p?.scatter.verts, id).toBeGreaterThan(10000);
    }
  });
});
