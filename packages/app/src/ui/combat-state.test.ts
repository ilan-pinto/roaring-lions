import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import {
  aimPenaltyPct,
  breakSeconds,
  combatBand,
  hpWord,
  PIN_AT_Q,
  recoverySeconds,
  ROUT_AFTER_TICKS,
  SUPP_DECAY_Q,
  SUPP_K_Q,
  suppressionMeter,
  UNPIN_AT_Q,
  vehicleDamage,
} from './combat-state';

const TUNING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/src/tuning.ts');

describe('the sim constants are the sim’s own, read from tuning.ts as text', () => {
  const src = readFileSync(TUNING, 'utf8');
  const read = (name: string): number => {
    const m = new RegExp(`export const ${name} = (\\d+);`).exec(src);
    if (m === null) throw new Error(`${name} not found in tuning.ts -- re-point the pin, never delete it`);
    return Number(m[1]);
  };
  it.each([
    ['PIN_AT', PIN_AT_Q],
    ['UNPIN_AT', UNPIN_AT_Q],
    ['SUPP_DECAY', SUPP_DECAY_Q],
    ['SUPP_K', SUPP_K_Q],
    ['ROUT_AFTER_TICKS', ROUT_AFTER_TICKS],
  ])('%s', (name, copy) => expect(copy).toBe(read(name)));
});

describe('combatBand (D1)', () => {
  it('reads the bands at their edges', () => {
    expect(combatBand(0, false, false)).toBe('steady');
    expect(combatBand(0.149, false, false)).toBe('steady');
    expect(combatBand(0.15, false, false)).toBe('shaken');
    expect(combatBand(0.449, false, false)).toBe('shaken');
    expect(combatBand(UNPIN_AT_Q / 65536, false, false)).toBe('suppressed');
    expect(combatBand(0.69, false, false)).toBe('suppressed');
  });
  it('takes pinned and broken from the sim’s own flags, broken first', () => {
    expect(combatBand(0.1, true, false)).toBe('pinned');
    expect(combatBand(1.7, true, true)).toBe('broken');
    expect(combatBand(0.2, false, true)).toBe('broken');
  });
  it('lets the sim’s hysteresis drop an unpinned unit straight to shaken', () => {
    // Unpinned below 0.45 (the sim's own rule): never "suppressed" on the way down.
    expect(combatBand(0.44, false, false)).toBe('shaken');
  });
});

describe('aimPenaltyPct (D1)', () => {
  it('is the sim’s 1 / (1 + 1.5 S)', () => {
    expect(aimPenaltyPct(0)).toBe(0);
    expect(aimPenaltyPct(0.32)).toBe(32);
    expect(aimPenaltyPct(0.62)).toBe(48);
    expect(aimPenaltyPct(0.7)).toBe(51);
  });
});

describe('recoverySeconds (D3) against the sim’s own fixed-point decay', () => {
  /** The sim's loop, tick by tick: decay, then the unpin test. */
  function simTicks(s: number): number {
    let q = Math.round(s * 65536);
    let n = 0;
    while (q >= UNPIN_AT_Q) {
      q = fx.mul(q, SUPP_DECAY_Q);
      n++;
    }
    return n;
  }
  it('never promises a unit up before the sim lets it up, and is never a second late', () => {
    for (let s = 0.45; s <= 2.0; s += 0.01) {
      const promised = recoverySeconds(s);
      const actual = simTicks(s) / 20;
      expect(promised, `S ${s.toFixed(2)}`).toBeGreaterThanOrEqual(actual);
      expect(promised - actual, `S ${s.toFixed(2)}`).toBeLessThan(1.0001);
    }
  });
  it('reads the mock’s two numbers', () => {
    expect(recoverySeconds(1.06)).toBe(6);
    expect(recoverySeconds(1.7)).toBe(9);
    expect(recoverySeconds(0.3)).toBe(0);
  });
});

describe('breakSeconds (D3)', () => {
  it('counts down the sim’s 10 s for a soft, mobile unit', () => {
    expect(breakSeconds(0, true, false)).toBe(10);
    expect(breakSeconds(80, true, false)).toBe(6);
    expect(breakSeconds(199, true, false)).toBe(1);
  });
  it('is null where the sim never breaks a unit', () => {
    expect(breakSeconds(80, false, false)).toBeNull();
    expect(breakSeconds(80, true, true)).toBeNull();
    expect(breakSeconds(200, true, false)).toBeNull();
  });
});

describe('suppressionMeter (D2)', () => {
  it('fills shaken, then suppressed, then lights the pin', () => {
    expect(suppressionMeter(0.15, false, false)).toEqual({ shaken: 0, suppressed: 0, pin: false });
    expect(suppressionMeter(0.45, false, false).shaken).toBeCloseTo(1, 3);
    expect(suppressionMeter(0.45, false, false).suppressed).toBeCloseTo(0, 3);
    expect(suppressionMeter(0.7, false, false).suppressed).toBeCloseTo(1, 2);
    expect(suppressionMeter(0.3, true, false)).toEqual({ shaken: 1, suppressed: 1, pin: true });
  });
});

describe('hpWord and vehicleDamage (D1)', () => {
  it('words hp only under half', () => {
    expect(hpWord(1)).toBeNull();
    expect(hpWord(0.51)).toBeNull();
    expect(hpWord(0.5)).toBe('damaged');
    expect(hpWord(0.25)).toBe('critical');
  });
  it('gives one headline per vehicle', () => {
    expect(vehicleDamage(false, false)).toBeNull();
    expect(vehicleDamage(true, false)).toBe('immobilised');
    expect(vehicleDamage(false, true)).toBe('gunOut');
    expect(vehicleDamage(true, true)).toBe('outOfAction');
  });
});
