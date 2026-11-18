import { describe, expect, it } from 'vitest';
import { RUN_TICKS, buildWorld, passA, passB, pct, pilotMission } from './crowd-tick-budget';

describe('the Breach pilot crowd tick budget (civilian-drama E9)', () => {
  it('the pilot is the design\'s crowd: 11 village civilians, 89 on the road (45 west, 44 east), and the 7 shipped garrison placements stay', () => {
    const m = pilotMission('open') as unknown as { civilians: { groups: { count: number; group: string }[] } };
    const by = (g: string): number => m.civilians.groups.filter((x) => x.group === g).reduce((a, x) => a + x.count, 0);
    expect(['families_nw', 'families_ne', 'families_sw', 'families_se'].map(by)).toEqual([3, 3, 3, 2]);
    expect(by('road_w')).toBe(45);
    expect(by('road_e')).toBe(44);
    const w = buildWorld('passive', 'open', 7);
    let civ = 0;
    for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.side[i] === 2 && w.sim.state.alive[i] === 1) civ++;
    expect(civ).toBe(100);
  });

  it('the stress knob adds exactly that many civilians, and a shut gate adds the two fences', () => {
    const w = buildWorld('passive', 'open', 7, 56);
    let civ = 0;
    for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.side[i] === 2 && w.sim.state.alive[i] === 1) civ++;
    expect(civ).toBe(156);
    const open = (pilotMission('open') as unknown as { structures: unknown[] }).structures.length;
    const shut = (pilotMission('shut') as unknown as { structures: unknown[] }).structures.length;
    expect(shut - open).toBe(2);
  });

  it('timing the systems does not change the simulation: the same seed has the same living and lifetime counts in the clean pass and the wrapped pass, tick for tick', () => {
    const a = passA('passive', 'shut', 11, 0, 300);
    const b = passB('passive', 'shut', 11, 0, 300);
    expect(a.rows.map((r) => r.living)).toEqual(b.living);
    expect(a.rows.map((r) => r.lifetime)).toEqual(b.lifetime);
  });

  it('the wrappers measure: detection costs something on every run, and the 2 s order tick computes the flow fields the design counts (dozens at once)', () => {
    const b = passB('passive', 'open', 11, 0, 60);
    expect(b.per.detection.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    expect(b.calls.fieldCompute[40]).toBeGreaterThan(50);
    expect(RUN_TICKS).toBe(6000);
    expect(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(6);
  });
});
