import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SIM_DEMOLITION_SPEED_TILES_S,
  WRECK_SMOULDER_MAGNITUDE,
  WRECK_SMOULDER_SECONDS,
  claimStrikeBolt,
  demolitionResolveTick,
  findPendingCharge,
  isDirectFireShell,
  nearestFootprintPoint,
  strikeHeadingTurns,
  wreckSmoulderMagnitude,
} from './trigger-fx';
import { spawnShell, type ShellModel } from './shells';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TUNING = path.resolve(HERE, '../../../../sim/src/tuning.ts');

function bolt(shooter?: number, target?: number, strike?: ShellModel['strike']): ShellModel {
  const s = spawnShell(0, 0, 5, 0, 0, 'bolt');
  s.shooter = shooter;
  s.target = target;
  s.strike = strike;
  return s;
}

describe('direct-fire strikes ride their bolt (GH-85)', () => {
  it('names exactly the bolt, rifle and MG kinds as direct fire', () => {
    expect(['bolt', 'rifle', 'mg'].every((k) => isDirectFireShell(k as 'bolt'))).toBe(true);
    for (const k of ['mortar', 'rocket', 'missile', null] as const) expect(isDirectFireShell(k)).toBe(false);
  });

  it('claims the first untagged round from that shooter at that target', () => {
    const bolts = [bolt(1, 2, { penetrated: false, magnitude: 0 }), bolt(3, 2), bolt(1, 9), bolt(1, 2), bolt(1, 2)];
    expect(claimStrikeBolt(bolts, 1, 2)).toBe(3);
    expect(claimStrikeBolt(bolts, 3, 2)).toBe(1);
    expect(claimStrikeBolt(bolts, 7, 2)).toBe(-1);
    // An untagged round (a miss, or one aimed at a building) is never claimed.
    expect(claimStrikeBolt([bolt()], 1, 2)).toBe(-1);
  });

  it('reads the heading from launch to impact, in turns', () => {
    expect(strikeHeadingTurns({ sx: 0, sy: 0, tx: 1, ty: 0 })).toBeCloseTo(0);
    expect(strikeHeadingTurns({ sx: 0, sy: 0, tx: 0, ty: 1 })).toBeCloseTo(0.25);
    expect(strikeHeadingTurns({ sx: 0, sy: 0, tx: -1, ty: 0 })).toBeCloseTo(0.5);
    expect(strikeHeadingTurns({ sx: 0, sy: 0, tx: 0, ty: -1 })).toBeCloseTo(0.75);
  });
});

describe('a wreck smoulders, and stops (GH-85)', () => {
  it('starts at full magnitude, tapers to 40%, and is zero outside its window', () => {
    const life = WRECK_SMOULDER_SECONDS * 1000;
    expect(wreckSmoulderMagnitude(0)).toBe(WRECK_SMOULDER_MAGNITUDE);
    expect(wreckSmoulderMagnitude(life / 2)).toBeCloseTo(WRECK_SMOULDER_MAGNITUDE * 0.7);
    expect(wreckSmoulderMagnitude(life - 1)).toBeCloseTo(WRECK_SMOULDER_MAGNITUDE * 0.4, 3);
    expect(wreckSmoulderMagnitude(life)).toBe(0);
    expect(wreckSmoulderMagnitude(-1)).toBe(0);
  });
});

describe('a demolition charge resolves when the sim resolves it (GH-85)', () => {
  it('copies PROJ_SPEED[demolition], read from tuning.ts as text', () => {
    const src = readFileSync(TUNING, 'utf8');
    const block = /export const PROJ_SPEED = new Int32Array\(\[([\s\S]*?)\]\)/.exec(src);
    if (block === null) throw new Error('PROJ_SPEED not found in tuning.ts -- re-point this pin, do not delete it');
    const row = /(\d+),?\s*\/\/\s*demolition/.exec(block[1]);
    if (row === null) throw new Error('no demolition row in PROJ_SPEED');
    expect(SIM_DEMOLITION_SPEED_TILES_S).toBe(Number(row[1]) / 65536);
  });

  it('resolves n - 1 ticks after the fire tick, combat stepping before projectiles', () => {
    // 1.5 tiles at 0.1 tile a tick is 15 whole ticks.
    expect(demolitionResolveTick(100, 1.5)).toBe(114);
    // An exact multiple must not ceil up on the float artefact.
    expect(demolitionResolveTick(100, 0.3)).toBe(102);
    // A point-blank charge resolves on its own fire tick.
    expect(demolitionResolveTick(100, 0)).toBe(100);
  });

  it('finds the thrower\'s earliest charge, at a building when one is named', () => {
    const list = [
      { shooter: 4, structure: -1, target: 7, resolveTick: 10 },
      { shooter: 4, structure: 2, target: -1, resolveTick: 12 },
    ];
    expect(findPendingCharge(list, 4)).toBe(0);
    expect(findPendingCharge(list, 4, 2)).toBe(1);
    expect(findPendingCharge(list, 4, 3)).toBe(-1);
    expect(findPendingCharge(list, 5)).toBe(-1);
  });

  it('goes off on the wall nearest the thrower, not in the middle of the roof', () => {
    // A 3x2 building at tiles x 10-12, y 4-5 spans [10, 13] x [4, 6].
    expect(nearestFootprintPoint(10, 4, 12, 5, 8, 5)).toEqual([10, 5]);
    expect(nearestFootprintPoint(10, 4, 12, 5, 15, 2)).toEqual([13, 4]);
    expect(nearestFootprintPoint(10, 4, 12, 5, 11, 5)).toEqual([11, 5]);
  });
});
