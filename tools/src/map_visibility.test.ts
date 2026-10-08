// GH-416: keep the fight visible. Every campaign map must show at least VISIBLE_FLOOR of its
// fight tiles -- the passable tiles near its objectives and along its main routes -- to the
// default camera, with no building's mesh over more than half of a rifleman standing there.
// See map_visibility.ts for the metric and for why the floor is 0.84.
import { describe, expect, it } from 'vitest';
import { parseMap, type MapJson } from '../../packages/data/src/index';
import {
  VISIBLE_FLOOR,
  bodyHiddenShare,
  campaignMaps,
  measureMap,
  occluderFor,
  placeBuildings,
} from './map_visibility';

/**
 * Maps still under the floor. Each names the reading it was exempted at, which is a RATCHET:
 * the map may get better and may not get worse. When one clears the floor the demotion test
 * goes red and says to delete its entry.
 */
const EXEMPT: Record<string, { measured: number; reason: string }> = {
  beit_sahwan_3: {
    measured: 0.792,
    reason:
      'The old town at street scale is the map (ground-ladder §2, "sight lines of 3-5 tiles"). Fitting ' +
      'buildings to their plots (lead ruling 7 Oct, units/building-fit.ts) took it from 0.457 to 0.792; ' +
      'the lead accepted ~80% for it rather than a height cap or a shanty town. The floor is its reading ' +
      'under the fit, so it can get better and not worse.',
  },
};

describe('map visibility (GH-416)', async () => {
  const maps = campaignMaps();
  const results = new Map<string, Awaited<ReturnType<typeof measureMap>>>();
  for (const [id, missions] of maps) results.set(id, await measureMap(id, missions));

  it('measures every campaign map, and every one has a real fight to measure', () => {
    // 26 maps carry the 26 campaign missions (world.json). An instrument that found no fight
    // tiles would pass every map vacuously, so each must have a few hundred.
    expect(maps.size).toBe(26);
    for (const [id, r] of results) expect(r.fightTiles, id).toBeGreaterThan(300);
  });

  for (const [id] of maps) {
    const ex = EXEMPT[id];
    if (!ex) {
      it(`${id}: at least ${VISIBLE_FLOOR} of the fight is visible`, () => {
        const r = results.get(id)!;
        expect(r.visible, `${id}: ${r.hiddenTiles} of ${r.fightTiles} fight tiles hidden`).toBeGreaterThanOrEqual(
          VISIBLE_FLOOR
        );
      });
    } else {
      it(`${id}: exempt (${ex.measured}) -- no worse than when it was exempted, and still under the floor`, () => {
        const r = results.get(id)!;
        expect(r.visible, `${id} got worse than its exemption`).toBeGreaterThanOrEqual(ex.measured - 0.001);
        expect(
          r.visible,
          `${id} now clears the floor (${r.visible.toFixed(3)}): delete its EXEMPT entry`
        ).toBeLessThan(VISIBLE_FLOOR);
      });
    }
  }

  it('every exemption names a campaign map and gives a reason', () => {
    for (const [id, ex] of Object.entries(EXEMPT)) {
      expect(maps.has(id), id).toBe(true);
      expect(ex.reason.length, id).toBeGreaterThan(40);
    }
  });
});

// The instrument itself, on ground built for it. Each check is paired with a control that
// differs in one thing, so "the tile is visible" cannot pass for the wrong reason.
describe('map visibility: the instrument', () => {
  const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));
  const withBlock = (rows: string[], x0: number, y0: number, n: number, ch: string): string[] =>
    rows.map((r, y) => (y >= y0 && y < y0 + n ? r.slice(0, x0) + ch.repeat(n) + r.slice(x0 + n) : r));
  const mapOf = (rows: string[]) =>
    parseMap({ id: 't', name: 't', width: rows[0].length, height: rows.length, rows } as MapJson);

  it('reads the shipped house mesh: a real silhouette, over four world units tall', async () => {
    const h = await occluderFor('house');
    expect(h).not.toBeNull();
    let covered = 0;
    for (const d of h!.depth) if (d > -Infinity) covered++;
    expect(covered).toBeGreaterThan(1000);
    // 4.24 world units tall and 4.26 x 3.71 in plan, whatever footprint it stands on.
    expect(h!.planW).toBeGreaterThan(4);
    expect(h!.planD).toBeGreaterThan(3.5);
  });

  it('a house hides the ground up-screen of it (smaller x and y) and not the ground in front', async () => {
    const rows = withBlock(open(24, 24), 12, 12, 3, 'h');
    const m = mapOf(rows);
    const placed = await placeBuildings(m, 'off');
    expect(bodyHiddenShare(m, placed, 10, 10)).toBeGreaterThan(0.5); // behind it, as the camera looks
    expect(bodyHiddenShare(m, placed, 17, 17)).toBe(0); // in front of it
    expect(bodyHiddenShare(m, placed, 18, 9)).toBe(0); // beside it, across the view axis
    // control: the same tile on the same ground with no house
    const bare = mapOf(open(24, 24));
    expect(bodyHiddenShare(bare, await placeBuildings(bare), 10, 10)).toBe(0);
  });

  it('a house fitted to a 2x2 hides less than the same house at its shipped size', async () => {
    const hiddenTiles = async (fit: 'off' | 'stretch') => {
      const m = mapOf(withBlock(open(24, 24), 12, 12, 2, 'h'));
      const placed = await placeBuildings(m, fit);
      let n = 0;
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++) if (m.blocked[y * 24 + x] === 0 && bodyHiddenShare(m, placed, x, y) > 0.5) n++;
      return n;
    };
    const shipped = await hiddenTiles('off');
    const fitted = await hiddenTiles('stretch');
    expect(shipped).toBeGreaterThan(15);
    expect(fitted).toBeGreaterThan(0); // still a building, still a shadow
    expect(fitted).toBeLessThan(shipped / 2);
  });

  it('a shanty on the same footprint hides less than a house: the lever the reworked maps use', async () => {
    const count = async (ch: string) => {
      const m = mapOf(withBlock(open(24, 24), 12, 12, 3, ch));
      const placed = await placeBuildings(m, 'off');
      let n = 0;
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++) if (m.blocked[y * 24 + x] === 0 && bodyHiddenShare(m, placed, x, y) > 0.5) n++;
      return n;
    };
    const house = await count('h');
    const shanty = await count('s');
    expect(house).toBeGreaterThan(15);
    expect(shanty).toBeLessThan(house / 3);
  });
});
