import { describe, expect, it } from 'vitest';
import { BRACE_DROPPING, BRACE_KNEELING, BRACE_NONE, BRACE_RISING, simHasBrace, stanceOf } from './stance';

const idle = { speed: 0, sinceShotS: Infinity, prevDepth: 0 };

describe('stanceOf reads the sim brace when the sim has one (#402)', () => {
  const sim = (brace: number, ticks: number) => ({
    state: { brace: Uint8Array.of(brace), braceTicks: Int32Array.of(ticks) },
  });
  it('detects the arrays by type, not by name alone', () => {
    expect(simHasBrace(sim(0, 0))).toBe(true);
    expect(simHasBrace({ state: { brace: [0], braceTicks: [0] } })).toBe(false);
    expect(simHasBrace({ state: {} })).toBe(false);
  });
  it('maps every brace value, and drives a drop by the ticks LEFT', () => {
    expect(stanceOf(sim(BRACE_NONE, 0), 0, 0, idle)).toEqual({ stance: 'none', progress: 0, fromSim: true });
    expect(stanceOf(sim(BRACE_KNEELING, 0), 0, 0, idle).stance).toBe('kneeling');
    // 6 ticks a transition: 3 left at alpha 0 is halfway down.
    expect(stanceOf(sim(BRACE_DROPPING, 3), 0, 0, idle)).toEqual({ stance: 'dropping', progress: 0.5, fromSim: true });
    // An interrupted rise with 2 ticks left, a third of a tick into the frame.
    const r = stanceOf(sim(BRACE_RISING, 2), 0, 1 / 3, idle);
    expect(r.stance).toBe('rising');
    expect(r.progress).toBeCloseTo(1 - (2 - 1 / 3) / 6, 9);
  });
  it('ignores the fallback inputs entirely when the sim speaks', () => {
    const moving = { speed: 0.9, sinceShotS: 0, prevDepth: 1 };
    expect(stanceOf(sim(BRACE_NONE, 0), 0, 0, moving).stance).toBe('none');
  });
});

describe('without the sim field, the fallback: stationary and firing kneels', () => {
  const noBrace = { state: {} };
  it('kneels a halted unit that fired recently, and stands a moving one', () => {
    expect(stanceOf(noBrace, 0, 0, { speed: 0, sinceShotS: 0.5, prevDepth: 0 }).stance).toBe('dropping');
    expect(stanceOf(noBrace, 0, 0, { speed: 0, sinceShotS: 0.5, prevDepth: 1 }).stance).toBe('kneeling');
    expect(stanceOf(noBrace, 0, 0, { speed: 0.9, sinceShotS: 0.5, prevDepth: 1 }).stance).toBe('rising');
    expect(stanceOf(noBrace, 0, 0, { speed: 0, sinceShotS: 60, prevDepth: 0 }).stance).toBe('none');
    expect(stanceOf(noBrace, 0, 0, idle).fromSim).toBe(false);
  });
});
