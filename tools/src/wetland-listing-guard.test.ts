// The wet-ground cost follow-up's guard (GH-871 P4 PR 914, the lead's ruling 2 of 31 Oct 2026).
//
// P4's wet-ground program misses its budget on medium and low, and merged anyway because the only
// wetland map, Ein Qasab, is unlisted. The ruling: a cheaper wet-ground program for medium and low
// must land before Ein Qasab is listed or the rain missions (GH-912) ship. This test is that
// promise made mechanical: while `CHEAP_WET_GROUND_LANDED` is false, it fails if a wetland map is
// listed in the Free Play picker or a shipped mission plays on one. The follow-up flips the
// constant in the commit that lands the cheaper program and re-measures.
//
// `listingViolations` is pure so it can be falsified on literals; the real inputs run through it
// once below. No packages/app source is edited for this: `UNLISTED_MAP_IDS` is read, not changed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maps } from '@lions/data';
import { CHEAP_WET_GROUND_LANDED } from '../../packages/render/src/three/weather';
import { UNLISTED_MAP_IDS } from '../../packages/app/src/ui/menu';

const FOLLOW_UP =
  'the cheaper wet-ground program for medium and low (GH-871, PR 914 ruling 2) has not landed; ' +
  'it must land before a wetland map is listed or a wetland mission ships (GH-912)';

/** Pure. `wetlandMaps` is every shipped map id on the wetland theme; `missionMaps` is, per shipped
 *  mission, the map id it plays on. Returns one line per broken promise; empty when released. */
export function listingViolations(
  unlisted: ReadonlySet<string>,
  wetlandMaps: readonly string[],
  missionMaps: readonly { mission: string; map: string }[],
  landed: boolean,
): string[] {
  if (landed) return [];
  const out: string[] = [];
  for (const id of wetlandMaps) {
    if (!unlisted.has(id)) out.push(`wetland map '${id}' left UNLISTED_MAP_IDS: ${FOLLOW_UP}`);
  }
  const wet = new Set(wetlandMaps);
  for (const { mission, map } of missionMaps) {
    if (wet.has(map)) out.push(`mission '${mission}' plays on wetland map '${map}': ${FOLLOW_UP}`);
  }
  return out;
}

// The raw JSON carries `terrain` only when authored; absent means arid (parseMap's default).
const wetlandMaps = Object.entries(maps as Record<string, { terrain?: string }>)
  .filter(([, m]) => m.terrain === 'wetland')
  .map(([id]) => id);

const missionDir = join(__dirname, '../../data/missions');
const missionMaps = readdirSync(missionDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const j = JSON.parse(readFileSync(join(missionDir, f), 'utf8')) as { id: string; map: { file: string } };
    return { mission: j.id, map: j.map.file };
  });

describe('wetland listing guard (GH-871 P4 PR 914 ruling 2)', () => {
  it('the switch is a boolean', () => {
    expect(typeof CHEAP_WET_GROUND_LANDED).toBe('boolean');
  });

  it('is not vacuous: Ein Qasab is the wetland map found, and missions were read', () => {
    expect(wetlandMaps.length).toBeGreaterThanOrEqual(1);
    expect(wetlandMaps).toContain('ein_qasab');
    expect(missionMaps.length).toBeGreaterThanOrEqual(1);
    // every mission resolves to a shipped map, or the wetland test above could not see it
    for (const m of missionMaps) expect(Object.keys(maps), m.mission).toContain(m.map);
  });

  it('while the follow-up is open: ein_qasab stays unlisted and no mission plays on a wetland map', () => {
    expect(
      listingViolations(UNLISTED_MAP_IDS, wetlandMaps, missionMaps, CHEAP_WET_GROUND_LANDED),
    ).toEqual([]);
    if (!CHEAP_WET_GROUND_LANDED) expect(UNLISTED_MAP_IDS.has('ein_qasab')).toBe(true);
  });

  describe('listingViolations on literals (the falsification)', () => {
    const wet = ['ein_qasab'];
    it('flags a wetland map missing from the unlisted set', () => {
      const v = listingViolations(new Set<string>(), wet, [], false);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatch(/ein_qasab.*left UNLISTED_MAP_IDS.*GH-871.*GH-912/);
    });
    it('flags a mission on a wetland map', () => {
      const v = listingViolations(new Set(['ein_qasab']), wet, [{ mission: 'm1', map: 'ein_qasab' }], false);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatch(/mission 'm1'.*ein_qasab.*GH-871.*GH-912/);
    });
    it('passes an unlisted wetland map and a dry mission', () => {
      expect(listingViolations(new Set(['ein_qasab']), wet, [{ mission: 'm2', map: 'tel_marum' }], false)).toEqual([]);
    });
    it('releases when the follow-up has landed', () => {
      expect(listingViolations(new Set<string>(), wet, [{ mission: 'm1', map: 'ein_qasab' }], true)).toEqual([]);
    });
  });
});
