import { describe, expect, it, vi } from 'vitest';

// A sim that exports its own transition lengths (#402, retuned): the adapter
// must take them, so a retune needs no re-export of the kneel clips.
vi.mock('@lions/sim', () => ({ KNEEL_DROP_TICKS: 6, KNEEL_RISE_TICKS: 3 }));

describe('stanceOf takes the sim exported transition lengths', () => {
  it('reads KNEEL_DROP_TICKS and KNEEL_RISE_TICKS off @lions/sim when present', async () => {
    const m = await import('./stance');
    expect(m.KNEEL_DROP_TICKS_RT).toBe(6);
    expect(m.KNEEL_RISE_TICKS_RT).toBe(3);
    const sim = (brace: number, ticks: number) => ({ state: { brace: Uint8Array.of(brace), braceTicks: Int32Array.of(ticks) } });
    const idle = { speed: 0, sinceShotS: Infinity, prevDepth: 0 };
    // 3 of 6 ticks left is halfway down; 1 of 3 left is two thirds up.
    expect(m.stanceOf(sim(m.BRACE_DROPPING, 3), 0, 0, idle).progress).toBeCloseTo(0.5, 9);
    expect(m.stanceOf(sim(m.BRACE_RISING, 1), 0, 0, idle).progress).toBeCloseTo(2 / 3, 9);
  });
});
