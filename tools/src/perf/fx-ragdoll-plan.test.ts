import { describe, expect, it } from 'vitest';
import {
  RAGDOLL_GATE_MS,
  CONTROL_BOUND_MS,
  EXPECTED_LIVE_CAP,
  medianOf,
  abSchedule,
  abVerdict,
  armPlan,
  isPresetLiveModule,
  liveFrames,
  parseRagdollArgs,
  presentationMs,
  ragdollBurstPlan,
  rewritePresetLive,
  setPresetSwitches,
  stats,
  sweepRowName,
  windowStats,
  type ArmRows,
} from './fx-ragdoll-plan';

const sum = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);

describe('ragdollBurstPlan', () => {
  it('fills the high cap exactly with two-figure teams, plus one refused victim killed last', () => {
    const p = ragdollBurstPlan(16);
    expect(p.victims).toBe(9);
    expect(sum(p.perTick)).toBe(9);
    expect(p.perTick).toEqual([2, 2, 2, 3]);
    expect(p.offeredFigures).toBe(18);
    expect(p.expectedPeakFigures).toBe(16);
  });
  it('fills the medium cap exactly', () => {
    const p = ragdollBurstPlan(8);
    expect(p.perTick).toEqual([1, 1, 1, 2]);
    expect(p.expectedPeakFigures).toBe(8);
    expect(p.offeredFigures).toBe(10);
  });
  it('bursts a zero cap like high, expecting nothing held', () => {
    const p = ragdollBurstPlan(0);
    expect(p.perTick).toEqual([2, 2, 2, 3]);
    expect(p.expectedPeakFigures).toBe(0);
  });
  it('the cap ladder step 4 still fits', () => {
    expect(ragdollBurstPlan(4).perTick).toEqual([0, 1, 1, 1]);
  });
  it('refuses a cap two-figure teams cannot fill, and a bad cap', () => {
    expect(() => ragdollBurstPlan(7)).toThrow(/two-figure/);
    expect(() => ragdollBurstPlan(-2)).toThrow(/non-negative/);
  });
  it('the oracle caps are the ruling, as literals', () => {
    expect(EXPECTED_LIVE_CAP).toEqual({ high: 16, medium: 8, low: 0 });
    expect(RAGDOLL_GATE_MS).toEqual({ median: 1.0, p95: 2.0 });
  });
});

describe('armPlan', () => {
  it('kills the same burst in both arms of a preset, holding the cap ON and nothing OFF', () => {
    for (const cap of [16, 8, 0]) {
      expect(armPlan(cap, 'off').burst).toEqual(armPlan(cap, 'on').burst);
      expect(armPlan(cap, 'off').expectedPeakFigures).toBe(0);
      expect(armPlan(cap, 'on').expectedPeakFigures).toBe(cap);
    }
    expect(armPlan(8, 'off').burst.perTick).toEqual([1, 1, 1, 2]);
  });
});

describe('liveFrames and the presentation clock', () => {
  it('ticks once every three frames and walks alpha 1/3, 2/3, 1', () => {
    const f = liveFrames(2);
    expect(f.map((x) => x.tick)).toEqual([true, false, false, true, false, false]);
    expect(f.map((x) => x.alpha)).toEqual([1 / 3, 2 / 3, 1, 1 / 3, 2 / 3, 1]);
  });
  it('is presentationSimMs: (tickCount - 1 + alpha) * 50, clamped at 0', () => {
    expect(presentationMs(11, 1)).toBe(550);
    expect(presentationMs(11, 0.5)).toBe(525);
    expect(presentationMs(0, 0.5)).toBe(0);
  });
  it('the clock advances 50 ms a tick across the frames, never standing still', () => {
    let tick = 10;
    const ms: number[] = [];
    for (const fr of liveFrames(3)) {
      if (fr.tick) tick++;
      ms.push(presentationMs(tick, fr.alpha));
    }
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1] as number);
    expect((ms[ms.length - 1] as number) - (ms[0] as number)).toBeCloseTo(50 * 3 - 50 / 3, 6);
  });
});

describe('stats and windows', () => {
  it('uses sorted[floor(p n)]', () => {
    const s = stats([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]);
    expect(s).toEqual({ n: 10, med: 6, p95: 10, max: 10 });
  });
  it('splits the samples by window and refuses an empty one', () => {
    const samples = [
      { t: -150, ms: 1 },
      { t: 300, ms: 2 },
      { t: 1200, ms: 3 },
      { t: 4100, ms: 4 },
    ];
    const w = windowStats(samples);
    expect(w['burst all']?.n).toBe(4);
    expect(w['burst @250ms']?.med).toBe(2);
    expect(w['burst @1s']?.med).toBe(3);
    expect(w['burst @4s']?.med).toBe(4);
    expect(() => windowStats(samples.slice(0, 3))).toThrow(/burst @4s/);
  });
  it('a window is [from, to): a frame on a boundary belongs to the later window', () => {
    const w = windowStats([
      { t: 250, ms: 1 },
      { t: 1000, ms: 2 },
      { t: 4000, ms: 3 },
      { t: 4500, ms: 99 },
    ]);
    expect(w['burst @250ms']).toEqual({ n: 1, med: 1, p95: 1, max: 1 });
    expect(w['burst @1s']).toEqual({ n: 1, med: 2, p95: 2, max: 2 });
    expect(w['burst @4s']).toEqual({ n: 1, med: 3, p95: 3, max: 3 });
    expect(w['burst all']?.n).toBe(3);
  });
});

