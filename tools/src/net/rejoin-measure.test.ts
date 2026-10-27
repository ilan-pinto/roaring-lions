// The pure parts of `pnpm net:rejoin-measure` (snapshot S4 T1C): the argument
// parser, the phase arithmetic and the frozen-gap reader. The tool itself
// opens a Metal browser and never runs in CI. Oracles are literals.
import { describe, expect, it } from 'vitest';
import { frozenOf, parseArgs, phases } from './rejoin-measure';

describe('parseArgs', () => {
  it('defaults to the plan\'s run: 6,000 and 24,000 ticks, mode off, a 50 ms tick, the browser on', () => {
    expect(parseArgs([])).toEqual({ ticks: [6000, 24000], modes: ['off'], tickMs: 50, out: null, browser: true });
    expect(parseArgs(['--'])).toEqual({ ticks: [6000, 24000], modes: ['off'], tickMs: 50, out: null, browser: true });
  });
  it('takes the options, sorts the ticks, and leaves --port to claimPort', () => {
    expect(parseArgs(['--', '--port=5300', '--ticks=24000,600', '--modes=off', '--tick-ms=2', '--out=/x/y.json', '--no-browser']))
      .toEqual({ ticks: [600, 24000], modes: ['off'], tickMs: 2, out: '/x/y.json', browser: false });
  });
  it('refuses a bad --ticks, an unknown mode, a bad --tick-ms and an unknown option', () => {
    expect(parseArgs(['--ticks=abc'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=6000,'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=50'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=30000'])).toHaveProperty('error');
    expect(parseArgs(['--ticks=6000,6000'])).toHaveProperty('error');
    expect(parseArgs(['--modes=on'])).toEqual({ error: expect.stringContaining('unknown mode "on"') });
    expect(parseArgs(['--modes=off,snap'])).toHaveProperty('error');
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
