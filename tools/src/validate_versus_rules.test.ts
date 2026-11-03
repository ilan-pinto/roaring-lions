// N3 Task 1: data/versus/*.json, its schema, and the rules tools/validate_versus_rules.mjs holds
// over it. The plain-node validator carries its own copy of `versusAnchors` and of the matchup
// map list; this file holds both to the shipped code, the way validate_doctrine.test.ts holds the
// menus to VERSUS_SARIM.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, MAP_CAP_MINUTES, VERSUS_FAIR_MAPS, matchCapMinutes, sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { maps, parseMap, versusCapMinutesOf, versusRules } from '@lions/data';
import {
  CAMP_REACH,
  MAX_CAPACITY,
  MAX_TUNNELS,
  VENT_MIN_DIST,
  MATCHUP_MAPS,
  MIRROR_RULES_MAPS,
  RULES_ONLY_MAPS,
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
  tunnels?: Record<'friendly' | 'hostile', { id: string; points: number[][]; capacity: number }[]>;
  zones?: Record<string, number[]>;
  income_zones: { zone: string; rate_per_min: number }[];
  cap_minutes?: number;
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
    expect(shipped.map((s) => s.file)).toEqual([
      'data/versus/milh_flats_l.json',
      'data/versus/rujm_sawda.json',
      'data/versus/tel_marum.json',
      'data/versus/tel_marum_l.json',
      'data/versus/wadi_tarfan.json',
      'data/versus/wadi_tarfan_l.json',
    ]);
    expect(versusRulesFailures(shipped, mapsById)).toEqual([]);
    const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
    const ajv = new (Ajv2020 as unknown as new (o: object) => {
      compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
    })({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/versus_rules.schema.json'), 'utf8')) as object);
    for (const s of shipped) expect(validate(s.doc), JSON.stringify(validate.errors)).toBe(true);
  });
  it('GH-913 L3: the schema takes a capacity of 256..1024 and refuses the rest; only rujm_sawda, wadi_tarfan_l, milh_flats_l and tel_marum_l declare one (512)', () => {
    const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
    const ajv = new (Ajv2020 as unknown as new (o: object) => {
      compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
    })({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/versus_rules.schema.json'), 'utf8')) as object);
    const doc = (capacity: unknown): unknown => ({ ...rulesFor('wadi_tarfan')[0].doc, capacity });
    for (const ok of [256, 512, 1024]) expect(validate(doc(ok)), String(ok)).toBe(true);
    for (const bad of [255, 1025, 0, 300.5, '512', null]) expect(validate(doc(bad)), String(bad)).toBe(false);
    const declared = Object.fromEntries(shipped.map((s) => [s.doc.map, (s.doc as { capacity?: number }).capacity]));
    expect(declared).toEqual({ milh_flats_l: 512, rujm_sawda: 512, tel_marum: undefined, tel_marum_l: 512, wadi_tarfan: undefined, wadi_tarfan_l: 512 }); // Was no tel_marum_l (GH-920 B3); no wadi_tarfan_l or milh_flats_l (GH-920 B3)
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
  it('MIRROR_RULES_MAPS are rules files for maps offered for the mirror only: fair, never a faction-matchup map', () => {
    // GH-913 L8: rujm_sawda is opened for KDF v KDF and Sarim v Sarim. This is red the moment a map is
    // moved into FACTION_MATCHUP_MAPS without its rules file being reclassified, or dropped from the fair list.
    expect(MIRROR_RULES_MAPS).toEqual(['rujm_sawda', 'milh_flats_l']); // Was ['rujm_sawda']: Milh Flats (large) joined it at GH-920 B7
    for (const id of MIRROR_RULES_MAPS) {
      expect(FACTION_MATCHUP_MAPS, id).not.toContain(id);
      expect(VERSUS_FAIR_MAPS, id).toContain(id);
      expect(shipped.some((s) => s.doc.map === id), id).toBe(true);
    }
  });
  it('RULES_ONLY_MAPS are rules files for maps no room offers: in neither list of @lions/net, and never in MIRROR_RULES_MAPS', () => {
    // GH-920 B7 opened wadi_tarfan_l (it moved into MATCHUP_MAPS, both faction cells inside 60/40 at its seats) and then
    // milh_flats_l (into MIRROR_RULES_MAPS, mirror only), so the list was EMPTY until the last large map, tel_marum_l (GH-920 B3),
    // waited here, unoffered. The next test guards the other direction, that every rules file is classified, so a map offered
    // without being reclassified is still red.
    // Opening a map means moving it into MIRROR_RULES_MAPS (or MATCHUP_MAPS) in the same commit.
    expect(RULES_ONLY_MAPS).toEqual(['tel_marum_l']);
    for (const id of RULES_ONLY_MAPS) {
      expect(FACTION_MATCHUP_MAPS, id).not.toContain(id);
      expect(VERSUS_FAIR_MAPS, id).not.toContain(id);
      expect(MIRROR_RULES_MAPS, id).not.toContain(id);
      expect(shipped.some((s) => s.doc.map === id), id).toBe(true);
    }
    // every rules file is classified exactly once
    for (const { doc } of shipped) {
      const where = [MATCHUP_MAPS, MIRROR_RULES_MAPS, RULES_ONLY_MAPS].filter((l) => l.includes(doc.map));
      expect(where, doc.map).toHaveLength(1);
    }
  });
  it('GH-913 L8: the schema takes a cap_minutes of 25..60 and refuses the rest; only rujm_sawda, wadi_tarfan_l, milh_flats_l and tel_marum_l declare one (35)', () => {
    const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
    const ajv = new (Ajv2020 as unknown as new (o: object) => {
      compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
    })({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/versus_rules.schema.json'), 'utf8')) as object);
    const doc = (cap_minutes: unknown): unknown => ({ ...rulesFor('wadi_tarfan')[0].doc, cap_minutes });
    for (const ok of [25, 35, 60]) expect(validate(doc(ok)), String(ok)).toBe(true);
    for (const bad of [24, 0, -1, 61, 35.5, '35', null]) expect(validate(doc(bad)), String(bad)).toBe(false);
    const declared = Object.fromEntries(shipped.map((s) => [s.doc.map, s.doc.cap_minutes]));
    expect(declared).toEqual({ milh_flats_l: 35, rujm_sawda: 35, tel_marum: undefined, tel_marum_l: 35, wadi_tarfan: undefined, wadi_tarfan_l: 35 }); // Was no tel_marum_l (GH-920 B3), nor wadi_tarfan_l or milh_flats_l
  });
  it('GH-913 L8: @lions/net\'s MAP_CAP_MINUTES twin is every rules file\'s cap_minutes, both ways', () => {
    // The Worker imports @lions/net and not @lions/data, so it reads the twin. A rules file that says 35 while
    // the twin says 25 would let the client and the Worker disagree on the match length and the log cap.
    for (const { doc } of shipped) {
      expect(matchCapMinutes(doc.map), doc.map).toBe(doc.cap_minutes ?? 25);
      expect(versusCapMinutesOf(versusRules[doc.map]), doc.map).toBe(matchCapMinutes(doc.map));
    }
    // ...and the twin names nothing a rules file does not.
    for (const id of Object.keys(MAP_CAP_MINUTES)) expect(shipped.some((s) => s.doc.map === id), id).toBe(true);
    // A map with no rules file (the mirror-only maps with none) is the default.
    for (const id of ['beit_sahwan_outskirts', 'milh_flats']) expect(matchCapMinutes(id), id).toBe(25);
  });
  it('wadi_tarfan\'s two camps are point-symmetric about the map centre', () => {
    const w = shipped.find((s) => s.doc.map === 'wadi_tarfan')!.doc;
    const [fx, fy] = w.ends.friendly.camp.at;
    expect(w.ends.hostile.camp.at).toEqual([46 - fx, 46 - fy]);
  });
  it('no camp tile is a tile the placed force spawns on, in either spawn order', () => {
    for (const { doc } of shipped.filter((s) => FACTION_MATCHUP_MAPS.includes(s.doc.map))) {
      const parsed = parseMap((maps as unknown as Record<string, never>)[doc.map]);
      for (const factions of [['kdf', 'sarim'], ['sarim', 'kdf']] as const) {
        const sides = sidesOfFactions(factions); // the room's own rule (LD1)
        const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
        const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: doc.map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 } as never) as MatchConfig;
        const w = buildMatchWorld(c);
        const occupied = new Set<string>();
        for (const ids of w.bySide) for (const i of ids) occupied.add(`${Math.floor(w.sim.state.posX[i] / 65536)},${Math.floor(w.sim.state.posY[i] / 65536)}`);
        for (const end of ['friendly', 'hostile'] as const) {
          const [ax, ay] = doc.ends[end].camp.at;
          const [cw, ch] = doc.ends[end].camp.size as [number, number]; // the camp's own size (2x2 on every map today)
          for (let dy = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++) {
            const t = `${ax + dx},${ay + dy}`;
            expect(occupied.has(t), `${doc.map} ${end} camp tile ${t} under a unit (${factions.join('/')})`).toBe(false);
          }
        }
      }
      // GH-920 B7: the large Wadi Tarfan is a faction-matchup map at 96 (literals, not read off the map)
      expect(parsed.width).toBe(doc.map === 'wadi_tarfan_l' ? 96 : 48);
    }
  });
});

describe('versusRulesFailures, one mutation at a time', () => {
  it('passes the shipped files', () => {
    expect(failures(rulesFor('wadi_tarfan'))).toEqual([]);
    expect(failures(rulesFor('tel_marum'))).toEqual([]);
    expect(failures(rulesFor('wadi_tarfan_l'))).toEqual([]); // GH-920 B7: a faction-matchup map now, held to the same rules
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
    // Anchor (10,10) since GH-945 (it was (11,11), with the camp at [11, 18] and [11, 17]).
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
    // Was one line (wadi_tarfan): wadi_tarfan_l is a faction-matchup map too from GH-920 B7, so a lone tel_marum file misses both.
    expect(versusRulesFailures(rulesFor('tel_marum'), mapsById)).toEqual([
      'data/versus: no rules file for the faction-matchup map "wadi_tarfan"',
      'data/versus: no rules file for the faction-matchup map "wadi_tarfan_l"',
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

describe('versus tunnel routes: versusRulesFailures, one mutation at a time (GH-681)', () => {
  const route = (r: Rules) => r.tunnels!.hostile[0]; // tel_marum tm_n_west (22,17) -> (13,27)
  it('passes the strawman routes, and the constants are the spec\'s', () => {
    expect(failures(rulesFor('tel_marum'))).toEqual([]);
    expect(failures(rulesFor('wadi_tarfan'))).toEqual([]);
    expect(VENT_MIN_DIST).toBe(18);
    expect(MAX_TUNNELS).toBe(Number(/^const MAX_TUNNELS = (\d+);/m.exec(readFileSync(join(ROOT, 'packages/sim/src/sim.ts'), 'utf8'))?.[1]));
    expect(MAX_CAPACITY).toBe(8);
  });
  it('refuses a point off the map', () => {
    for (const bad of [[48, 22], [14, -1]]) {
      const r = rulesFor('tel_marum');
      route(r[0].doc).points[2] = bad;
      expect(failures(r).join('\n'), String(bad)).toContain('is off the 48x48 map');
    }
  });
  it('refuses a mouth or a vent on a ridge, and a vent on a building', () => {
    // tel_marum (4,5) is '^'; (24,3) is a building.
    for (const [which, at] of [['mouth', [4, 5]], ['vent', [4, 5]], ['vent', [24, 3]]] as const) {
      const r = rulesFor('tel_marum');
      const pts = route(r[0].doc).points;
      pts[which === 'mouth' ? 0 : pts.length - 1] = [...at];
      expect(failures(r).filter((f) => f.includes(`${which} (${at[0]},${at[1]})`) && f.includes('not open ground')), `${which} ${at}`).toHaveLength(1);
    }
  });
  it('refuses a vent under 18 tiles from the opposing anchor, and allows one beyond it', () => {
    const r = rulesFor('tel_marum');
    const pts = route(r[0].doc).points;
    pts[2] = [27, 33]; // 12 tiles north of the friendly anchor (27,45), open ground
    expect(failures(r).filter((f) => f.includes('tiles from the friendly anchor'))).toHaveLength(1);
    pts[2] = [27, 27]; // 18 tiles: the least allowed
    expect(failures(r).filter((f) => f.includes('tiles from the friendly anchor'))).toEqual([]);
    // The measure is to the OPPOSING anchor: a friendly route is judged against the hostile one.
    const f = rulesFor('tel_marum');
    f[0].doc.tunnels!.friendly[0].points[2] = [28, 28]; // 12 from the hostile anchor (28,16)
    expect(failures(f).filter((x) => x.includes('tiles from the hostile anchor'))).toHaveLength(1);
  });
  it('refuses a capacity outside 1..8', () => {
    for (const cap of [0, 9, 2.5]) {
      const r = rulesFor('wadi_tarfan');
      r[0].doc.tunnels!.friendly[0].capacity = cap;
      expect(failures(r).join('\n'), String(cap)).toContain('outside 1..8');
    }
  });
  it('refuses a repeated route id, within an end and across the two', () => {
    const a = rulesFor('wadi_tarfan');
    a[0].doc.tunnels!.friendly[1].id = a[0].doc.tunnels!.friendly[0].id;
    expect(failures(a).join('\n')).toContain('repeats a route id');
    const b = rulesFor('wadi_tarfan');
    b[0].doc.tunnels!.hostile[0].id = b[0].doc.tunnels!.friendly[0].id;
    expect(failures(b).join('\n')).toContain('repeats a route id');
  });
  it('refuses an id a map route already has', () => {
    const r = rulesFor('wadi_tarfan');
    const m = clone(mapsById.get('wadi_tarfan') as { tunnels?: unknown[] });
    m.tunnels = [{ id: 'wt_f_north', mouth: [1, 1], vent: [2, 2] }];
    const out = versusRulesFailures(r, new Map(mapsById).set('wadi_tarfan', m)).filter((f) => !f.startsWith('data/versus: no rules file'));
    expect(out.join('\n')).toContain('reuses the id of a route map');
  });
  it('refuses a total over MAX_TUNNELS, counting the larger end and the map\'s own routes', () => {
    const r = rulesFor('tel_marum');
    const proto = r[0].doc.tunnels!.hostile[0];
    r[0].doc.tunnels!.hostile = Array.from({ length: MAX_TUNNELS }, (_, i) => ({ ...clone(proto), id: `t${i}` }));
    expect(failures(r).filter((f) => f.includes('the sim holds'))).toEqual([]); // 16 is allowed
    r[0].doc.tunnels!.hostile.push({ ...clone(proto), id: 't16' });
    expect(failures(r).filter((f) => f.includes('the sim holds'))).toHaveLength(1);
    // The map's own routes count too.
    const m = clone(mapsById.get('tel_marum') as { tunnels?: unknown[] });
    m.tunnels = [{ id: 'm0', mouth: [1, 1], vent: [2, 2] }];
    r[0].doc.tunnels!.hostile.pop();
    const out = versusRulesFailures(r, new Map(mapsById).set('tel_marum', m)).filter((f) => f.includes('the sim holds'));
    expect(out).toHaveLength(1);
  });
});

describe('the schema\'s tunnels block (GH-681)', () => {
  const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/versus_rules.schema.json'), 'utf8')) as object);
  const ok = (mut: (r: Rules) => void): boolean => {
    const r = clone(shipped.find((x) => x.doc.map === 'tel_marum')!.doc);
    mut(r);
    return validate(r);
  };
  it('takes the shipped shape and refuses each way to leave it', () => {
    expect(ok(() => undefined)).toBe(true);
    expect(ok((r) => { r.tunnels!.hostile[0].capacity = 9; })).toBe(false);
    expect(ok((r) => { r.tunnels!.hostile[0].capacity = 0; })).toBe(false);
    expect(ok((r) => { r.tunnels!.hostile[0].points = [[1, 1]]; })).toBe(false);
    expect(ok((r) => { r.tunnels!.hostile[0].points = Array.from({ length: 9 }, (_, i) => [i, 1]); })).toBe(false);
    expect(ok((r) => { r.tunnels!.hostile[0].points = [[1.5, 1], [2, 2]]; })).toBe(false);
    expect(ok((r) => { r.tunnels!.hostile[0].id = 'Bad Id'; })).toBe(false);
    expect(ok((r) => { (r.tunnels!.hostile[0] as Record<string, unknown>).side = 1; })).toBe(false);
    expect(ok((r) => { (r.tunnels!.hostile[0] as Record<string, unknown>).pre_dug = true; })).toBe(false);
    expect(ok((r) => { (r.tunnels as Record<string, unknown>).middle = []; })).toBe(false);
  });
});