describe('abSchedule', () => {
  it('is ABBA blocks with one of each arm a round', () => {
    expect(abSchedule(3)).toEqual(['off', 'on', 'on', 'off', 'off', 'on']);
    expect(() => abSchedule(0)).toThrow();
  });
});

describe('abVerdict', () => {
  const row = (med: number, p95: number) => ({ n: 90, med, p95, max: p95 });
  const boot = (quiet: number, burst: number, burstP95: number): ArmRows => ({ 'quiet live': row(quiet, quiet + 1), 'burst all': row(burst, burstP95) });
  it('passes a delta inside the bar and reports the off spread', () => {
    const v = abVerdict([boot(10, 10, 12), boot(10.4, 10.2, 12), boot(10, 10.1, 12)], [boot(10, 10.9, 13.9), boot(10, 11, 14), boot(10, 10.8, 13)]);
    const b = v.rows.find((r) => r.row === 'burst all');
    expect(b?.dMed).toBeCloseTo(0.8, 6);
    expect(b?.dP95).toBeCloseTo(1.9, 6);
    expect(b?.gated).toBe(true);
    expect(v.rows.find((r) => r.row === 'quiet live')?.offSpread).toBeCloseTo(0.4, 6);
    expect(v.pass).toBe(true);
  });
  it('is inconclusive when a control row moves more than the bound, whatever the burst rows say', () => {
    const v = abVerdict([boot(10, 10, 12)], [boot(10.31, 10, 12)]);
    expect(v.pass).toBe(true);
    expect(v.outcome).toBe('inconclusive');
    expect(abVerdict([boot(10, 10, 12)], [boot(9.69, 10, 12)]).outcome).toBe('inconclusive');
    expect(abVerdict([boot(10, 10, 12)], [boot(10.25, 10, 12)]).outcome).toBe('pass');
    expect(abVerdict([boot(10, 10, 12)], [boot(10.25, 11.5, 12)]).outcome).toBe('fail');
    expect(CONTROL_BOUND_MS).toBe(0.3);
  });
  it('prints the per-round paired deltas', () => {
    const v = abVerdict([boot(10, 10, 12), boot(10, 11, 12)], [boot(10, 10.5, 12), boot(10, 11.2, 12)]);
    const b = v.rows.find((r) => r.row === 'burst all');
    expect(b?.perRound[0]).toBeCloseTo(0.5, 6);
    expect(b?.perRound[1]).toBeCloseTo(0.2, 6);
  });
  it('takes the midpoint for an even count of rounds', () => {
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
    expect(medianOf([3, 1, 2])).toBe(2);
  });
  it('fails a median over the bar', () => {
    const v = abVerdict([boot(10, 10, 12)], [boot(10, 11.01, 12)]);
    expect(v.pass).toBe(false);
  });
  it('fails a p95 over the bar with the median inside it', () => {
    const v = abVerdict([boot(10, 10, 12)], [boot(10, 10.5, 14.01)]);
    expect(v.pass).toBe(false);
  });
  it('never gates a control row, however large', () => {
    const v = abVerdict([boot(10, 10, 12)], [boot(30, 10, 12)]);
    expect(v.rows.find((r) => r.row === 'quiet live')?.gated).toBe(false);
    expect(v.pass).toBe(true);
  });
  it('refuses a boot missing a row', () => {
    expect(() => abVerdict([boot(10, 10, 12)], [{ 'quiet live': row(10, 11) }])).toThrow(/missing/);
  });
});

