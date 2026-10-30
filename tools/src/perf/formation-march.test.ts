// GH-859 P1b, spec 8.6: non-vacuity of the march perf probe. It is REPORT-ONLY, so what must not pass quietly is a
// "formed" arm that formed nothing (the delta would then be two plain runs) or a "plain" arm that formed something.
import { describe, expect, it } from 'vitest';
import { GROUPS, GROUP_UNITS, PER_GROUP, buildMarch, liveGroups, medianOf, readRun, runArm, type ArmRun } from './formation-march';

describe('the two arms', () => {
  it('the world is 300 units in fifteen groups of twenty', () => {
    expect(GROUPS).toBe(15);
    expect(PER_GROUP).toBe(20);
    expect(GROUP_UNITS).toHaveLength(20);
    const m = buildMarch(true);
    expect(m.groups).toHaveLength(15);
    expect(m.groups.every((g) => g.length === 20)).toBe(true);
    expect(new Set(m.groups.flat()).size).toBe(300);
  });

  it('the formed arm has 15 groups live at tick 1, each holding its twenty', () => {
    const m = buildMarch(true);
    m.sim.tick();
    expect(liveGroups(m)).toBe(15);
    for (const ids of m.groups) {
      const rows = new Set(ids.map((id) => m.sim.formationGroupOf(id)));
      expect(rows.size).toBe(1);
      expect(m.sim.formationMembersOfGroup([...rows][0])).toBe(20);
    }
  });

  it('the plain arm forms none', () => {
    const m = buildMarch(false);
    m.sim.tick();
    expect(liveGroups(m)).toBe(0);
  });

  it('runArm reads the same facts: 15 groups of 20 at tick 1 formed, none plain, and every unit alive', () => {
    const f = runArm(true, 3);
    const p = runArm(false, 3);
    expect([f.groupsAtTick1, f.membersAtTick1]).toEqual([15, 300]);
    expect([p.groupsAtTick1, p.membersAtTick1]).toEqual([0, 0]);
    expect([f.alive, p.alive]).toEqual([300, 300]);
    expect(f.ms).toHaveLength(3);
  });
});

describe('the reading (hand-built, literals)', () => {
  it('medianOf takes the mean of the two middle values of an even list', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBe(0);
  });

  const arm = (formed: boolean, ms: number[], releaseTicks: number[], peak: number): ArmRun => ({
    formed, ticks: ms.length, ms, releaseTicks, flowFieldPeak: peak, groupsAtTick1: formed ? 15 : 0, membersAtTick1: formed ? 300 : 0, alive: 300,
  });
  it('the delta is formed minus plain, the worst activation is the slowest release tick, its excess is over the plain median', () => {
    const r = readRun(arm(true, [9, 2, 2, 7, 2, 4], [1, 3, 5], 40), arm(false, [8, 1, 1, 1, 1, 1], [], 90));
    // formed median of [2,2,2,4,7,9] = 3, plain median of [1,1,1,1,1,8] = 1
    expect(r.medianFormed).toBe(3);
    expect(r.medianPlain).toBe(1);
    expect(r.delta).toBe(2);
    // release ticks 1, 3, 5 read 2, 7, 4: the worst is 7 at tick 3, 6 over the plain median
    expect(r.worstActivation).toBe(7);
    expect(r.worstActivationTick).toBe(3);
    expect(r.worstActivationExcess).toBe(6);
    expect(r.medianActivationExcess).toBe(3); // release ticks read [2, 7, 4]: median 4, minus the plain median 1
    expect(r.orderTickFormed).toBe(9);
    expect(r.orderTickPlain).toBe(8);
    expect(r.releases).toBe(3);
    expect([r.flowFieldPeakFormed, r.flowFieldPeakPlain]).toEqual([40, 90]);
  });
  it('an arm with no release has no worst activation, not zero', () => {
    const r = readRun(arm(true, [1, 1], [], 1), arm(false, [1, 1], [], 1));
    expect(r.worstActivation).toBeNull();
    expect(r.worstActivationExcess).toBeNull();
    expect(r.medianActivationExcess).toBeNull();
  });
});
