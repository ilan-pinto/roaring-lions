import { describe, expect, it } from 'vitest';
import { setupViewOf, type SetupRules, type SetupSim } from './setup-view';
import { buildMatchWorld, matchTick } from './match-world';
import { validateConfig } from '@lions/net';

const RULES: SetupRules = { line: { a: [0, 40], b: [40, 0] }, kit: [{ piece: 'hesco' }, { piece: 'sandbag_post' }, { piece: 't_wall' }] };
/** A sim stand-in by literal: the bell at 3600, a kit of 12/4/2 for side 0 and 7/1/0 for side 1. */
function fake(over: Partial<{ tick: number; active: boolean; bell: number; ready: [boolean, boolean] }> = {}): SetupSim {
  const left = [[12, 4, 2], [7, 1, 0]];
  const o = { tick: 100, active: true, bell: 3600, ready: [false, false] as [boolean, boolean], ...over };
  return {
    tickCount: o.tick, setupActive: o.active, setupBellTick: o.bell,
    setupKitLeft: (side, kit) => left[side][kit],
    setupReady: (side) => o.ready[side],
  };
}

describe('setupViewOf (GH-976 v2 WP4)', () => {
  it('secondsLeft is ceil((bell - tick) / 20): the last second reads 1, never 0', () => {
    expect(setupViewOf(fake({ tick: 0 }), RULES, 0)?.secondsLeft).toBe(180);
    expect(setupViewOf(fake({ tick: 1 }), RULES, 0)?.secondsLeft).toBe(180);
    expect(setupViewOf(fake({ tick: 20 }), RULES, 0)?.secondsLeft).toBe(179);
    expect(setupViewOf(fake({ tick: 3599 }), RULES, 0)?.secondsLeft).toBe(1);
    expect(setupViewOf(fake({ tick: 3581 }), RULES, 0)?.secondsLeft).toBe(1);
    expect(setupViewOf(fake({ tick: 3580 }), RULES, 0)?.secondsLeft).toBe(1);
    expect(setupViewOf(fake({ tick: 3579 }), RULES, 0)?.secondsLeft).toBe(2);
    // An early bell: Ready by both at 1,100 rings at 1,200.
    expect(setupViewOf(fake({ tick: 1150, bell: 1200 }), RULES, 0)?.secondsLeft).toBe(3);
  });
  it('the kit is what the VIEWER\'s side has left, by piece', () => {
    expect(setupViewOf(fake(), RULES, 0)?.kit).toEqual({ hesco: 12, sandbag_post: 4, t_wall: 2 });
    expect(setupViewOf(fake(), RULES, 1)?.kit).toEqual({ hesco: 7, sandbag_post: 1, t_wall: 0 });
  });
  it('ready reads mine and theirs by viewer', () => {
    const s = fake({ ready: [true, false] });
    expect(setupViewOf(s, RULES, 0)?.ready).toEqual({ mine: true, theirs: false });
    expect(setupViewOf(s, RULES, 1)?.ready).toEqual({ mine: false, theirs: true });
  });
  it('the line is the rules\' line, copied', () => {
    const v = setupViewOf(fake(), RULES, 0);
    expect(v?.line).toEqual({ a: [0, 40], b: [40, 0] });
    expect(v?.line.a).not.toBe(RULES.line.a);
  });
  it('is null once the bell has rung, and in a world with no set-up', () => {
    expect(setupViewOf(fake({ tick: 3600, active: false }), RULES, 0)).toBeNull();
    expect(setupViewOf(fake({ active: false, bell: -1 }), RULES, 1)).toBeNull();
  });
  it('reads a real room: the countdown follows the sim tick, and the view goes null on the bell edge', () => {
    const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 5, map: 'wadi_tarfan', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: 'flag', flagSetup: true });
    if (c === null) throw new Error('bad fixture');
    const w = buildMatchWorld(c);
    if (w.setup === null) throw new Error('no set-up');
    expect(setupViewOf(w.sim, w.setup, 0)).toMatchObject({ secondsLeft: 180, kit: { hesco: 12, sandbag_post: 4, t_wall: 2 }, ready: { mine: false, theirs: false } });
    w.sim.queueCommand({ kind: 'setupReady', side: 1 });
    for (let i = 0; i < 21; i++) matchTick(w);
    expect(setupViewOf(w.sim, w.setup, 0)).toMatchObject({ secondsLeft: 179, ready: { mine: false, theirs: true } });
    expect(setupViewOf(w.sim, w.setup, 1)?.ready).toEqual({ mine: true, theirs: false });
    w.sim.queueCommand({ kind: 'setupReady', side: 0 });
    for (let i = 0; i < 99; i++) matchTick(w);
    expect(w.sim.setupActive).toBe(true);
    expect(setupViewOf(w.sim, w.setup, 0)?.secondsLeft).toBe(1);
    matchTick(w);
    matchTick(w);
    expect(w.sim.setupActive).toBe(false);
    expect(setupViewOf(w.sim, w.setup, 0)).toBeNull();
  });
});
