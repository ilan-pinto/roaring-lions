// N3 Task 1: data/versus/*.json, its schema, and the rules tools/validate_versus_rules.mjs holds
// over it. The plain-node validator carries its own copy of `versusAnchors` and of the matchup
// map list; this file holds both to the shipped code, the way validate_doctrine.test.ts holds the
// menus to VERSUS_SARIM.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, validateConfig, type MatchConfig } from '@lions/net';
import { maps, parseMap } from '@lions/data';
import {
  CAMP_REACH,
  MATCHUP_MAPS,
  VERSUS_SEATS as MJS_SEATS,
  anchorsOf,
  versusRulesFailures,
} from '../validate_versus_rules.mjs';
import { VERSUS_SEATS, versusAnchors } from '../../packages/app/src/net/versus-seats';
import { buildMatchWorld } from '../../packages/app/src/net/match-world';

const ROOT = join(__dirname, '..', '..');

interface Rules {
  id: string;
  map: string;
  ends: Record<'friendly' | 'hostile', { camp: { at: number[]; size: number[] } }>;
  zones?: Record<string, number[]>;
  income_zones: { zone: string; rate_per_min: number }[];
}

const shipped: { file: string; doc: Rules }[] = readdirSync(join(ROOT, 'data', 'versus'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: `data/versus/${f}`, doc: JSON.parse(readFileSync(join(ROOT, 'data', 'versus', f), 'utf8')) as Rules }));
const mapsById = new Map<string, unknown>(Object.entries(maps));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rulesFor = (map: string): { file: string; doc: Rules }[] => [clone(shipped.find((s) => s.doc.map === map) as { file: string; doc: Rules })];
const failures = (r: { file: string; doc: Rules }[]): string[] =>
  versusRulesFailures(r, mapsById).filter((f) => !f.startsWith('data/versus: no rules file'));

describe('the shipped versus rules', () => {
  it('pass the schema and every rule', () => {
    expect(shipped.map((s) => s.file)).toEqual(['data/versus/tel_marum.json', 'data/versus/wadi_tarfan.json']);
    expect(versusRulesFailures(shipped, mapsById)).toEqual([]);
    const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
    const ajv = new (Ajv2020 as unknown as new (o: object) => {
      compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
    })({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/versus_rules.schema.json'), 'utf8')) as object);
    for (const s of shipped) expect(validate(s.doc), JSON.stringify(validate.errors)).toBe(true);
  });
  it('the validator\'s anchors are versusAnchors\' answer for both matchup maps', () => {
    expect(CAMP_REACH).toBe(6);
    expect(MJS_SEATS).toEqual(VERSUS_SEATS);
    for (const id of FACTION_MATCHUP_MAPS) {
      expect(anchorsOf((maps as unknown as Record<string, never>)[id]), id).toEqual(versusAnchors((maps as unknown as Record<string, never>)[id]));
    }
  });
  it('MATCHUP_MAPS is FACTION_MATCHUP_MAPS', () => {
    expect([...MATCHUP_MAPS]).toEqual([...FACTION_MATCHUP_MAPS]);
  });
  it('wadi_tarfan\'s two camps are point-symmetric about the map centre', () => {
    const w = shipped.find((s) => s.doc.map === 'wadi_tarfan')!.doc;
    const [fx, fy] = w.ends.friendly.camp.at;
    expect(w.ends.hostile.camp.at).toEqual([46 - fx, 46 - fy]);
  });
  it('no camp tile is a tile the placed force spawns on, in either spawn order', () => {
    for (const { doc } of shipped) {
      const parsed = parseMap((maps as unknown as Record<string, never>)[doc.map]);
      for (const factions of [['kdf', 'sarim'], ['sarim', 'kdf']] as const) {
        const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
        const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: doc.map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 } as never) as MatchConfig;
        const w = buildMatchWorld(c);
        const occupied = new Set<string>();
        for (const ids of w.bySide) for (const i of ids) occupied.add(`${Math.floor(w.sim.state.posX[i] / 65536)},${Math.floor(w.sim.state.posY[i] / 65536)}`);
        for (const end of ['friendly', 'hostile'] as const) {
          const [ax, ay] = doc.ends[end].camp.at;
          for (const t of [`${ax},${ay}`, `${ax + 1},${ay}`, `${ax},${ay + 1}`, `${ax + 1},${ay + 1}`]) {
            expect(occupied.has(t), `${doc.map} ${end} camp tile ${t} under a unit (${factions.join('/')})`).toBe(false);
          }
        }
      }
      expect(parsed.width).toBe(48);
    }
  });
});

