// tools/src/intel_moments_world.test.ts
//
// GH-113's two claims that only a real mission can hold, on Umm Zeitoun IV --
// the one mission that starts with enough intel for both calls -- built the
// way the app builds it (`mission-harness.ts`), with nothing driving it:
//
//  1. The tile shows no clock while nothing is earned. Intel stopped trickling
//     per minute at F1 Task 3 (G3 Q1, lead 4 Oct; F-R9): it is earned by doing,
//     a first identification or an objective, never by waiting. So a force
//     that stands a minute with no contact earns nothing: `runtime.intel` does
//     not move, the rate the app MEASURES from it (`IntelRate.perMin()`) reads
//     0, and the clock (`ticksTo(cost, intel)`) reads `Infinity`, which the
//     tile draws as no clock. (This claim used to hold the clock against the
//     trickle by literals, 8 a minute a drone and 5 a minute a holding scout.)
//     What the strip and the tile show instead is WP-S-F's (F-Q11).
//  2. The sweep readout names exactly the contacts the sim identified: one
//     minimap ring per contact whose contact level went to "identified" on
//     the sweep's tick, at that contact's position, and the count is the
//     sim's own `revealed` count.

import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { IntelMoments, IntelRate, type IntelOutput } from '../../packages/app/src/ui/intel-moments';
import { missionWorld } from './mission-harness';

const MISSION = 'umm_zeitoun_4_clearance';

describe(`the intel clock on ${MISSION}`, () => {
  it('stands a minute with no contact: intel does not move, no rate, no clock', () => {
    const { sim, runtime } = missionWorld(MISSION, {});
    const cost = runtime.sweepCost;
    const start = runtime.intel;
    const rate = new IntelRate();
    rate.push(sim.tickCount, runtime.intel);
    let earned = 0;
    let contacts = 0;
    for (let k = 0; k < 1200; k++) {
      const simEvents = sim.tick();
      for (const e of simEvents) {
        if (e.kind === 'contact' && e.side === 0 && e.level === 'identified') contacts++;
      }
      for (const e of runtime.step(simEvents)) if (e.kind === 'intelEarned') earned += e.amount;
      rate.push(sim.tickCount, runtime.intel);
    }
    // The oracle for "no contact" is the sim's own event stream, not the rule under test.
    expect(contacts).toBe(0);
    expect(earned).toBe(0);
    expect(runtime.intel).toBe(start);
    expect(rate.perMin()).toBe(0);
    // Ask for a target above what is held, so the answer cannot be the "already there" 0:
    // a stalled income promises no time at all.
    const ticks = rate.ticksTo(Math.max(cost, start + 1), runtime.intel);
    expect(ticks).toBe(Infinity);
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
    moments.called('drone_sweep', at.x, at.y, sim.tickCount);

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
