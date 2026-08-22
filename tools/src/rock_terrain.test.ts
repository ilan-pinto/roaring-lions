// Rock terrain, from authored JSON to a broken sight line.
//
// map.test.ts proves `^` parses. This proves it MATTERS: a ridge between two
// units stops them seeing each other, which is the single mechanic the whole
// Sur front rests on ("rock that blocks sight -- fields of fire and dead
// ground"). losRay already returned -1 for a structureless blocked tile; what
// was missing was any way to author one, and any test that the authoring works.
//
// Every case is paired with the identical map using '.' instead of '^'. A test
// that only asserts "cannot see" passes when the spawn is broken, when the
// units are on the same side, or when detection is switched off entirely. The
// control is what makes the assertion mean anything.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this -- same reasoning as
// protected_sites.test.ts.
import { describe, expect, it } from 'vitest';
import { applyTerrain, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

const SCOUT: UnitTypeJson = {
  id: 't_scout',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 16, signature: 0.6 },
};

/** A 16x5 corridor with a full-height wall of `fill` down column 8. */
function corridor(fill: '^' | '.'): MapJson {
  const row = (): string => `........${fill}.......`;
  return { id: `corridor_${fill === '^' ? 'rock' : 'open'}`, name: 'Corridor', width: 16, height: 5, rows: [row(), row(), row(), row(), row()] };
}

/** Build the world, put a scout each side of column 8, and let detection settle. */
function watch(fill: '^' | '.'): { sim: Sim; west: number; east: number } {
  const map = parseMap(corridor(fill));
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const scout = sim.addUnitType(SCOUT);
  const west = sim.spawn(scout, 0, fx.from(3.5), fx.from(2.5));
  const east = sim.spawn(scout, 1, fx.from(13.5), fx.from(2.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return { sim, west, east };
}

describe('a rock ridge authored as `^`', () => {
  it('is impassable to the sim, not merely to the parser', () => {
    const { sim } = watch('^');
    for (let y = 0; y < 5; y++) expect(sim.blocked[y * 16 + 8]).toBe(1);
  });

  it('breaks the sight line across it', () => {
    const { sim, west, east } = watch('^');
    expect(sim.debugDetection(west, east)?.visible).toBe(false);
  });

  it('and the same ground without it does not — the control', () => {
    // 10 tiles apart with 16 tiles of sight. If THIS fails, the test above
    // proves nothing: the units were never going to see each other anyway.
    const { sim, west, east } = watch('.');
    expect(sim.debugDetection(west, east)?.visible).toBe(true);
  });

  it('leaves the ridge tiles with no cover, so nothing gains concealment from it', () => {
    const { sim } = watch('^');
    for (let y = 0; y < 5; y++) expect(sim.cover[y * 16 + 8]).toBe(0);
  });
});
