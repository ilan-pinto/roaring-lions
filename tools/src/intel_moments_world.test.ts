// tools/src/intel_moments_world.test.ts
//
// GH-113's two claims that only a real mission can hold, on Umm Zeitoun IV --
// the one mission that starts with enough intel for both calls -- built the
// way the app builds it (`mission-harness.ts`), with nothing driving it:
//
//  1. The tile's clock is right. The rate the app MEASURES from the floored
//     `runtime.intel` must agree with the sim's own accrual, and the tick it
//     predicts must be the tick the intel actually arrives. The oracle is the
//     accrual rule written here as LITERALS -- 8 a minute a drone, 5 a minute a
//     holding `mark_target` unit (`mission.ts`, INTEL_PER_MIN_DRONE/_SCOUT) --
//     never imported from the code under test.
//  2. The sweep readout names exactly the contacts the sim identified: one
//     minimap ring per contact whose contact level went to "identified" on
//     the sweep's tick, at that contact's position, and the count is the
//     sim's own `revealed` count.

import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { IntelMoments, IntelRate, type IntelOutput } from '../../packages/app/src/ui/intel-moments';
import { missionWorld } from './mission-harness';

const MISSION = 'umm_zeitoun_4_clearance';
const DRONE_PER_MIN = 8;
const SCOUT_PER_MIN = 5;

describe(`the intel clock on ${MISSION}`, () => {
  it('measures the sim\'s own rate and counts down to the tick the intel arrives', () => {
    const { sim, runtime } = missionWorld(MISSION, {});
    const oracle = (): number => {
      let r = 0;
      for (let i = 0; i < sim.entityCount; i++) {
        if (sim.state.alive[i] !== 1 || sim.state.side[i] !== 0 || sim.state.tunnelIn[i] >= 0) continue;
        const ty = sim.unitTypes[sim.state.typeIdx[i]];
        if (ty.role === 'drone') r += DRONE_PER_MIN;
        else if (ty.canMarkTarget && sim.state.moving[i] === 0) r += SCOUT_PER_MIN;
      }
      return r;
    };
    const rate = new IntelRate();
    const tick = (): void => {
      runtime.step(sim.tick());
      rate.push(sim.tickCount, runtime.intel);
    };
    // A minute to fill the window, holding the oracle still so the rate the
    // estimator sees is one rate.
    const expected = oracle();
    expect(expected).toBeGreaterThan(0);
    for (let k = 0; k < 1200; k++) {
      tick();
      expect(oracle()).toBe(expected);
    }
    expect(Math.abs(rate.perMin() - expected)).toBeLessThan(0.25);

    // The clock: predict, then wait for it.
    const target = runtime.intel + 20;
    const predicted = sim.tickCount + rate.ticksTo(target, runtime.intel);
    while (runtime.intel < target) tick();
    // Within one tick a side of the truth, on a 20/min-plus rate.
    expect(Math.abs(sim.tickCount - predicted)).toBeLessThanOrEqual(2);
  });
});

describe(`the sweep readout on ${MISSION}`, () => {
  it('rings exactly the contacts the sim identified, and says the sim\'s count', () => {
    const { sim, runtime } = missionWorld(MISSION, {});
    const moments = new IntelMoments({ sweepCost: runtime.sweepCost, strikeCost: runtime.strikeCost, toFx: fx.from });
    for (let k = 0; k < 40; k++) {
      const ev = sim.tick();
      runtime.step(ev);
      moments.afterTick(sim, sim.tickCount, ev, runtime.intel);
    }

    // The depot yard: under fog at the start, eight hostiles and four porters.
    const at = { x: 33, y: 10 };
    const before = new Int8Array(sim.entityCount);
    for (let i = 0; i < sim.entityCount; i++) before[i] = sim.contactLevel(0, i);
    expect(runtime.requestSweep(fx.from(at.x), fx.from(at.y))).toBe(true);
    moments.called('sweep', at.x, at.y, sim.tickCount);

    moments.beforeTick(sim);
    const events = sim.tick();
    runtime.step(events);
    const outs: IntelOutput[] = moments.afterTick(sim, sim.tickCount, events, runtime.intel);

    const revealed = events.find((e) => e.kind === 'revealed');
    expect(revealed).toBeDefined();
    const count = revealed?.kind === 'revealed' ? revealed.count : -1;
    expect(count).toBeGreaterThan(0);

    const identified: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] !== 1 || sim.state.alive[i] !== 1) continue;
      if (sim.contactLevel(0, i) === 2 && before[i] < 2) identified.push(i);
    }
    // Every contact in the circle was unidentified before: so the sim's
    // count IS the set that changed, and the readout must be that set.
    expect(identified).toHaveLength(count);

    const note = outs.find((o) => o.kind === 'note');
    expect(note).toMatchObject({ key: 'intel.note.sweepResult', params: { n: count } });
    const ring = outs.find((o) => o.kind === 'flash');
    expect(ring?.kind).toBe('flash');
    const points = ring?.kind === 'flash' ? ring.points : [];
    const want = identified.map((i) => ({ x: sim.state.posX[i] / 65536, y: sim.state.posY[i] / 65536 }));
    expect([...points].sort((a, b) => a.x - b.x || a.y - b.y)).toEqual(want.sort((a, b) => a.x - b.x || a.y - b.y));

    // And the breakdown adds up to the same contacts, by type.
    const breakdown = outs.find((o) => o.kind === 'breakdown');
    const types = breakdown?.kind === 'breakdown' ? breakdown.types : [];
    expect(types.length).toBeGreaterThan(0);
    expect(types.reduce((n, x) => n + x.n, 0)).toBeLessThanOrEqual(count);
    const byType = new Map<string, number>();
    for (const i of identified) {
      const name = sim.unitTypes[sim.state.typeIdx[i]].name;
      byType.set(name, (byType.get(name) ?? 0) + 1);
    }
    for (const t of types) expect(byType.get(t.name)).toBe(t.n);
  });
});
