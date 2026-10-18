// tools/src/net/runtime-digest.test.ts
//
// N2 Task 6: the desync N3 would have missed. Two clients, each with its own
// `Sim` and `MissionRuntime` on one shipped mission, run the app's own frame
// path (`runFrames`, a sandbox-mode `MatchConfig`, seat 0 on side 0). A is sent
// a `build` at tick 3 and B is not. The build delivers at tick 3 + its build
// time, so at the first hash tick (19) the two SIMS are still identical: only
// the runtime knows a purse was spent and a squad is in the queue. With
// `runtimeDigest: () => rt.digest()` the reported digests differ there; without
// it (the control) they agree, and the split would surface only when the squad
// spawns.

import { describe, expect, it } from 'vitest';
import { MissionRuntime, type Command, type Sim } from '@lions/sim';
import { LocalTransport, validateConfig, type Frame, type MatchConfig, type MatchTransport, type TransportStatus } from '@lions/net';
import { units } from '@lions/data';
import { missionStage } from '../mission-harness';
import { runFrames, seatWorldFor, type FrameStep } from '../../../packages/app/src/net/frame-step';

const MISSION = 'umm_zeitoun_4_clearance';
const INF = units.inf_squad;
const BUILD_AT = 3;
const HASH_TICK = 19;

const CONFIG: MatchConfig = (() => {
  const seat = (s: 0 | 1) => ({ seat: s, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: 'umm_zeitoun', mode: 'sandbox', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'test', dataDigest: 0 });
  if (c === null) throw new Error('the sandbox config fixture no longer validates');
  return c;
})();

/** A local transport that keeps the digests it is told. */
class Recording implements MatchTransport {
  readonly local = true;
  readonly reports = new Map<number, number>();
  private readonly inner = new LocalTransport();
  queueCommand(cmd: Command): void { this.inner.queueCommand(cmd); }
  take(maxTicks: number): Frame[] { return this.inner.take(maxTicks); }
  reportTick(tick: number, digest: number | null): void {
    if (digest !== null) this.reports.set(tick, digest);
  }
  status(): TransportStatus { return this.inner.status(); }
  close(): void {}
}

interface Client {
  sim: Sim;
  rt: MissionRuntime;
  transport: Recording;
}

function client(build: boolean, withDigest: boolean): Client {
  const { mission, sim, context } = missionStage(MISSION);
  const rt = new MissionRuntime(sim, mission, {
    ...context({}),
    unitInfo: (u) =>
      u === INF.id
        ? { logistics: INF.cost.logistics, buildTimeS: INF.cost.build_time_s ?? 20, population: INF.cost.population ?? 1 }
        : null,
  });
  rt.start();
  const transport = new Recording();
  const step: FrameStep = {
    transport,
    sim,
    seatWorld: seatWorldFor(CONFIG, sim),
    runTick: () => {
      rt.applyQueued();
      const e = sim.tick();
      rt.step(e);
    },
    config: CONFIG,
    dataDigest: 1,
    ...(withDigest ? { runtimeDigest: () => rt.digest() } : {}),
  };
  expect(runFrames(step, BUILD_AT).ran).toBe(BUILD_AT);
  if (build) transport.queueCommand({ kind: 'build', side: 0, unit: INF.id });
  expect(runFrames(step, HASH_TICK + 1 - BUILD_AT)).toEqual({ ran: HASH_TICK + 1 - BUILD_AT, dropped: 0 });
  return { sim, rt, transport };
}

describe(`the runtime digest on the wire (${MISSION}, N2 Task 6)`, () => {
  it('two clients one build apart: equal sims at tick 19, different reported digests', () => {
    const a = client(true, true);
    const b = client(false, true);
    // The build really ran in A, and has not delivered yet.
    expect(a.rt.production).toHaveLength(1);
    expect(b.rt.production).toHaveLength(0);
    expect(a.sim.tickCount).toBe(HASH_TICK + 1);
    expect(a.sim.hash()).toBe(b.sim.hash());
    // 19 is the first hash tick: nothing was reported before it.
    expect([...a.transport.reports.keys()]).toEqual([HASH_TICK]);
    expect(a.transport.reports.get(HASH_TICK)).not.toBe(b.transport.reports.get(HASH_TICK));
  });

  it('control: without runtimeDigest the same two clients report the same digest at 19', () => {
    const a = client(true, false);
    const b = client(false, false);
    expect(a.rt.production).toHaveLength(1);
    expect(a.transport.reports.get(HASH_TICK)).toBe(b.transport.reports.get(HASH_TICK));
  });
});
