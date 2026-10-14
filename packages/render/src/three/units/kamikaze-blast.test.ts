import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIM_KAMIKAZE_STRIKE_SQ_TILES,
  KAMIKAZE_REACH_TILES,
  isKamikazeDetonation,
  detonationHeadingTurns,
  type DetonationQuery,
} from './kamikaze-blast';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TUNING = path.resolve(HERE, '../../../../sim/src/tuning.ts');

/** A strike as `stepKamikaze` leaves it: a kamikaze, killed by its own
 *  target, one tile from it. Every negative case below changes ONE field. */
const STRIKE: DetonationQuery = { isKamikaze: true, by: 7, curTarget: 7, x: 10, y: 10, tx: 11, ty: 10 };

describe('the strike radius is the sim\'s own', () => {
  it('copies KAMIKAZE_STRIKE_SQ, read from tuning.ts as text', () => {
    const src = readFileSync(TUNING, 'utf8');
    const m = /export const KAMIKAZE_STRIKE_SQ = (\d+);/.exec(src);
    if (m === null) throw new Error('KAMIKAZE_STRIKE_SQ not found in tuning.ts -- the pin must be re-pointed, not deleted');
    expect(SIM_KAMIKAZE_STRIKE_SQ_TILES).toBe(Number(m[1]) / 65536);
  });
});

describe('isKamikazeDetonation', () => {
  it('reads a kamikaze killed by its own target, inside the strike reach, as a detonation', () => {
    expect(isKamikazeDetonation(STRIKE)).toBe(true);
    // The strike's own outer edge (sqrt 1.5 = 1.22 tiles) is inside, with the slack to spare.
    expect(isKamikazeDetonation({ ...STRIKE, tx: 10 + Math.sqrt(1.5), ty: 10 })).toBe(true);
  });

  it('is not a detonation for a unit that is not a kamikaze', () => {
    expect(isKamikazeDetonation({ ...STRIKE, isKamikaze: false })).toBe(false);
  });

  it('is not a detonation when the killer is not its target', () => {
    expect(isKamikazeDetonation({ ...STRIKE, by: 8 })).toBe(false);
  });

  it('is not a detonation for a kill by nobody, even with no target (-1 === -1)', () => {
    expect(isKamikazeDetonation({ ...STRIKE, by: -1, curTarget: -1 })).toBe(false);
  });

  it('is not a detonation when its target shot it down from outside the strike reach', () => {
    // A Lavi's coax knocking a diving drone down six tiles out: by === curTarget,
    // and it must not draw a warhead going off.
    expect(isKamikazeDetonation({ ...STRIKE, tx: 16, ty: 10 })).toBe(false);
    expect(isKamikazeDetonation({ ...STRIKE, tx: 10 + KAMIKAZE_REACH_TILES + 0.01, ty: 10 })).toBe(false);
  });
});

describe('detonationHeadingTurns', () => {
  it('points from the munition onto its target, in turns', () => {
    expect(detonationHeadingTurns(0, 0, 1, 0, 0.9)).toBeCloseTo(0);
    expect(detonationHeadingTurns(0, 0, 0, 1, 0.9)).toBeCloseTo(0.25);
    expect(detonationHeadingTurns(0, 0, -1, 0, 0.9)).toBeCloseTo(0.5);
    expect(detonationHeadingTurns(0, 0, 0, -1, 0.9)).toBeCloseTo(0.75);
  });

  it('falls back to the facing when the munition stands on its target', () => {
    expect(detonationHeadingTurns(3, 3, 3, 3, 0.4)).toBe(0.4);
  });
});
