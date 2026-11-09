import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, runWatch, type WatchRunDeps, type WatchState } from './watch-run';
import { WatchRefused, type Live, type RunningLive } from './watch-connect';
import type { SpectateHooks } from './spectator';

const running = (n: number, of = 4): RunningLive => ({
  state: 'running', game: { n, of, seed: 1000, map: 'tel_marum', matchup: 'mirror' },
  wsUrl: `ws://127.0.0.1:1/api/match/CODE${n}/ws`, code: `CODE${n}`, ticket: 'tk', build: 'b', labels: ['rush', 'passive'], capTicks: 400, roundTicks: 40, run: 'x', last: null,
});
const idle = (state: Live['state'], last: Live['last'] = null): Live => ({ state, game: null, wsUrl: null, code: null, ticket: null, build: null, labels: null, capTicks: null, roundTicks: null, run: null, last });

interface Rig {
  deps: WatchRunDeps;
  log: string[];
  states: WatchState[];
  hooks: Map<number, SpectateHooks>;
  live: { next: Live | Error };
  bootGate: { fail: Set<number> };
}
function rig(): Rig {
  const log: string[] = [];
  const states: WatchState[] = [];
  const hooks = new Map<number, SpectateHooks>();
  const live: Rig['live'] = { next: idle('waiting') };
  const bootGate: Rig['bootGate'] = { fail: new Set() };
  const deps: WatchRunDeps = {
    fetchLive: async () => { if (live.next instanceof Error) throw live.next; return live.next; },
    boot: async (l, h) => {
      const n = l.game.n;
      log.push(`boot ${n}`);
      hooks.set(n, h);
      if (bootGate.fail.has(n)) throw new Error(`no ${n}`);
      return () => { log.push(`dispose ${n}`); };
    },
    schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    onState: (s) => { states.push(s); },
    hooksFor: () => ({ onReady: () => {}, onEnd: () => {} }),
    warn: () => {},
  };
  return { deps, log, states, hooks, live, bootGate };
}
const tick = async (ms = POLL_MS): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };

afterEach(() => { vi.useRealTimers(); });

describe('runWatch (GH-954 W1)', () => {
  it('boots a game once however often it is polled, and shows "playing"', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.live.next = running(1);
    const stop = runWatch(r.deps);
    await tick(0);
    await tick(); await tick(); await tick();
    expect(r.log).toEqual(['boot 1']);
    expect(r.states.at(-1)).toMatchObject({ phase: 'playing', live: { game: { n: 1 } } });
    expect(vi.getTimerCount()).toBe(1);   // the next poll is pending
    stop();
    expect(vi.getTimerCount()).toBe(0);   // and cancelled, not merely ignored when it fires
  });

  it('switches games through the old disposer: dispose 1 runs BEFORE boot 2 starts', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.live.next = running(1);
    const stop = runWatch(r.deps);
    await tick(0);
    r.live.next = running(2);
    await tick();
    expect(r.log).toEqual(['boot 1', 'dispose 1', 'boot 2']);
    stop();
    expect(r.log).toEqual(['boot 1', 'dispose 1', 'boot 2', 'dispose 2']);
  });

  it('keeps the last picture between games and after the run, and says so', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.live.next = running(1);
    const stop = runWatch(r.deps);
    await tick(0);
    r.hooks.get(1)?.onEnd('result');
    expect(r.states.at(-1)?.phase).toBe('finished');
    r.live.next = idle('between', { n: 1, outcome: 'seat0', by: 'cap', ticks: 400, players: ['rush', 'passive'] });
    await tick();
    expect(r.states.at(-1)).toMatchObject({ phase: 'between', last: { n: 1, outcome: 'seat0' } });
    r.live.next = idle('finished', { n: 1, outcome: 'seat0', by: 'cap', ticks: 400, players: ['rush', 'passive'] });
    await tick();
    expect(r.states.at(-1)?.phase).toBe('done');
    expect(r.log).toEqual(['boot 1']);   // nothing was torn down
    r.live.next = new WatchRefused(0);   // the server is gone: the picture and the phase stay
    await tick();
    expect(r.states.at(-1)?.phase).toBe('done');
    expect(r.log).toEqual(['boot 1']);
    stop();
    expect(r.log).toEqual(['boot 1', 'dispose 1']);
  });

  it('does not retry a game whose boot failed until the arena is on another game', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.bootGate.fail.add(1);
    r.live.next = running(1);
    const stop = runWatch(r.deps);
    await tick(0);
    await tick(); await tick();
    expect(r.log).toEqual(['boot 1']);
    r.bootGate.fail.delete(1);
    r.live.next = running(2);
    await tick();
    expect(r.log).toEqual(['boot 1', 'boot 2']);
    stop();
  });

  it('with no run: "no-run" on no answer; a 403 or 421 is "refused" and polling stops', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.live.next = new WatchRefused(0);
    const stop = runWatch(r.deps);
    await tick(0);
    expect(r.states.at(-1)?.phase).toBe('no-run');
    let calls = 0;
    r.deps.fetchLive = async () => { calls++; throw new WatchRefused(403); };
    await tick();
    expect(r.states.at(-1)?.phase).toBe('refused');
    const seen = calls;
    await tick(); await tick(); await tick();
    expect(calls).toBe(seen);
    stop();
  });

  it('dispose stops the polling, and a boot still in flight is disposed the moment it lands', async () => {
    vi.useFakeTimers();
    const r = rig();
    let land: (d: () => void) => void = () => {};
    r.deps.boot = (l) => new Promise((res) => { r.log.push(`boot ${l.game.n}`); land = res; });
    r.live.next = running(1);
    const stop = runWatch(r.deps);
    await tick(0);
    stop();
    stop();   // idempotent
    // The poll timer is cancelled, not merely ignored when it fires.
    expect(vi.getTimerCount()).toBe(0);
    land(() => { r.log.push('dispose 1'); });
    await tick(0);
    await tick(); await tick();
    expect(r.log).toEqual(['boot 1', 'dispose 1']);
    let polls = 0;
    r.deps.fetchLive = async () => { polls++; return running(1); };
    await tick(); await tick();
    expect(polls).toBe(0);
  });

  it('does not poll while a boot is in flight (a slow boot is not booted over)', async () => {
    vi.useFakeTimers();
    const r = rig();
    let land: (d: () => void) => void = () => {};
    r.deps.boot = (l) => new Promise((res) => { r.log.push(`boot ${l.game.n}`); land = res; });
    r.live.next = running(1);
    const stop = runWatch(r.deps);
    await tick(0);
    r.live.next = running(2);
    await tick(); await tick(); await tick();
    expect(r.log).toEqual(['boot 1']);
    land(() => { r.log.push('dispose 1'); });
    await tick(0);
    await tick();
    expect(r.log).toEqual(['boot 1', 'dispose 1', 'boot 2']);
    stop();
  });
});
