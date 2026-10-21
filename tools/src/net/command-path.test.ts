// tools/src/net/command-path.test.ts
//
// N2 Task 5 (D3, lead 16 Oct: "check, then send"). Single-player's dock and
// armed support click no longer call `requestBuild`/`requestSupport` at click
// time: they dispatch a `build`/`support` Command to the transport, the frame
// path hands it to the sim, the sim sets it aside, and `main.ts`'s `runTick`
// opens with `runtime.applyQueued()`, BEFORE `sim.tick()`.
//
// This is the app's own path -- the real `runFrames`, a real `LocalTransport`
// and a real `MissionRuntime` on a shipped mission -- not the determinism
// test's drain-at-call-site. Two pipelines on one fixture:
//
//  A, the old path: `requestBuild` and `requestSupport` called directly between
//     ticks 100 and 101, and a `runTick` of `sim.tick(); rt.step(events)`.
//  B, the new path: the same two purchases as `transport.queueCommand(...)`
//     between the same ticks, and `main.ts`'s order in `runTick`:
//     `rt.applyQueued(); const ev = sim.tick(); rt.step(ev)`.
//
// They must be the same battle: equal `sim.hash()` and `rt.economyHash()` at
// tick 600, and equal `rt.production` at tick 101, when the build is in flight
// in both.

import { describe, expect, it } from 'vitest';
import { MissionRuntime, fx, type Sim } from '@lions/sim';
import { LocalTransport } from '@lions/net';
import { units } from '@lions/data';
import { missionStage } from '../mission-harness';
import { runFrames, seatWorldFor, type FrameStep } from '../../../packages/app/src/net/frame-step';

const MISSION = 'umm_zeitoun_4_clearance';
/** The depot yard, the sweep's aim in `intel_moments_world.test.ts`. */
const SWEEP_AT = { x: 33, y: 10 };
const BUY_AFTER = 100;
const END = 600;
/** The one buildable: the harness answers `unitInfo` with null for everything,
 *  so this fixture prices the rifle squad from its own JSON (as `main.ts` and
 *  `playtest-run.ts` do), and nothing else. */
const INF = units.inf_squad;

function world(): { sim: Sim; rt: MissionRuntime } {
  const { mission, sim, context } = missionStage(MISSION);
  const rt = new MissionRuntime(sim, mission, {
    ...context({}),
    unitInfo: (u) =>
      u === INF.id
        ? { logistics: INF.cost.logistics, buildTimeS: INF.cost.build_time_s ?? 20, population: INF.cost.population ?? 1 }
        : null,
  });
  rt.start();
  return { sim, rt };
}

interface Run {
  sim: Sim;
  rt: MissionRuntime;
  /** `rt.production` right after tick 101. */
  productionAt101: MissionRuntime['production'];
  /** What the two purchases answered on the old path; null on the new one. */
  accepted: [boolean, boolean] | null;
}

function pipeline(path: 'direct' | 'command'): Run {
  const { sim, rt } = world();
  const transport = new LocalTransport();
  const runTick =
    path === 'direct'
      ? (): void => {
          const ev = sim.tick();
          rt.step(ev);
        }
      : (): void => {
          // main.ts's order: the set-aside purchases run first, then the tick.
          rt.applyQueued();
          const ev = sim.tick();
          rt.step(ev);
        };
  const step: FrameStep = { transport, sim, seatWorld: seatWorldFor(null, sim), runTick, config: null };

  expect(runFrames(step, BUY_AFTER).ran).toBe(BUY_AFTER);
  expect(sim.tickCount).toBe(BUY_AFTER);

  let accepted: [boolean, boolean] | null = null;
  const sx = fx.from(SWEEP_AT.x);
  const sy = fx.from(SWEEP_AT.y);
  if (path === 'direct') {
    accepted = [rt.requestBuild('inf_squad'), rt.requestSupport('drone_sweep', sx, sy)];
  } else {
    transport.queueCommand({ kind: 'build', side: 0, unit: 'inf_squad' });
    transport.queueCommand({ kind: 'support', side: 0, support: 'drone_sweep', x: sx, y: sy });
  }

  expect(runFrames(step, 1)).toEqual({ ran: 1, dropped: 0 });
  const productionAt101 = rt.production;
  expect(runFrames(step, END - BUY_AFTER - 1).ran).toBe(END - BUY_AFTER - 1);
  expect(sim.tickCount).toBe(END);
  return { sim, rt, productionAt101, accepted };
}

describe(`the command path on ${MISSION} (N2 Task 5, D3)`, () => {
  it('a build and a sweep sent through the transport are the same battle as the direct calls', () => {
    const a = pipeline('direct');
    const b = pipeline('command');

    // The old path really bought both, so the equalities below are not two
    // runs that bought nothing.
    expect(a.accepted).toEqual([true, true]);
    expect(a.productionAt101).toHaveLength(1);
    expect(a.productionAt101[0].unit).toBe('inf_squad');

    // Tick 101: the build is in flight in both, started on the same tick.
    expect(b.productionAt101).toEqual(a.productionAt101);

    // Tick 600: the same battle and the same economy.
    expect(b.sim.hash()).toBe(a.sim.hash());
    expect(b.rt.economyHash()).toBe(a.rt.economyHash());
  });
});
