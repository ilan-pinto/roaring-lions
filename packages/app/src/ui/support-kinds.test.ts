import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIRE_SUPPORT_KINDS } from '@lions/sim';
import en from '../i18n/en.json';
import { symbolBody } from './symbol';
import {
  FS_AIR_STRIKE,
  FS_MORTAR_BARRAGE,
  ROUNDS,
  SMOKE_RADIUS_TILES,
  SUPPORT,
  SUPPORT_KINDS,
  SWEEP_RADIUS_SQ_FX,
  footprintTiles,
  lastRoundTicks,
} from './support-kinds';

const catalogue = en as Readonly<Record<string, string>>;

describe('the support table', () => {
  it('has one row per runtime kind, in the sim order', () => {
    expect(Object.keys(SUPPORT).sort()).toEqual([...FIRE_SUPPORT_KINDS].sort());
    expect([...SUPPORT_KINDS]).toEqual([...FIRE_SUPPORT_KINDS]);
  });

  it('gives every row catalogue keys that exist', () => {
    for (const kind of SUPPORT_KINDS) {
      for (const key of [SUPPORT[kind].word, SUPPORT[kind].name, SUPPORT[kind].blurb]) {
        expect(catalogue[key], key).toBeTypeOf('string');
      }
    }
  });

  it('gives no two tiles one word, and none the unit order\'s word', () => {
    const words = SUPPORT_KINDS.map((k) => catalogue[SUPPORT[k].word]);
    expect(new Set(words).size).toBe(4);
    for (const w of words) {
      expect(w).not.toBe('smoke');
      expect(w.toLowerCase()).not.toBe(catalogue['keymap.smoke'].toLowerCase());
    }
  });
});

describe('the round timings this file copies', () => {
  // Read as TEXT, the `PROJ_SPEED` rule: the app must not import tuning, and a
  // copy nobody pins is a copy that drifts. A regex that misses THROWS, so a
  // renamed field is red rather than vacuous.
  const tuning = readFileSync(fileURLToPath(new URL('../../../sim/src/tuning.ts', import.meta.url)), 'utf8');
  const constant = (name: string): number => {
    const m = tuning.match(new RegExp(`export const ${name} = (\\d+);`));
    if (!m) throw new Error(`${name} not found in tuning.ts`);
    return Number(m[1]);
  };
  const start = tuning.indexOf('export const FIRE_SUPPORT');
  if (start < 0) throw new Error('FIRE_SUPPORT not found in tuning.ts');
  const end = tuning.indexOf('\n];', start);
  if (end < 0) throw new Error('FIRE_SUPPORT has no closing ];');
  const block = tuning.slice(start, end);
  const rows = block.split(/\/\/ (?=air_strike|mortar_barrage|smoke_screen)/).slice(1);
  const rowOf = (name: string): { index: number; text: string } => {
    const index = rows.findIndex((r) => r.startsWith(name));
    if (index < 0) throw new Error(`row ${name} not found in FIRE_SUPPORT`);
    return { index, text: rows[index] };
  };
  const field = (text: string, name: string): number => {
    const m = text.match(new RegExp(`${name}: (\\d+|[A-Z_]+)`));
    if (!m) throw new Error(`${name} not found in a FIRE_SUPPORT row`);
    return Number.isNaN(Number(m[1])) ? constant(m[1]) : Number(m[1]);
  };

  it('reads three rows in the order the profile indices say', () => {
    expect(rows).toHaveLength(3);
    expect(rowOf('air_strike').index).toBe(constant('FS_AIR_STRIKE'));
    expect(rowOf('mortar_barrage').index).toBe(constant('FS_MORTAR_BARRAGE'));
    expect(rowOf('smoke_screen').index).toBe(constant('FS_SMOKE_SCREEN'));
  });

  it('matches tuning.ts', () => {
    expect(FS_AIR_STRIKE).toBe(constant('FS_AIR_STRIKE'));
    expect(FS_MORTAR_BARRAGE).toBe(constant('FS_MORTAR_BARRAGE'));
    expect(SWEEP_RADIUS_SQ_FX).toBe(constant('SWEEP_RADIUS_SQ'));
    expect(SMOKE_RADIUS_TILES).toBe(constant('SMOKE_RADIUS'));
    for (const kind of ['air_strike', 'mortar_barrage', 'smoke_screen'] as const) {
      const { text } = rowOf(kind);
      expect(ROUNDS[kind], kind).toEqual({
        rounds: field(text, 'rounds'),
        spacingTicks: field(text, 'spacingTicks'),
        delayTicks: field(text, 'delayTicks'),
        scatterFx: field(text, 'scatter'),
        splashFx: field(text, 'splash'),
      });
    }
  });

  it('keeps the air strike on the named constants it has always used', () => {
    expect(ROUNDS.air_strike.delayTicks).toBe(constant('STRIKE_DELAY_TICKS'));
    expect(ROUNDS.air_strike.scatterFx).toBe(constant('STRIKE_SCATTER'));
    expect(ROUNDS.air_strike.splashFx).toBe(constant('STRIKE_SPLASH'));
  });
});

describe('footprints', () => {
  it('reads the ring under each armed cursor', () => {
    expect(footprintTiles('air_strike')).toBe(2);
    expect(footprintTiles('mortar_barrage')).toBe(2.5);
    expect(footprintTiles('smoke_screen')).toBe(4.5);
    expect(footprintTiles('drone_sweep')).toBeNull();
  });

  it('counts ticks to the last round', () => {
    expect(lastRoundTicks('air_strike')).toBe(60);
    expect(lastRoundTicks('mortar_barrage')).toBe(120 + 5 * 36);
    expect(lastRoundTicks('smoke_screen')).toBe(80 + 2 * 40);
  });
});

// S-F Task 2: the four tiles draw four marks. The barrage and the smoke
// screen borrowed the strike's and the smoke order's until the support-marks
// mock (barrage B "Bursts", smoke screen A "Rounds to screen").
describe('the tile marks', () => {
  it('points each call at its own mark, which is also its cursor\'s id', () => {
    expect(Object.fromEntries(SUPPORT_KINDS.map((k) => [k, SUPPORT[k].mark]))).toEqual({
      smoke_screen: 'smokeScreen',
      mortar_barrage: 'barrage',
      drone_sweep: 'sweep',
      air_strike: 'strike',
    });
    for (const k of SUPPORT_KINDS) expect(SUPPORT[k].mark, k).toBe(SUPPORT[k].cursor);
  });

  it('gives no two tiles one glyph, and none the unit smoke order\'s', () => {
    const marks = SUPPORT_KINDS.map((k) => SUPPORT[k].mark);
    expect(new Set(marks).size).toBe(4);
    expect(marks).not.toContain('smoke');
    // Four drawings, not four names for fewer: each id's static mark differs.
    expect(new Set(marks.map((m) => symbolBody(m))).size).toBe(4);
  });
});
