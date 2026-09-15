import { describe, expect, it } from 'vitest';
import { fx } from '../../packages/sim/src/fixed';
import { DOMAIN_FOOT, TICKS_PER_SECOND, type Sim } from '../../packages/sim/src/sim';
import { idsOf, makeWorld } from './walk_world';

/**
 * A real map and a real roster, which no unit test has: tel_marum_2_foothold
 * fields 3 inf_squad, at_team, mortar_team, demo_squad, 2 apc_eitan and an
 * mbt_lavi from [21..27, 44..46] (its starting_force), on the one map with a
 * two-wide walled corridor (`b` at x=10-11, y=12-17, ridge either side).
 */
function settle(
  missionId: string,
  pick: (sim: Sim, id: number) => boolean,
  x: number,
  y: number,
  seconds: number
) {
  const { sim, nameOf } = makeWorld(missionId);
  const ids = idsOf(sim, 0).filter(
    (i) => sim.state.carriedBy[i] < 0 && sim.state.garrisonedIn[i] < 0 && pick(sim, i)
  );
  const fieldsBefore = sim.flowFieldCount;
  sim.queueCommand({ kind: 'move', ids, x: fx.fromInt(x), y: fx.fromInt(y) });
  for (let t = 0; t < seconds * TICKS_PER_SECOND; t++) sim.tick();
  const fieldsAfter = sim.flowFieldCount;
  const tiles = new Map<string, string[]>();
  for (const id of ids) {
    if (sim.state.alive[id] === 0) continue;
    const k = `${fx.toInt(sim.state.posX[id])},${fx.toInt(sim.state.posY[id])}`;
    tiles.set(k, [...(tiles.get(k) ?? []), nameOf.get(sim.state.typeIdx[id]) ?? '?']);
  }
  // The printed world: what a reviewer reads when this goes red.
  for (const [k, names] of tiles) console.log(`${k}: ${names.join(', ')}`);
  const stacked = [...tiles].filter(([, names]) => names.length > 1);
  return { tiles, ids, sim, stacked, fieldsBefore, fieldsAfter };
}
const everyone = (): boolean => true;
const onFoot = (sim: Sim, id: number): boolean => {
  const t = sim.unitTypes[sim.state.typeIdx[id]];
  return !t.isAir && t.moveDomain === DOMAIN_FOOT;
};

describe('a real roster lands on distinct tiles (tel_marum_2_foothold)', () => {
  it('the whole force into the open basin at (24,30)', () => {
    const { stacked, tiles, ids, sim, fieldsBefore, fieldsAfter } = settle(
      'tel_marum_2_foothold',
      everyone,
      24,
      30,
      90
    );
    expect(stacked, `stacked: ${JSON.stringify(stacked)}`).toHaveLength(0);
    expect(tiles.size).toBe(ids.length);
    // Vehicles on the clicked row (approach from the south), infantry south of it.
    for (const id of ids) {
      const y = fx.toInt(sim.state.posY[id]);
      if (onFoot(sim, id)) expect(y).toBeGreaterThan(30);
      else expect(y).toBe(30);
    }
    // One order, one cache miss per slot at worst: a group order does not
    // multiply the field pool beyond one field per unit ordered (spec
    // section 8, Deviation 5 — the pool is bounded and reuses unreferenced
    // fields, so this is an upper bound, not an exact count).
    const grown = fieldsAfter - fieldsBefore;
    console.log(`flow fields: ${fieldsBefore} -> ${fieldsAfter} (+${grown} for ${ids.length} units)`);
    expect(grown).toBeLessThanOrEqual(ids.length);
  });
  it('the foot units into the boulder corridor at (10,13) form a column', () => {
    const { stacked, ids, sim } = settle('tel_marum_2_foothold', onFoot, 10, 13, 120);
    expect(stacked, `stacked: ${JSON.stringify(stacked)}`).toHaveLength(0);
    // Every team is inside the corridor (x 10..11, y 12..17) or on the scree
    // south of its mouth — nowhere else is reachable within the walk bound.
    for (const id of ids) {
      const x = fx.toInt(sim.state.posX[id]);
      const y = fx.toInt(sim.state.posY[id]);
      expect(x >= 8 && x <= 13 && y >= 12 && y <= 20, `${x},${y}`).toBe(true);
    }
  });
});
