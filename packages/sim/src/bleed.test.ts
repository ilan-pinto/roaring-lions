import { describe, expect, it } from 'vitest';
import { ONE } from './fixed';
import { bleedClock, bleedFullTicks, bleedSecondsLeft, type BleedClockSource } from './bleed';
import { WOUND_DOWN, WOUND_NONE, WOUND_STABILISED } from './tuning';

// GH-707: the one reading of a bleed clock. Literals only (the oracle takes no argument from the
// code under test): 1200 ticks is 60 s at 20 Hz, 400 is 20 s, 600 is 30 s.
const WOUND_ADMITTED = 3;
const WOUND_GONE = 4;

const types = [
  { id: 'inf_squad', wounds: { bleedTicks: 1200, typeId: 'wounded_kdf' } },
  { id: 'wounded_kdf', wounds: null },
  { id: 'civilians', wounds: { bleedTicks: 400, typeId: 'civilians' } },
  { id: 'at_team', wounds: { bleedTicks: 600, typeId: 'wounded_kdf' } },
];
/** 0 a squad; 1 a man down from it; 2 a stabilised man whose squad is gone (parent -1); 3 an in-place
 *  civilian; 4 a man shed by an AT team (entity 5, clock 600 where the first shedder's is 1200); 5 the
 *  AT team; 6 and 7 men already admitted and gone. */
const world = (over: Partial<BleedClockSource['state']> = {}): BleedClockSource => ({
  unitTypes: types,
  state: {
    typeIdx: [0, 1, 1, 2, 1, 3, 1, 1],
    woundState: [WOUND_NONE, WOUND_DOWN, WOUND_STABILISED, WOUND_DOWN, WOUND_DOWN, WOUND_NONE, WOUND_ADMITTED, WOUND_GONE],
    bleedTicks: [0, 300, 900, 100, 150, 0, 50, 50],
    woundParent: [-1, 0, -1, -1, 5, -1, -1, -1],
    ...over,
  },
});

describe('bleedClock (GH-707)', () => {
  // The Q16.16 fraction is left / full, rounded down: 300/1200 = 0.25 = 16384 raw. Every row's
  // seconds are worked by hand at rate 1 (a down man), rate 2 (pinned) and rate 0 (held, read as 1).
  const rows: Array<{ shape: string; id: number; left: number; full: number; fraction: number; stabilised: boolean; s1: number; s2: number }> = [
    { shape: 'a man down from a standing squad (parent type)', id: 1, left: 300, full: 1200, fraction: ONE / 4, stabilised: false, s1: 15, s2: 8 },
    { shape: 'a stabilised last man (type that sheds his kind)', id: 2, left: 900, full: 1200, fraction: (ONE / 4) * 3, stabilised: true, s1: 45, s2: 23 },
    { shape: 'an in-place civilian (his own type)', id: 3, left: 100, full: 400, fraction: ONE / 4, stabilised: false, s1: 5, s2: 3 },
    { shape: 'a man shed by an AT team (the type that shed him, not the first that sheds his kind)', id: 4, left: 150, full: 600, fraction: ONE / 4, stabilised: false, s1: 8, s2: 4 },
  ];
  for (const r of rows) {
    it(`${r.shape}: ring fraction and card seconds come from the same ticks`, () => {
      const c = bleedClock(world(), r.id);
      expect(c).toEqual({ stabilised: r.stabilised, leftTicks: r.left, fullTicks: r.full, fraction: r.fraction });
      if (c === null) return;
      expect(bleedSecondsLeft(c.leftTicks, 1)).toBe(r.s1);
      expect(bleedSecondsLeft(c.leftTicks, 2)).toBe(r.s2);
      expect(bleedSecondsLeft(c.leftTicks, 0)).toBe(r.s1);
      // Agreement: the fraction scaled back by the full is the ticks the seconds were made from
      // (exact here: every row's fraction is a whole quarter or three).
      expect((c.fraction * c.fullTicks) / ONE).toBe(c.leftTicks);
    });
  }

  it('is null for anyone not down or stabilised, admitted and gone included', () => {
    for (const id of [0, 5, 6, 7]) expect(bleedClock(world(), id)).toBeNull();
  });

  it('clamps a clock above the full and one below zero', () => {
    expect(bleedClock(world({ bleedTicks: [0, 5000, 0, 0] }), 1)).toMatchObject({ leftTicks: 1200, fraction: ONE });
    expect(bleedClock(world({ bleedTicks: [0, -7, 0, 0] }), 1)).toMatchObject({ leftTicks: 0, fraction: 0 });
  });

  it('truncates the fraction: 601 of 1200 is 32822 raw (32822.61 rounded down, so rounding would say 32823)', () => {
    expect(bleedClock(world({ bleedTicks: [0, 601, 0, 0] }), 1)?.fraction).toBe(32822);
  });

  it('knows no clock when no type says how long: full 0, a full fraction, ticks kept', () => {
    const none = { ...world(), unitTypes: types.map((t) => ({ id: t.id, wounds: null })) };
    expect(bleedFullTicks(none, 1)).toBe(0);
    expect(bleedClock(none, 1)).toEqual({ stabilised: false, leftTicks: 300, fullTicks: 0, fraction: ONE });
  });
});

describe('bleedSecondsLeft (GH-707)', () => {
  it('rounds up to a whole second at the current rate', () => {
    expect(bleedSecondsLeft(1200, 1)).toBe(60);
    expect(bleedSecondsLeft(1181, 1)).toBe(60);
    expect(bleedSecondsLeft(1180, 1)).toBe(59);
    expect(bleedSecondsLeft(1200, 2)).toBe(30);
    expect(bleedSecondsLeft(1, 1)).toBe(1);
    expect(bleedSecondsLeft(0, 1)).toBe(0);
  });
});
