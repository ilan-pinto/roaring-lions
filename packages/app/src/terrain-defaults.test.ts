/**
 * GH-322: every map OUTSIDE the Sur highland draws exactly what it drew
 * before the highland biome existed.
 *
 * The biome is a third `terrain` value plus three optional `TerrainTones`
 * fields (`decorColors`, `openScatter`, `macroHue`) whose absence is today's
 * behaviour. That is true by construction for the code paths -- but not for
 * the PALETTE: the biome added a `karst` ramp to `data/palette.json`, and
 * every terrain tone is `quantise`d to the nearest palette entry
 * (`terrain/tones.ts`). A new entry nearer to some arid composite than the
 * entry it used to snap to would recolour that tile on a map nobody touched,
 * silently. So the pin is on the OUTPUT, not on the code: the full
 * `composeTerrain` result (ground, scatter, residual, building boxes, decor
 * and prop placements) for every non-highland shipped map, hashed, against
 * hashes recorded at `origin/main` 7dc3d134 -- the commit before the biome.
 *
 * The tones come through `rendererOptionsFor`, the app's one route from a map
 * to its `TerrainTones`, so a per-map grove override that leaked onto a map
 * without one would fail here too.
 *
 * Regenerate (only for a DELIBERATE change to how a non-highland map draws,
 * and say so in the commit): `UPDATE_TERRAIN_DEFAULTS=1 pnpm vitest run
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

const nonHighland = (Object.keys(maps) as MapId[]).filter((id) => parseMap(maps[id]).terrain !== 'highland').sort();

describe('non-highland maps draw byte-for-byte as before the biome (GH-322)', () => {
  if (UPDATE) {
    it('regenerates the fixture', () => {
      const out: Record<string, string> = {};
      for (const id of nonHighland) out[id] = digest(id);
      writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
    }, 120_000);
    return;
  }
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;

  it('covers every non-highland map, and only those', () => {
    expect(Object.keys(recorded).sort()).toEqual(nonHighland);
  });

  for (const id of nonHighland) {
    it(`${id} composes to the recorded terrain`, () => {
      expect(digest(id)).toBe(recorded[id]);
    }, 30_000);
  }
});