describe('rewritePresetLive', () => {
  const ts = 'export const RAGDOLL_PRESETS_LIVE: boolean = false;\nexport const SOFT_PARTICLES_PRESET_LIVE: boolean = false;\n';
  const js = 'export const RAGDOLL_PRESETS_LIVE = false;\nexport const SOFT_PARTICLES_PRESET_LIVE = false;\n';
  it('turns on only the named switch, typed or transformed', () => {
    expect(rewritePresetLive(ts, ['ragdolls'])).toBe('export const RAGDOLL_PRESETS_LIVE: boolean = true;\nexport const SOFT_PARTICLES_PRESET_LIVE: boolean = false;\n');
    expect(rewritePresetLive(js, ['ragdolls'])).toBe('export const RAGDOLL_PRESETS_LIVE = true;\nexport const SOFT_PARTICLES_PRESET_LIVE = false;\n');
    expect(rewritePresetLive(js, ['softParticles'])).toContain('SOFT_PARTICLES_PRESET_LIVE = true');
  });
  it('refuses a switch that is missing, already on, or doubled', () => {
    expect(() => rewritePresetLive('export const X = false;', ['ragdolls'])).toThrow(/found 0/);
    expect(() => rewritePresetLive(js.replace('LIVE = false', 'LIVE = true'), ['ragdolls'])).toThrow(/found 0/);
    expect(() => rewritePresetLive(js + js, ['ragdolls'])).toThrow(/found 2/);
  });
  it('does not take a longer name for the switch', () => {
    expect(() => rewritePresetLive('export const RAGDOLL_PRESETS_LIVE_X = false;', ['ragdolls'])).toThrow(/found 0/);
    expect(() => rewritePresetLive('export const RAGDOLL_PRESETS_LIVE = falsey;', ['ragdolls'])).toThrow(/found 0/);
  });
  it('setPresetSwitches sets a switch to either value from either value, and only the named one', () => {
    const on = 'export const RAGDOLL_PRESETS_LIVE = false;\nexport const SOFT_PARTICLES_PRESET_LIVE = true;\n';
    expect(setPresetSwitches(on, { softParticles: false })).toBe('export const RAGDOLL_PRESETS_LIVE = false;\nexport const SOFT_PARTICLES_PRESET_LIVE = false;\n');
    expect(setPresetSwitches(on, { softParticles: true })).toBe(on);
    expect(setPresetSwitches(ts, { ragdolls: true })).toContain('RAGDOLL_PRESETS_LIVE: boolean = true');
    expect(setPresetSwitches(ts, {})).toBe(ts);
    expect(() => setPresetSwitches('export const X = true;', { softParticles: false })).toThrow(/found 0/);
    expect(() => setPresetSwitches(on + on, { softParticles: false })).toThrow(/found 2/);
  });
  it('matches the served module path only', () => {
    expect(isPresetLiveModule('/@fs/Users/x/packages/render/src/three/preset-live.ts')).toBe(true);
    expect(isPresetLiveModule('/packages/render/src/three/preset-live.test.ts')).toBe(false);
    expect(isPresetLiveModule('/packages/render/src/three/other/preset-live.ts')).toBe(false);
  });
});

describe('the idle sweep', () => {
  it('parses whole seconds, increasing, to 120 s at most, and only with the A/B', () => {
    expect(parseRagdollArgs(['--ragdoll-ab', '--idle-sweep=0,5,10,20,40']).sweepMs).toEqual([0, 5000, 10000, 20000, 40000]);
    expect(() => parseRagdollArgs(['--idle-sweep=0,5'])).toThrow(/ragdoll-ab/);
    expect(() => parseRagdollArgs(['--ragdoll-ab', '--idle-sweep=5,5'])).toThrow(/increase/);
    expect(() => parseRagdollArgs(['--ragdoll-ab', '--idle-sweep=0,121'])).toThrow(/120/);
    expect(() => parseRagdollArgs(['--ragdoll-ab', '--idle-sweep=1.5'])).toThrow(/whole/);
  });
  it('a sweep row is informational: an open early point does not make the verdict inconclusive, the post-sweep quiet does', () => {
    const row = (med: number) => ({ n: 90, med, p95: med + 1, max: med + 1 });
    const boot = (idle0: number, quiet: number): ArmRows => ({ [sweepRowName(0)]: row(idle0), 'quiet live': row(quiet), 'burst all': row(10) });
    const v = abVerdict([boot(10, 10)], [boot(11, 10.1)]);
    expect(v.rows.find((r) => r.row === 'idle @0s')?.informational).toBe(true);
    expect(v.outcome).toBe('pass');
    expect(abVerdict([boot(10, 10)], [boot(11, 10.4)]).outcome).toBe('inconclusive');
    expect(sweepRowName(20000)).toBe('idle @20s');
  });
});

describe('parseRagdollArgs', () => {
  it('defaults to three rounds and refuses a rounds flag without the mode', () => {
    expect(parseRagdollArgs([])).toEqual({ ab: false, rounds: 3, sweepMs: [] });
    expect(parseRagdollArgs(['--ragdoll-ab', '--ab-rounds=4'])).toEqual({ ab: true, rounds: 4, sweepMs: [] });
    expect(() => parseRagdollArgs(['--ab-rounds=4'])).toThrow();
    expect(() => parseRagdollArgs(['--ragdoll-ab', '--ab-rounds=x'])).toThrow();
  });
});
