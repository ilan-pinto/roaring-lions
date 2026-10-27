// The pure parts of `pnpm net:rejoin-measure` (snapshot S4 T1C): the argument
// parser, the phase arithmetic and the frozen-gap reader. The tool itself
// opens a Metal browser and never runs in CI. Oracles are literals.
import { describe, expect, it } from 'vitest';
import type { NetStats } from '@lions/net';
import type { ProducerStats } from '../../../packages/app/src/net/snapshot-producer';
import { formatTable, frozenOf, isMetalRenderer, onFailures, onLines, parseArgs, phases, restartDev, stallSummary, type OnReadings, type RoomResult } from './rejoin-measure';

describe('parseArgs', () => {
  it('defaults to the plan\'s run: 6,000 and 24,000 ticks, mode off, a 50 ms tick, the browser on', () => {
    expect(parseArgs([])).toEqual({ ticks: [6000, 24000], modes: ['off'], tickMs: 50, out: null, shotDir: null, browser: true });
    expect(parseArgs(['--'])).toEqual({ ticks: [6000, 24000], modes: ['off'], tickMs: 50, out: null, shotDir: null, browser: true });
  });
  it('takes the options, sorts the ticks, and leaves --port to claimPort', () => {
    expect(parseArgs(['--', '--port=5300', '--ticks=24000,600', '--modes=off,on', '--tick-ms=2', '--out=/x/y.json', '--shot-dir=/x/shots', '--no-browser']))
      .toEqual({ ticks: [600, 24000], modes: ['off', 'on'], tickMs: 2, out: '/x/y.json', shotDir: '/x/shots', browser: false });
  });
  it('refuses a bad --ticks, an unknown mode, a bad --tick-ms and an unknown option', () => {
    expect(parseArgs(['--ticks=abc'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=6000,'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=50'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=30000'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=6000,6000'])).toHaveProperty('error');
    expect(parseArgs(['--modes=snap'])).toEqual({ error: expect.stringContaining('unknown mode "snap"') });
    expect(parseArgs(['--modes=on,on'])).toEqual({ error: expect.stringContaining('distinct') });
    expect(parseArgs(['--shot-dir'])).toHaveProperty('error');
    expect(parseArgs(['--modes=off,snap'])).toHaveProperty('error');
    expect(parseArgs(['--modes=off,off'])).toEqual({ error: expect.stringContaining('distinct') });
    expect(parseArgs(['--tick-ms=0'])).toHaveProperty('error');
    expect(parseArgs(['--bogus'])).toEqual({ error: expect.stringContaining('unknown option --bogus') });
    expect(parseArgs(['--ticks'])).toHaveProperty('error');
  });
});

describe('phases', () => {
  it('splits a recorded timeline: boot, time to live, and the replay phase between them', () => {
    // Navigation at 1,000; __lions defined at 3,200; live at 15,200 (ms on one clock).
    expect(phases({ navAt: 1000, bootAt: 3200, liveAt: 15_200 })).toEqual({ bootMs: 2200, liveMs: 14_200, replayMs: 12_000 });
  });
  it('is null when the page never booted or never went live', () => {
    expect(phases({ navAt: 1000, bootAt: null, liveAt: null })).toBeNull();
    expect(phases({ navAt: 1000, bootAt: 3200, liveAt: null })).toBeNull();
  });
});

