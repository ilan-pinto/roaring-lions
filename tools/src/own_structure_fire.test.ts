// No side fires on a structure its own side owns, in any shipped mission, in a passive run. Before `selectBreachTarget` asked who owns a wall,
// a Sarim gun truck razed its own side's weapons workshop in 6 s (Wadi Halam V: a `raze` target the player got for free) and an ATGM cell its
// own field clinic (Beit Sahwan III, destroyed at tick 2014). The rule is pinned in packages/sim/src/breach.test.ts; this holds the shipped data
// to it. The probe that prints the table is tools/src/backtest/structure-fire-probe.ts.
import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data';
import { missionWorld } from './mission-harness';

const TICKS = 3000;

describe('structure fire in the shipped missions (passive, seed 1)', () => {
  it(`no unit fires on a structure its own side owns, in any of the ${Object.keys(missions).length} missions, over ${TICKS} ticks`, () => {
    let shotsAtStructures = 0;
    // one line per (mission, shooter, structure): the first tick and how many shots, so a failure reads as a short list
    const ownShots = new Map<string, { first: number; shots: number }>();
    for (const id of Object.keys(missions)) {
      const { sim, runtime } = missionWorld(id, {}, 1);
      const side = sim.state.side;
      for (let n = 0; n < TICKS && runtime.result === 'ongoing'; n++) {
        const ev = sim.tick();
        for (const e of ev) {
          if (e.kind !== 'fire' || e.target >= 0 || e.structure === undefined) continue;
          shotsAtStructures++;
          if (sim.structures.owner[e.structure] === side[e.shooter]) {
            const key = `${id}: shooter ${e.shooter} (side ${side[e.shooter]}) -> structure ${e.structure}`;
            const seen = ownShots.get(key);
            if (seen === undefined) ownShots.set(key, { first: sim.tickCount, shots: 1 });
            else seen.shots++;
          }
        }
        runtime.step(ev);
      }
    }
    expect([...ownShots].map(([k, v]) => `${k}, first at tick ${v.first}, ${v.shots} shots`)).toEqual([]);
    // not vacuous: the neutral-wall breach shots (the rule's intended business) are plentiful in these worlds
    expect(shotsAtStructures).toBeGreaterThan(1000);
  }, 120_000);

  // The two structures that used to be destroyed by their own side. Alive and untouched on the old code they were not (tick 127 and 2014).
  const survivors: readonly [string, string, number][] = [
    ['wadi_halam_5_depot', 'militia_weapons_workshop', 1500],
    ['beit_sahwan_3_clearance', 'militia_field_clinic', 2200],
  ];
  for (const [id, type, ticks] of survivors) {
    it(`${id}: the ${type} its own side owns is still standing after ${ticks} ticks, at full hit points`, () => {
      const { sim, runtime } = missionWorld(id, {}, 1);
      const st = sim.structures;
      const ours = [...Array(st.alive.length).keys()].filter((s) => st.owner[s] === 1 && sim.structureTypes[st.typeIdx[s]]?.id === type);
      expect(ours.length).toBeGreaterThan(0); // the structure exists in this world, so the assertions below are about something
      for (let n = 0; n < ticks; n++) runtime.step(sim.tick());
      for (const s of ours) {
        expect(st.alive[s], `structure ${s}`).toBe(1);
        expect(st.hp[s], `structure ${s}`).toBe(st.maxHp[s]);
      }
    });
  }
});
