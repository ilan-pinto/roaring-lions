/**
 * The ambience bed per map (polish pass F, A11): every shipped map pinned to
 * its bed, the 5% rule's gap, and the manifest holding exactly the beds the
 * app can ask for.
 */
import { describe, expect, it } from 'vitest';
import { maps, parseMap, type MapJson } from '@lions/data';
import type { AudioManifest } from '@lions/render';
import manifestJson from '../../../data/audio.json';
import { readFileSync } from 'node:fs';
import { AMBIENCE_BEDS, AMBIENCE_ENABLED, ambienceBedFor, ambienceBedToPlay, builtShare, TOWN_BUILT_SHARE, type AmbienceBed } from './ambience';

const parsed = Object.fromEntries(Object.entries(maps).map(([id, json]) => [id, parseMap(json as MapJson)]));

/** What every shipped map plays. A new map lands here as a failing line, so
 *  its bed is a decision someone reads, not a side effect. */
const EXPECTED: Record<keyof typeof maps, AmbienceBed> = {
  beit_sahwan_outskirts: 'open',
  beit_sahwan_2: 'town',
  beit_sahwan_3: 'town',
  beit_sahwan_4: 'town',
  khan_rafid: 'town',
  khan_rafid_2: 'town',
  khan_rafid_3: 'town',
  deir_amun: 'open',
  deir_amun_2: 'open',
  deir_amun_3: 'open',
  marj_perimeter: 'open',
  qarn_hadid: 'ridge',
  qarn_hadid_2: 'ridge',
  qarn_hadid_3: 'ridge',
  tel_marum: 'ridge',
  tel_marum_1: 'ridge',
  tel_marum_2: 'ridge',
  tel_marum_3: 'ridge',
  tile_green: 'open',
  tile_knoll: 'open',
  tile_orchard: 'open',
  tile_road: 'open',
  tile_scrub: 'open',
  tutorial_ground: 'open',
  umm_zeitoun: 'ridge',
  umm_zeitoun_2: 'ridge',
  umm_zeitoun_3: 'ridge',
  umm_zeitoun_4: 'ridge',
  wadi_halam_basin: 'open',
  wadi_halam_2: 'open',
  wadi_halam_3: 'open',
  wadi_halam_4: 'town',
  wadi_halam_5: 'town',
};

describe('the ambience bed a map plays (A11)', () => {
  it('every shipped map plays its pinned bed', () => {
    const got = Object.fromEntries(Object.entries(parsed).map(([id, m]) => [id, ambienceBedFor(m)]));
    expect(got).toEqual(EXPECTED);
  });

  it('every highland map is the ridge, whatever stands on it', () => {
    for (const m of Object.values(parsed)) if (m.terrain === 'highland') expect(ambienceBedFor(m)).toBe('ridge');
    const town = parsed.khan_rafid;
    if (!town) throw new Error('no khan_rafid');
    expect(ambienceBedFor({ ...town, terrain: 'highland' })).toBe('ridge');
  });

  it('5% sits in a real gap: no non-highland map within a point of it', () => {
    const shares = Object.values(parsed)
      .filter((m) => m.terrain !== 'highland')
      .map((m) => builtShare(m));
    for (const s of shares) expect(Math.abs(s - TOWN_BUILT_SHARE)).toBeGreaterThan(0.004);
    expect(Math.max(...shares.filter((s) => s < TOWN_BUILT_SHARE))).toBeCloseTo(0.042, 3); // beit_sahwan_outskirts
    expect(Math.min(...shares.filter((s) => s >= TOWN_BUILT_SHARE))).toBeCloseTo(0.055, 3); // beit_sahwan_4
  });

  it('walls and fences are not a town: only buildings count', () => {
    const base = parsed.tile_road;
    if (!base) throw new Error('no tile_road');
    const tiles = Array.from({ length: Math.ceil(base.width * base.height * 0.2) }, (_, i) => i);
    expect(ambienceBedFor({ ...base, structures: [{ type: 'wall', tiles }] })).toBe('open');
    expect(ambienceBedFor({ ...base, structures: [{ type: 'fence', tiles }] })).toBe('open');
    expect(ambienceBedFor({ ...base, structures: [{ type: 'house', tiles }] })).toBe('town');
  });

  it('the shipped manifest declares exactly the beds the app can ask for', () => {
    const beds = (manifestJson as AudioManifest).ambience?.beds ?? {};
    expect(Object.keys(beds).sort()).toEqual([...AMBIENCE_BEDS].sort());
    for (const bed of AMBIENCE_BEDS) expect(beds[bed]?.file).toMatch(/^ambience\/amb_[a-z]+\.ogg$/);
  });
});

describe('the ambience beds are switched off (lead, 2026-10-09: "whining")', () => {
  it('the switch is off', () => {
    expect(AMBIENCE_ENABLED).toBe(false);
  });

  it('no shipped map is handed a bed to play, whatever ambienceBedFor would pick', () => {
    for (const [id, m] of Object.entries(parsed)) {
      expect(ambienceBedFor(m), id).toBeTruthy(); // the mapping itself is intact
      expect(ambienceBedToPlay(m), id).toBeNull();
    }
  });

  it('a mission boot asks BattleAudio for ambienceBedToPlay, never for a bed directly', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('audio.setAmbience(ambienceBedToPlay(map))');
    expect(main).not.toMatch(/setAmbience\(\s*ambienceBedFor/);
  });
});