describe('frozenOf', () => {
  // Seat 0 sampled around a reload at t = 1,000, live at t = 1,900; a room tick is 50 ms.
  // Frames flow to t = 1,000 (tick 100), stop until t = 1,600 (tick 101), stop
  // again until t = 1,800 (tick 102), then one 100 ms step (tick 103 at 1,900).
  const samples = [
    { t: 1000, tick: 100 }, { t: 1100, tick: 100 }, { t: 1300, tick: 100 }, { t: 1590, tick: 100 },
    { t: 1600, tick: 101 }, { t: 1650, tick: 101 }, { t: 1700, tick: 101 },
    { t: 1800, tick: 102 }, { t: 1850, tick: 102 }, { t: 1900, tick: 103 },
  ];
  it('reads the longest stretch with no new frame, the tick before it, and the total held still', () => {
    const f = frozenOf(samples, 1000, 1900, 50);
    expect(f.longestMs).toBe(600);
    expect(f.longestRoomTicks).toBe(12);
    expect(f.tickBeforeLongest).toBe(100);
    // 600 ms and 200 ms count; the final 100 ms (1,800 to 1,900) is two room ticks, under the 3-tick bar.
    expect(f.totalMs).toBe(800);
    expect(f.totalRoomTicks).toBe(16);
  });
  it('closes a stretch still open at live, and ignores samples outside the window', () => {
    const f = frozenOf([{ t: 500, tick: 7 }, { t: 1000, tick: 100 }, { t: 1500, tick: 100 }, { t: 2500, tick: 150 }], 1000, 2000, 50);
    expect(f.longestMs).toBe(1000);
    expect(f.tickBeforeLongest).toBe(100);
    expect(frozenOf([], 1000, 2000, 50)).toEqual({ longestMs: 0, longestRoomTicks: 0, tickBeforeLongest: 0, totalMs: 0, totalRoomTicks: 0 });
  });
});