describe('versusRulesFailures, one mutation at a time', () => {
  it('passes both shipped files', () => {
    expect(failures(rulesFor('wadi_tarfan'))).toEqual([]);
    expect(failures(rulesFor('tel_marum'))).toEqual([]);
  });
  it('refuses a camp tile off the map', () => {
    const r = rulesFor('wadi_tarfan');
    r[0].doc.ends.friendly.camp.at = [47, 7];
    expect(failures(r).join('\n')).toContain('is off the 48x48 map');
  });
  it('refuses a camp tile on a blocked tile, a building and a boulder', () => {
    // tel_marum (24,3) is "###" (a building); (4,5) is '^'; (10,12) is 'b'.
    for (const [at, what] of [[[24, 3], 'building'], [[4, 5], 'ridge'], [[10, 12], 'boulder']] as const) {
      const r = rulesFor('tel_marum');
      r[0].doc.ends.hostile.camp.at = [...at];
      const out = failures(r).filter((f) => f.includes('not open ground'));
      expect(out.length, what).toBeGreaterThan(0);
    }
  });
  it('refuses a camp more than 6 tiles (Chebyshev) from its anchor', () => {
    const r = rulesFor('wadi_tarfan');
    r[0].doc.ends.friendly.camp.at = [10, 17]; // anchor (10,10): the nearest tile is 7 away
    const out = failures(r).filter((f) => f.includes('Chebyshev'));
    expect(out).toHaveLength(1);
    r[0].doc.ends.friendly.camp.at = [10, 16]; // 6 away: allowed
    expect(failures(r).filter((f) => f.includes('Chebyshev'))).toEqual([]);
  });
  it('refuses an income zone in neither the map nor the file, and accepts a file zone', () => {
    const r = rulesFor('wadi_tarfan');
    r[0].doc.income_zones.push({ zone: 'nowhere', rate_per_min: 10 });
    expect(failures(r)).toEqual(['data/versus/wadi_tarfan.json: income zone "nowhere" is declared by neither the map nor this file']);
    r[0].doc.zones = { nowhere: [1, 1, 2, 2] };
    expect(failures(r)).toEqual([]);
  });
  it('refuses a file zone whose name clashes with a map zone', () => {
    const r = rulesFor('wadi_tarfan');
    r[0].doc.zones = { centre_ford: [1, 1, 2, 2] };
    expect(failures(r).join('\n')).toContain('clashes with a zone the map');
  });
  it('refuses a map that is not a faction-matchup map, and a matchup map with no file', () => {
    const r = rulesFor('wadi_tarfan');
    r[0].doc.map = 'milh_flats';
    r[0].doc.id = 'milh_flats';
    expect(failures(r).join('\n')).toContain('is not a faction-matchup map');
    expect(versusRulesFailures(rulesFor('tel_marum'), mapsById)).toEqual([
      'data/versus: no rules file for the faction-matchup map "wadi_tarfan"',
    ]);
  });
  it('refuses a rate outside 1..120, a duplicate zone, and overlapping camps', () => {
    for (const rate of [0, 121]) {
      const r = rulesFor('wadi_tarfan');
      r[0].doc.income_zones[0].rate_per_min = rate;
      expect(failures(r).join('\n')).toContain('outside 1..120');
    }
    const d = rulesFor('wadi_tarfan');
    d[0].doc.income_zones.push({ zone: 'centre_ford', rate_per_min: 5 });
    expect(failures(d).join('\n')).toContain('listed twice');
    const o = rulesFor('tel_marum');
    o[0].doc.ends.hostile.camp.at = [...o[0].doc.ends.friendly.camp.at];
    expect(failures(o).join('\n')).toContain('overlap');
  });
});
