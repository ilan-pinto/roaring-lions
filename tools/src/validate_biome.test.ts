// The data gate's region -> biome check (GH-322), against fixtures that it
// must reject and against the shipped campaign, which it must pass.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGION_BIOME, regionBiomeFailures } from '../validate_biome.mjs';

const ROOT = join(__dirname, '..', '..');
const load = (rel: string): unknown => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const world = {
  regions: [
    { id: 'marj', towns: [{ id: 'a', missions: ['m_marj'] }] },
    { id: 'sur', towns: [{ id: 'b', missions: ['m_sur_1', 'm_sur_2'] }] },
  ],
};
const missions = new Map<string, unknown>([
  ['m_marj', { map: { file: 'desert' } }],
  ['m_sur_1', { map: { file: 'hill' } }],
  ['m_sur_2', { map: { file: 'hill_2' } }],
]);

describe('the region biome check', () => {
  it('passes when every Sur map declares highland, and ignores unlisted regions', () => {
    const maps = new Map<string, unknown>([
      ['desert', { id: 'desert' }],
      ['hill', { id: 'hill', terrain: 'highland' }],
      ['hill_2', { id: 'hill_2', terrain: 'highland', grove: 'olive' }],
    ]);
    expect(regionBiomeFailures(world, missions, maps)).toEqual([]);
  });

  it('rejects a Sur map with no terrain key, naming the map, the mission and the region', () => {
    const maps = new Map<string, unknown>([
      ['desert', { id: 'desert' }],
      ['hill', { id: 'hill' }],
      ['hill_2', { id: 'hill_2', terrain: 'highland' }],
    ]);
    const out = regionBiomeFailures(world, missions, maps);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('data/maps/hill.json');
    expect(out[0]).toContain('terrain "arid"');
    expect(out[0]).toContain('m_sur_1');
    expect(out[0]).toContain('"highland"');
  });

  it('rejects a Sur map that declares another biome', () => {
    const maps = new Map<string, unknown>([
      ['hill', { id: 'hill', terrain: 'green' }],
      ['hill_2', { id: 'hill_2', terrain: 'highland' }],
    ]);
    expect(regionBiomeFailures(world, missions, maps)).toEqual([
      'data/maps/hill.json: terrain "green", but mission "m_sur_1" is in region "sur", whose maps must declare "highland"',
    ]);
  });

  it('reports a map two missions share once', () => {
    const shared = new Map<string, unknown>([
      ['m_sur_1', { map: { file: 'hill' } }],
      ['m_sur_2', { map: { file: 'hill' } }],
    ]);
    const maps = new Map<string, unknown>([['hill', { id: 'hill' }]]);
    expect(regionBiomeFailures(world, shared, maps)).toHaveLength(1);
  });

  it('passes the shipped campaign, and the shipped campaign has Sur maps to check', () => {
    const w = load('data/campaign/world.json') as { regions: { id: string; towns: { missions: string[] }[] }[] };
    const ms = new Map<string, unknown>();
    for (const f of readdirSync(join(ROOT, 'data/missions')).filter((n) => n.endsWith('.json'))) {
      ms.set(f.slice(0, -5), load(`data/missions/${f}`));
    }
    const mapsById = new Map<string, { id: string; terrain?: string }>();
    for (const f of readdirSync(join(ROOT, 'data/maps')).filter((n) => n.endsWith('.json'))) {
      const m = load(`data/maps/${f}`) as { id: string; terrain?: string };
      mapsById.set(m.id, m);
    }
    expect(regionBiomeFailures(w, ms, mapsById)).toEqual([]);
    const surMaps = new Set(
      w.regions
        .filter((r) => REGION_BIOME[r.id as keyof typeof REGION_BIOME] !== undefined)
        .flatMap((r) => r.towns.flatMap((t) => t.missions))
        .map((m) => (ms.get(m) as { map: { file: string } }).map.file)
    );
    // qarn_hadid, qarn_hadid_2-3, tel_marum_1-3, umm_zeitoun, umm_zeitoun_2-4 (tel_marum
    // itself is the sandbox map, used by no mission, and declares highland
    // on its own).
    expect([...surMaps].sort()).toEqual([
      'qarn_hadid',
      'qarn_hadid_2',
      'qarn_hadid_3',
      'tel_marum_1',
      'tel_marum_2',
      'tel_marum_3',
      'umm_zeitoun',
      'umm_zeitoun_2',
      'umm_zeitoun_3',
      'umm_zeitoun_4',
    ]);
    expect(mapsById.get('tel_marum')?.terrain).toBe('highland');
  });
});
