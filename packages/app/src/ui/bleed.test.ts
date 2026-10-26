import { describe, expect, it } from 'vitest';
import { bleedFullTicks } from '@lions/sim';
import { bleedView, type BleedSim, type BleedType } from './bleed';

// type 0: a squad that sheds wounded (bleed 60 s = 1200 ticks); type 1: its `wounded` body;
// type 2: a civilian that goes down in place (bleed 30 s = 600 ticks).
const TYPES: BleedType[] = [
  { id: 'inf_squad', isWounded: false, wounds: { bleedTicks: 1200, typeId: 'wounded_rifleman' } },
  { id: 'wounded_rifleman', isWounded: true, wounds: null },
  { id: 'civilian', isWounded: false, wounds: { bleedTicks: 600, typeId: 'civilian' } },
];
function sim(o: { type: number; woundState: number; bleedTicks: number; parent: number; rate?: number }): BleedSim {
  // entity 0 is the squad (type 0); entity 1 is the subject.
  return {
    unitTypes: TYPES,
    woundBleedRate: () => o.rate ?? (o.woundState === 1 ? 1 : 0),
    state: {
      typeIdx: [0, o.type],
      woundState: [0, o.woundState],
      bleedTicks: [0, o.bleedTicks],
      woundParent: [-1, o.parent],
    },
  };
}

describe('bleedView (GH-707 P2)', () => {
  it('a fresh wound is a full ring; half the clock is half, in whole seconds rounded up', () => {
    expect(bleedView(sim({ type: 1, woundState: 1, bleedTicks: 1200, parent: 0 }), 1)).toEqual({ fraction: 1, seconds: 60, held: false, stabilised: false });
    const half = bleedView(sim({ type: 1, woundState: 1, bleedTicks: 601, parent: 0 }), 1);
    // The sim's Q16.16 clock, as a float: within one raw step (1/65536) of 601/1200.
    expect(half?.fraction).toBeCloseTo(601 / 1200, 4);
    expect(half?.seconds).toBe(31);
  });

  it('stabilised and carried are held; stabilised says so', () => {
    expect(bleedView(sim({ type: 1, woundState: 2, bleedTicks: 400, parent: 0 }), 1)).toMatchObject({ held: true, stabilised: true });
    expect(bleedView(sim({ type: 1, woundState: 1, bleedTicks: 400, parent: 0, rate: 0 }), 1)).toMatchObject({ held: true, stabilised: false });
  });

  it('a pinned man bleeds twice as fast, so the seconds halve', () => {
    expect(bleedView(sim({ type: 1, woundState: 1, bleedTicks: 1200, parent: 0, rate: 2 }), 1)).toMatchObject({ seconds: 30, held: false });
  });

  it('finds the full clock for a squad-less body from the type that sheds his kind, and for a civilian from his own', () => {
    expect(bleedFullTicks(sim({ type: 1, woundState: 1, bleedTicks: 5, parent: -1 }), 1)).toBe(1200);
    expect(bleedFullTicks(sim({ type: 2, woundState: 1, bleedTicks: 5, parent: -1 }), 1)).toBe(600);
  });

  it('draws nothing for a unit that is not down, or whose type names no clock', () => {
    expect(bleedView(sim({ type: 1, woundState: 0, bleedTicks: 1200, parent: 0 }), 1)).toBeNull();
    expect(bleedView(sim({ type: 1, woundState: 3, bleedTicks: 1200, parent: 0 }), 1)).toBeNull();
    const orphan: BleedSim = { ...sim({ type: 1, woundState: 1, bleedTicks: 5, parent: -1 }), unitTypes: [TYPES[1], TYPES[1]] };
    expect(bleedView(orphan, 1)).toBeNull();
  });
});
