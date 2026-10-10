// tools/src/first_light_clock.test.ts
// WP-P3 (PA-05): First Light shows its hold clock once the families are in.
//
// #357 (GH-345, spec 2026-10-02 decision 7) gave First Light ONE countdown:
// `survive_relief` is authored `clock: false`, so the strip counts down only
// `evac_settlements`, the deadline that can fail. The polish audit found the
// cost: once the families are inside, nothing counts at all -- the strip, the
// big clock and the pause list show no time for the last ~4:30 of the second
// mission every player meets. The lead approved bringing the hold's clock
// back for that phase (6 Oct), keeping one countdown at a time.
//
// Proved here against the REAL mission runtime, stepped tick by tick on
// `playtest.ts`'s seed with `playtest.ts`'s own First Light plan (the jeep
// runs the western villages, the APC covers the south-west), and read through
// the app's own seam: `withoutHiddenClocks` + `clocklessObjectives` (what
// `main.ts`'s `liveObjectives` folds in) and `holdClock` (what the strip's
// clock and the big centre clock draw). Nothing is transcribed: the mission
// JSON's own `clock: false` is what is read.
import { describe, expect, it } from 'vitest';
import { fx, TICKS_PER_SECOND } from '@lions/sim';
import { clocklessObjectives, clockText, holdClock, withoutHiddenClocks } from '../../packages/app/src/ui/hud-model';
import { HARNESS_MAX_TICKS, missionWorld } from './mission-harness';

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

interface Reading {
  tick: number;
  evac: string;
  survive: string;
  /** The objective the HUD's clock counts down, or null for none. */
  clockFor: string | null;
  clockText: string | null;
  survivesTicksLeft: number | undefined;
}

function playFirstLight(): { readings: Reading[]; result: string } {
  const w = missionWorld('beit_sahwan_breach', {});
  const { sim, runtime, mission } = w;
  const clockless = clocklessObjectives(mission.objectives as readonly { id: string; clock?: boolean }[]);
  // The mission really authors the flag this test is about.
  expect([...clockless]).toEqual(['survive_relief']);

  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  // `playtest.ts`'s First Light plan, verbatim in its orders and timings.
  const plan = new Map<number, () => void>([
    [
      5 * TICKS_PER_SECOND,
      () => {
        sim.queueCommand({ kind: 'move', ids: ids('jeep_shoded'), ...M(13, 19) });
        sim.queueCommand({ kind: 'move', ids: ids('apc_eitan'), ...M(13, 28) });
      },
    ],
    [
      45 * TICKS_PER_SECOND,
      () => {
        sim.queueCommand({ kind: 'move', ids: ids('jeep_shoded'), ...M(20, 21) });
        sim.queueCommand({ kind: 'move', ids: ids('apc_eitan'), ...M(20, 26) });
      },
    ],
  ]);

  const readings: Reading[] = [];
  for (let t = 0; t < HARNESS_MAX_TICKS && runtime.result === 'ongoing'; t++) {
    plan.get(t)?.();
    runtime.step(sim.tick());
    if (t % TICKS_PER_SECOND !== 0) continue;
    const view = withoutHiddenClocks(runtime.objectiveList, clockless);
    const status = (id: string): string => view.find((o) => o.id === id)?.status ?? 'missing';
    const clock = holdClock({ name: mission.id, result: runtime.result, objectives: view });
    readings.push({
      tick: sim.tickCount,
      evac: status('evac_settlements'),
      survive: status('survive_relief'),
      clockFor: clock?.id ?? null,
      clockText: clock?.text ?? null,
      survivesTicksLeft: view.find((o) => o.id === 'survive_relief')?.ticksLeft,
    });
  }
  return { readings, result: runtime.result };
}

describe('First Light hold clock (WP-P3, PA-05)', () => {
  // A whole mission's worth of real sim ticks: see first_light_fence.test.ts
  // for why 30 s and not vitest's 5 s default.
  it('counts the families down first, then the hold, and is never blank while the hold runs', { timeout: 60_000 }, () => {
    const { readings, result } = playFirstLight();
    expect(result).toBe('victory');

    const evacPhase = readings.filter((r) => r.evac === 'active');
    const holdPhase = readings.filter((r) => r.evac === 'complete' && r.survive === 'active');
    expect(evacPhase.length).toBeGreaterThan(0);
    // The phase the audit measured: minutes of hold after the families are in.
    expect(holdPhase.length).toBeGreaterThan(3 * 60);

    // One countdown while the families are out: theirs, never the hold's.
    for (const r of evacPhase) {
      expect(r.clockFor).toBe('evac_settlements');
      expect(r.survivesTicksLeft).toBeUndefined();
    }
    // Once they are in, the hold's own clock, every second of it, in the
    // same m:ss the strip draws for any other countdown.
    for (const r of holdPhase) {
      expect(r.clockFor).toBe('survive_relief');
      expect(r.survivesTicksLeft).toBeDefined();
      expect(r.clockText).toBe(clockText(r.survivesTicksLeft ?? 0));
    }
    // And it really counts: down to the relief at 5:00 from the start.
    const first = holdPhase[0];
    const last = holdPhase[holdPhase.length - 1];
    expect(last.survivesTicksLeft ?? 0).toBeLessThan(first.survivesTicksLeft ?? 0);
    expect(last.survivesTicksLeft).toBe(300 * TICKS_PER_SECOND - last.tick);
  });
});