describe('isMetalRenderer', () => {
  it('accepts the ANGLE Metal string and refuses SwiftShader and the no-GPU markers', () => {
    expect(isMetalRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)')).toBe(true);
    expect(isMetalRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(false);
    expect(isMetalRenderer('no-webgl')).toBe(false);
    expect(isMetalRenderer('no-debug-renderer-info')).toBe(false);
    expect(isMetalRenderer('')).toBe(false);
  });
});

describe('restartDev', () => {
  /** A dev server fake: `up` is whether the port answers; stopping it takes `lag` probes to go quiet. */
  function fake(opts: { startReturns: (n: number) => string | null; lag?: number }) {
    const log: string[] = [];
    let up = false;
    let probesLeft = 0;
    let starts = 0;
    return {
      log,
      deps: {
        start: async () => { const h = opts.startReturns(starts++); log.push(`start ${h}`); up = true; return h; },
        stop: (h: string) => { log.push(`stop ${h}`); probesLeft = opts.lag ?? 0; if (probesLeft === 0) up = false; },
        isUp: async () => { if (probesLeft > 0 && --probesLeft === 0) up = false; return up; },
        sleep: async () => {},
      },
    };
  }
  it('stops the last mode\'s server before starting the next, and returns the NEW handle', async () => {
    const f = fake({ startReturns: (n) => `dev${n}` });
    const first = await restartDev<string>(null, f.deps);
    const second = await restartDev(first, f.deps);
    expect(second).toBe('dev1');
    expect(f.log).toEqual(['start dev0', 'stop dev0', 'start dev1']);
  });
  it('waits for the old port to go quiet, so the next start is not a reuse of the dying server', async () => {
    const f = fake({ startReturns: (n) => `dev${n}`, lag: 3 });
    const first = await restartDev<string>(null, f.deps);
    await restartDev(first, f.deps);
    expect(f.log).toEqual(['start dev0', 'stop dev0', 'start dev1']);
  });
  it('refuses a null start (a server this run did not start, proxying the wrong relay) rather than returning a null handle', async () => {
    const f = fake({ startReturns: () => null });
    await expect(restartDev<string>(null, f.deps)).rejects.toThrow(/did not start/);
  });
  it('gives up when the old server never goes quiet', async () => {
    const deps = { start: async () => 'x', stop: () => {}, isUp: async () => true, sleep: async () => {} };
    await expect(restartDev<string>('old', deps, -1)).rejects.toThrow(/still answers/);
  });
});

describe('seat 0 stalls', () => {
  const stats = (gone: number, goneMs: number, behind: number, behindMs: number): NetStats => ({
    hashOk: { count: 0, lastTick: null },
    stalls: { gone: { count: gone, longestMs: goneMs }, behind: { count: behind, longestMs: behindMs } } as NetStats['stalls'],
    reconnects: { count: 0, lastOutageMs: null, lastReplayMs: null },
    desyncTick: null,
  });
  it('summarises gone and behind', () => {
    expect(stallSummary(stats(1, 1455.4, 2, 3910))).toBe('gone 1 (longest 1455 ms), behind 2 (longest 3910 ms)');
    expect(stallSummary(null)).toBe('not read');
  });
  it('prints the reading taken at live beside the baseline from the drop', () => {
    const row: RoomResult = {
      mode: 'off', ticks: 6000, code: 'ABCDEF', skipped: null, seat0TickAtDrop: 6000, seat1TickAtDrop: 6000,
      boot: { bootMs: 1, liveMs: 3, replayMs: 2 }, frozen: { longestMs: 1, longestRoomTicks: 0, tickBeforeLongest: 0, totalMs: 1, totalRoomTicks: 0 },
      browserNet: null, firstSeen: null, tickCountAtLive: 6039,
      seat0Stats: stats(0, 0, 0, 0), seat0StatsAtLive: stats(0, 0, 1, 1455),
      consoleErrors: [], load: { start: 1, end: 1 }, snapshot: null,
    };
    const out = formatTable([row], 'gpu', 'conditions');
    expect(out).toContain('seat 0 stalls at live: gone 0 (longest 0 ms), behind 1 (longest 1455 ms)');
    expect(out).toContain('(at the drop: gone 0 (longest 0 ms), behind 0 (longest 0 ms))');
  });
});

describe('mode on: onFailures', () => {
  const prod = (over: Partial<ProducerStats> = {}): ProducerStats => ({ encodes: 5, lastEncodeMs: 12.3, stored: 2, held: 3, recorded: 0, mismatch: 0, refused: 0, failed: 0, skipped: {}, ...over });
  const good = { rejoin: { path: 'snapshot', from: 4800, restoreMs: 140 }, browserProducer: prod(), seat0: prod(), seat1AtDrop: prod({ stored: 0, held: 0, recorded: 4 }) };
  it('is empty for a snapshot rejoin with accepted uploads and no mismatch', () => {
    expect(onFailures(good)).toEqual([]);
    expect(onFailures({ ...good, browserProducer: null })).toEqual([]);
  });
  it('names a fallback: the full path and its reason, or no rejoin at all', () => {
    expect(onFailures({ ...good, rejoin: { path: 'full', reason: 'none' } })).toEqual(['the browser\'s rejoin path was "full" (none), not "snapshot"']);
    expect(onFailures({ ...good, rejoin: null })).toEqual(['the browser reported no rejoin']);
  });
  it('counts stored + held + recorded and refuses any mismatch, on either seat and the browser', () => {
    expect(onFailures({ ...good, seat0: prod({ stored: 0, held: 0, recorded: 0 }) })).toEqual(['seat 0 has no accepted snapshot (stored + held + recorded is 0)']);
    expect(onFailures({ ...good, seat1AtDrop: prod({ mismatch: 1 }) })).toEqual(['seat 1 at the drop mismatch 1, not 0']);
    expect(onFailures({ ...good, browserProducer: prod({ mismatch: 2 }) })).toEqual(['the browser\'s producer mismatch 2, not 0']);
    expect(onFailures({ ...good, seat0: null })).toEqual(['seat 0 has no producer counters']);
  });
  it('prints the rejoin, the producers, the settle and the verdict', () => {
    const o: OnReadings = { ...good, restoreMs: 140, dead: { total: 31, explored: 4 }, settle: { pending: 0, taken: 31, wrecks: 20 }, shot: '/x/a.png', failures: [] };
    const text = onLines(o).join('\n');
    expect(text).toContain('rejoin: snapshot from 4800, restore 140 ms');
    expect(text).toContain('seat 0 stored 2 held 3 recorded 0 mismatch 0');
    expect(text).toContain('D4 settle: {"pending":0,"taken":31,"wrecks":20}; dead in the rejoiner\'s sim 31 (explored 4); screenshot /x/a.png');
    expect(text).not.toContain('NOT A SNAPSHOT REJOIN');
    expect(onLines({ ...o, failures: ['x'] }).join('\n')).toContain('NOT A SNAPSHOT REJOIN: x');
  });
});
