// Two real sims on a real mission, fed ONE frame stream through the lockstep
// core, hashed every tick. The multiplayer sibling of `test:determinism`
// (spec §12). Runs under `pnpm test` (the `gates` job).
import { describe, it, expect } from 'vitest';
import { fx } from '@lions/sim';
import type { Command } from '@lions/sim';
import { LockstepClock, applyFrame, canonicalOrder, type Frame, type SeatWorld, type Stamped } from '@lions/net';
import { missionWorld } from '../mission-harness';

const MISSION = 'beit_sahwan_1_recon';
const TICKS = 1000;

interface SimView { width: number; height: number; structureCount: number; tunnelCount: number; entityCount: number; state: { side: Uint8Array; alive: Uint8Array } }

/** Both seats on side 0, as N0's sandbox room is. */
function worldFor(sim: SimView): SeatWorld {
  return {
    sideOfSeat: () => 0,
    sideOfEntity: (id) => (id >= 0 && id < sim.entityCount ? sim.state.side[id] : undefined),
    width: sim.width,
    height: sim.height,
    structureExists: (id) => Number.isInteger(id) && id >= 0 && id < sim.structureCount,
    tunnelExists: (id) => Number.isInteger(id) && id >= 0 && id < sim.tunnelCount,
  };
}

/** A canned order script: every player unit marches to a few points. */
function script(playerIds: readonly number[]): Map<number, Stamped[]> {
  const at = (tick: number, seat: 0 | 1, seq: number, cmd: Command): [number, Stamped] => [tick, { seat, seq, cmd }];
  const half = Math.ceil(playerIds.length / 2);
  const a = playerIds.slice(0, half);
  const b = playerIds.slice(half);
  const entries: [number, Stamped][] = [
    at(10, 0, 0, { kind: 'move', ids: a, x: fx.from(20.5), y: fx.from(20.5) }),
    at(10, 1, 0, { kind: 'move', ids: b, x: fx.from(26.5), y: fx.from(18.5) }),
    at(300, 1, 1, { kind: 'attackMove', ids: b, x: fx.from(30.5), y: fx.from(24.5) }),
    at(300, 0, 1, { kind: 'halt', ids: a }),
    at(600, 0, 2, { kind: 'attackMove', ids: a, x: fx.from(32.5), y: fx.from(22.5) }),
  ];
  const byTick = new Map<number, Stamped[]>();
  for (const [tick, s] of entries) byTick.set(tick, [...(byTick.get(tick) ?? []), s]);
  return byTick;
}

function stream(byTick: Map<number, Stamped[]>, ticks: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < ticks; t++) frames.push({ tick: t, cmds: canonicalOrder(byTick.get(t) ?? []) });
  return frames;
}

function playerIdsOf(sim: SimView): number[] {
  const ids: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) ids.push(i);
  return ids;
}

function run(frames: Frame[], onTick: (tick: number, hash: number) => void): void {
  const w = missionWorld(MISSION, {});
  const clock = new LockstepClock(0);
  const world = worldFor(w.sim);
  for (const f of frames) {
    expect(clock.push(f)).toBe('ok');
    for (const ready of clock.take(1)) {
      applyFrame(ready, w.sim, world);
      w.runtime.step(w.sim.tick());
      onTick(ready.tick, w.sim.hash());
    }
  }
}

describe('two clients, one frame stream', () => {
  it('agree on every tick for 1000 ticks', () => {
    const probe = missionWorld(MISSION, {});
    const frames = stream(script(playerIdsOf(probe.sim)), TICKS);
    const a: number[] = [];
    const b: number[] = [];
    run(frames, (_, h) => a.push(h));
    run(frames, (_, h) => b.push(h));
    expect(a.length).toBe(TICKS);
    expect(a).toEqual(b);
    // The script did something: the state is not the idle state.
    const idle: number[] = [];
    run(stream(new Map(), TICKS), (_, h) => idle.push(h));
    expect(a[TICKS - 1]).not.toBe(idle[TICKS - 1]);
  }, 60_000);   // 3.2-5.4 s alone; the 5 s default timed out under load

  it('a dropped command on one side is visible to the instrument by the next hash', () => {
    const probe = missionWorld(MISSION, {});
    const frames = stream(script(playerIdsOf(probe.sim)), 40);
    const cut = frames.map((f) => (f.tick === 10 ? { tick: 10, cmds: f.cmds.slice(1) } : f));
    const a = new Map<number, number>();
    const b = new Map<number, number>();
    run(frames, (t, h) => a.set(t, h));
    run(cut, (t, h) => b.set(t, h));
    expect(a.get(9)).toBe(b.get(9));
    expect(a.get(20)).not.toBe(b.get(20));
  });

  it('an out-of-order frame is refused and runs nothing', () => {
    const clock = new LockstepClock(0);
    expect(clock.push({ tick: 0, cmds: [] })).toBe('ok');
    expect(clock.push({ tick: 2, cmds: [] })).toBe('gap');
    expect(clock.push({ tick: 0, cmds: [] })).toBe('duplicate');
    expect(clock.take(10).map((f) => f.tick)).toEqual([0]);
    expect(clock.push({ tick: 0, cmds: [] })).toBe('duplicate');
    expect(clock.take(10)).toEqual([]);
  });
});
