/**
 * GH-322, widened by GH-871: every shipped map composes exactly the terrain
 * it composed before the change under test, highland included.
 *
 * The pin began (GH-322) as "every map OUTSIDE the Sur highland draws what it
 * drew before the highland biome existed". The wetland theme (GH-871) adds
 * another theme to the same composer, so it now pins ALL shipped maps: a
 * wetland change that leaked onto a highland, arid or green map would fail
 * here, and so would a change to the highland map itself.
 *
 * The pin is on the OUTPUT, not on the code. Every terrain tone is `quantise`d
 * to the nearest palette entry (`terrain/tones.ts`), so a new palette entry
 * nearer to some composite than the entry it used to snap to would recolour a
 * tile on a map nobody touched, silently. So the full `composeTerrain` result
 * (ground, scatter, residual, building boxes, decor and prop placements) for
 * every shipped map is hashed against a recorded fixture. The ARID pins were
 * REGENERATED for VR-05 (tussock `low` and foliage moved to `scrub.1`: a
 * deliberate change to how arid maps draw). Green maps keep `origin/main`'s
 * pins, by the lead's ruling that green keeps its foliage. The highland pins
 * were first recorded for GH-871 from the tree at b5e8f0be.
 *
 * The tones come through `rendererOptionsFor`, the app's one route from a map
 * to its `TerrainTones`, so a per-map grove override that leaked onto a map
 * without one would fail here too.
 *
 * Regenerate (only for a DELIBERATE change to how a shipped map draws, and say
 * so in the commit): `UPDATE_TERRAIN_DEFAULTS=1 pnpm vitest run
 * packages/app/src/terrain-defaults.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, paletteColor, type MapId } from '@lions/data';
import { composeTerrain } from '@lions/render/three';
import { rendererOptionsFor } from './renderer-options';

const FIXTURE = join(__dirname, 'terrain-defaults.fixture.json');
const UPDATE = process.env.UPDATE_TERRAIN_DEFAULTS === '1';
const HIGH = { colorVision: 'default', quality: 'high' } as const;

function digest(id: MapId): string {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 256 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsed.structures) {
    const t = typeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id}: unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = rendererOptionsFor(parsed, HIGH, '/').terrainTones;
  const c = composeTerrain(sim, parsed.decor, parsed.elevation, () => false, tones, paletteColor, paletteColor('shadow.1'));
  const h = createHash('sha256');
  for (const mesh of [c.ground, c.scatter, c.residual, ...c.buildings.map((b) => b.mesh)]) {
    h.update(Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength));
    h.update(Buffer.from(mesh.colors.buffer, mesh.colors.byteOffset, mesh.colors.byteLength));
    h.update(Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength));
  }
  h.update(JSON.stringify(c.decorPlacements));
  h.update(JSON.stringify(c.propPlacements));
  return h.digest('hex');
}

const shipped = (Object.keys(maps) as MapId[]).sort();

describe('every shipped map composes byte-for-byte to its recorded terrain (GH-322, GH-871)', () => {
  if (UPDATE) {
    it('regenerates the fixture', () => {
      const out: Record<string, string> = {};
      for (const id of shipped) out[id] = digest(id);
      writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
    }, 120_000);
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;

  it('covers every shipped map, and only those', () => {
    expect(Object.keys(recorded).sort()).toEqual(shipped);
  });

  for (const id of shipped) {
    it(`${id} composes to the recorded terrain`, () => {
      expect(digest(id)).toBe(recorded[id]);
    }, 30_000);
  }
});
