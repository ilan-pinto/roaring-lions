// GH-976 P1: data/versus/modes/*.json, its schema, the rules tools/validate_versus_modes.mjs holds over it, and the
// loader that turns a mode into a goals-only mission. The plain-node validator carries copies of the mode list and
// the offered maps; this file holds both to the shipped code.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, FLAG_SETUP_CAP_MINUTES as NET_FLAG_SETUP_CAP_MINUTES, FLAG_SETUP_MAPS, VERSUS_FAIR_MAPS, WIN_MODES as NET_WIN_MODES, WIN_MODE_FAIR_FACTION_CELLS, WIN_MODE_FAIR_MAPS, economyRoom, validateConfig, winModeAllowed, winModeField, type MatchConfig } from '@lions/net';
import { FLAG_SETUP_CAP_MINUTES, SETUP_BAND_TILES_48, SETUP_BAND_TILES_LARGE, SETUP_KIT, SETUP_SECONDS, STRUCTURE_SYMBOLS, TERRAIN_LEGEND, campYardZone, flagZone, maps, parseMap, setupRegionOf, versusModeMissionOf, versusModes, versusRules, WIN_MODES, type MapJson, type VersusModeFileJson } from '@lions/data';
import { FOOT_OPEN, MODE_CAMP_REACH, OFFERED_MAPS, SETUP_BAND_TILES_48 as MJS_BAND_48, SETUP_BAND_TILES_LARGE as MJS_BAND_LARGE, SETUP_KIT as MJS_KIT, SETUP_SECONDS as MJS_SECONDS, WIN_MODES as MJS_WIN_MODES, setupRegion, versusModeFailures } from '../validate_versus_modes.mjs';
import { CAMP_REACH, scanExit } from '../validate_versus_rules.mjs';
import { LZ_SEARCH_TILES } from '../../packages/sim/src/tuning';
import { SETUP_PLACEMENTS_PER_SIDE, fx } from '@lions/sim';
import { buildMatchWorld, type MatchWorld } from '../../packages/app/src/net/match-world';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'data', 'versus', 'modes');
interface Doc {
  id: string;
  map: string;
  camps?: { friendly: { at: number[]; size: number[]; exit?: number[] }; hostile: { at: number[]; size: number[]; exit?: number[] } };
  flags?: { friendly: { at: number[]; size: number[] }; hostile: { at: number[]; size: number[] } };
  modes: { camp?: Record<string, unknown>; flag?: { hold_s: number }; points?: { zones: { zone: string; per_min: number; at?: number[]; size?: number[] }[]; per_value_destroyed: number; target: number } };
}
const shipped: { file: string; doc: Doc }[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: `data/versus/modes/${f}`, doc: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Doc }));
const asFile = (d: Doc): VersusModeFileJson => d as unknown as VersusModeFileJson;
const mapsById = new Map<string, unknown>(Object.entries(maps));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const modeFor = (map: string): { file: string; doc: Doc }[] => [clone(shipped.find((s) => s.doc.map === map) as { file: string; doc: Doc })];
const ajv = new (AjvModule as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown } })({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/versus_mode.schema.json'), 'utf8')) as object);

/** The maps whose rows and elevation are point-symmetric about the map centre (checked below, tile for tile), so a mode file
 *  for them may be, and these are, point-symmetric too. `tel_marum` and `beit_sahwan_outskirts` are not: their files place a
 *  flag and a scoring ground by measurement, and nothing here asks them to be images of each other (GH-976 P4). */
const SYMMETRIC_MAPS = ['milh_flats', 'milh_flats_l', 'rujm_sawda', 'wadi_tarfan', 'wadi_tarfan_l'];
const ASYMMETRIC_MAPS = ['beit_sahwan_outskirts', 'tel_marum'];

describe('the shipped win-mode files', () => {
  it('are the seven open versus maps, pass the schema and the cross-file rules, and are registered', () => {
    expect(shipped.map((s) => s.doc.map)).toEqual(['beit_sahwan_outskirts', 'milh_flats', 'milh_flats_l', 'rujm_sawda', 'tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']);
    expect([...SYMMETRIC_MAPS, ...ASYMMETRIC_MAPS].sort()).toEqual(shipped.map((s) => s.doc.map));
    for (const s of shipped) expect(validate(s.doc), s.file).toBe(true);
    expect(versusModeFailures(shipped, mapsById)).toEqual([]);
    // index.ts is hand-kept: a file in the directory and not in `versusModes` is a mode no room can reach.
    expect(Object.keys(versusModes).sort()).toEqual(shipped.map((s) => s.doc.map));
    for (const s of shipped) expect(versusModes[s.doc.map]).toEqual(s.doc);
  });

  it('the mode list and the offered maps are held to the shipped code, both ways', () => {
    expect([...WIN_MODES]).toEqual([...NET_WIN_MODES]);
    expect(MJS_WIN_MODES).toEqual([...WIN_MODES]);
    expect(OFFERED_MAPS).toEqual([...VERSUS_FAIR_MAPS]);
    expect(winModeField('camp')).toBe('camp');
    expect(winModeField('points')).toBe('points');
    expect(winModeField('flag')).toBe('flag');
    expect(winModeField('rally')).toBeUndefined();
    expect(winModeField(undefined)).toBeUndefined();
  });

  it('the maps a mode is read fair on all carry that mode and are maps a room is offered on; camp is read fair on wadi_tarfan, milh_flats and wadi_tarfan_l', () => {
    for (const mode of NET_WIN_MODES) {
      for (const map of WIN_MODE_FAIR_MAPS[mode]) {
        expect(VERSUS_FAIR_MAPS, `${mode} on ${map}`).toContain(map);
        expect(versusModes[map]?.modes[mode], `${mode} on ${map} has its mode file`).toBeDefined();
        expect(winModeAllowed(mode, map)).toBe(true);
      }
      // A KDF-v-Sarim cell is offered only on a map KDF meets Sarim on, and only where the file carries the mode.
      for (const [map, hosts] of Object.entries(WIN_MODE_FAIR_FACTION_CELLS[mode])) {
        expect(FACTION_MATCHUP_MAPS, `${mode} KDF v Sarim on ${map}`).toContain(map);
        expect(versusModes[map]?.modes[mode], `${mode} on ${map} has its mode file`).toBeDefined();
        expect(hosts.length, `${mode} on ${map}`).toBeGreaterThan(0);
      }
    }
    // The literals (GH-976 P4): each of the seven open maps carries both modes, each read fair in the mirror, in a fixed order.
    const SEVEN = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
    expect(WIN_MODE_FAIR_MAPS.points).toEqual(SEVEN); // wadi_tarfan 56.3%, milh_flats 57.3% (P1); the other five 51-55% on 4000-4287: see config.ts
    expect(WIN_MODE_FAIR_MAPS.flag).toEqual(SEVEN);   // wadi_tarfan 56.9%, milh_flats 52.1% (P3); the other five 44-55% (45-55% of the decisive games)
    expect(WIN_MODE_FAIR_MAPS.camp).toEqual(['wadi_tarfan', 'milh_flats', 'wadi_tarfan_l']); // forward camps; milh_flats (15,39)/(31,7): 52.4%, 96.5% by the goal; wadi_tarfan (13,18)/(33,28) and wadi_tarfan_l (26,30)/(68,64) with wipe after_camp (GH-976, 5 Nov); the others stay out: see config.ts
    expect([...VERSUS_FAIR_MAPS].sort()).toEqual([...SEVEN].sort());
    for (const map of SEVEN) for (const mode of ['points', 'flag'] as const) expect(versusModes[map].modes[mode], `${map} ${mode}`).toBeDefined();
    // ...and no KDF-v-Sarim cell: the one that passed (points on wadi_tarfan_l at 10 per 100) was a kill race and was removed.
    expect(WIN_MODE_FAIR_FACTION_CELLS).toEqual({ camp: {}, points: {}, flag: {} });
    expect(winModeAllowed('camp', 'wadi_tarfan')).toBe(true);
    expect(winModeAllowed('camp', 'wadi_tarfan_l')).toBe(true);
    for (const out of ['milh_flats_l', 'rujm_sawda', 'tel_marum', 'beit_sahwan_outskirts']) expect(winModeAllowed('camp', out), out).toBe(false);
    expect(winModeAllowed('camp', 'milh_flats')).toBe(true);
    expect(winModeAllowed('camp', 'milh_flats', 'kdf')).toBe(false);   // the mirror only
    expect(winModeAllowed('points', 'wadi_tarfan_l', 'kdf')).toBe(false);
    expect(winModeAllowed('points', 'wadi_tarfan_l', 'sarim')).toBe(false);
    expect(winModeAllowed('flag', 'wadi_tarfan_l', 'kdf')).toBe(false);
    expect(winModeAllowed('points', 'wadi_tarfan', 'sarim')).toBe(false);
    expect(winModeAllowed('points', 'tel_marum', 'kdf')).toBe(false);
  });

  it('GH-976 P4 review: a points race is mostly held ground: no file pays more than 2 points per 100 value destroyed', () => {
    // Measured on 9000-9287: at 1-2 per 100 about 90% of the points on milh_flats_l, tel_marum and wadi_tarfan come from held ground; at
    // 10 per 100 (wadi_tarfan_l, removed) 80% came from kills, a two-minute kill race under a hint that promises the ground.
    for (const s of shipped) {
      const p = s.doc.modes.points!;
      expect(p.per_value_destroyed, s.doc.map).toBeLessThanOrEqual(2);
      expect(p.target, s.doc.map).toBeGreaterThanOrEqual(350);
    }
    expect(shipped.find((s) => s.doc.map === 'wadi_tarfan_l')!.doc.modes.points).toMatchObject({ per_value_destroyed: 1, target: 600 });
  });

  it('GH-976 P4: the symmetric maps are point-symmetric tile for tile (rows and elevation), the two others are not: so the symmetry the next tests ask is a fact about the map', () => {
    type M = { width: number; height: number; rows: string[]; elevation?: string[] };
    const asym = (m: M, grid: string[]): number => { let n = 0; for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (grid[y][x] !== grid[m.height - 1 - y][m.width - 1 - x]) n++; return n; };
    for (const id of SYMMETRIC_MAPS) {
      const m = (maps as unknown as Record<string, M>)[id];
      expect(asym(m, m.rows), `${id} rows`).toBe(0);
      if (m.elevation !== undefined) expect(asym(m, m.elevation), `${id} elevation`).toBe(0);
    }
    for (const id of ASYMMETRIC_MAPS) {
      const m = (maps as unknown as Record<string, M>)[id];
      expect(asym(m, m.rows), `${id} rows`).toBeGreaterThan(100);
    }
  });

  it('GH-976 P3: on a point-symmetric map the flag zones come in point-symmetric pairs, so both seats raid the same ground; on the others each flag is its own measured ground', () => {
    for (const s of shipped) {
      const map = (maps as unknown as Record<string, { width: number; height: number }>)[s.doc.map];
      const f = s.doc.flags!;
      expect(f.friendly.size, `${s.doc.map} size`).toEqual(f.hostile.size);
      expect(s.doc.modes.flag!.hold_s).toBe(30);
      // A rectangle at (x, y) of size (w, h) is carried by the half turn to (W - x - w, H - y - h).
      const image = [map.width - f.friendly.at[0] - f.friendly.size[0], map.height - f.friendly.at[1] - f.friendly.size[1]];
      if (SYMMETRIC_MAPS.includes(s.doc.map)) expect(f.hostile.at, `${s.doc.map} flags are a half turn apart`).toEqual(image);
      else expect(f.hostile.at, `${s.doc.map} flags are not images of each other: the ground is not`).not.toEqual(image);
    }
  });

  const ARRANGEMENTS: readonly (readonly ['kdf' | 'sarim', 'kdf' | 'sarim'])[] = [['kdf', 'kdf'], ['kdf', 'sarim'], ['sarim', 'kdf']];
  /** The ground a mode file gives a mode, as `[name, x, y, w, h]`, flags by END and points zones from the map or the file. */
  const groundsOf = (doc: Doc, mode: 'flag' | 'points'): [string, number[]][] => {
    if (mode === 'flag') return (['friendly', 'hostile'] as const).map((end) => [`${end} flag`, [doc.flags![end].at[0], doc.flags![end].at[1], doc.flags![end].size[0], doc.flags![end].size[1]]]);
    const rects = (maps as unknown as Record<string, { zones: Record<string, number[]> }>)[doc.map].zones;
    return doc.modes.points!.zones.map((z) => [z.zone, z.at !== undefined ? [z.at[0], z.at[1], z.size![0], z.size![1]] : rects[z.zone]]);
  };
  /** Every ground (flag or scoring) that has a unit of the placed forces on it at tick 0, in a room of this arrangement, as
   *  `map arrangement mode ground unit-type`. A seat that stands on a scoring ground holds it from the first tick and is paid for
   *  standing still; a unit on a flag ground starts a raid's hold or spoils the other's. A Sarim host is side 1 at the friendly end,
   *  the KDF always side 0 (`sidesOfFactions`). */
  const underAUnit = (map: string, arr: readonly ['kdf' | 'sarim', 'kdf' | 'sarim'], mode: 'flag' | 'points'): string[] => {
    const sides: [0 | 1, 0 | 1] = arr[0] === 'sarim' && arr[1] === 'kdf' ? [1, 0] : [0, 1];
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map, mode: 'versus', seats: [0, 1].map((s) => ({ seat: s, side: sides[s], faction: arr[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' })), pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: mode } as never) as MatchConfig;
    const w = buildMatchWorld(c);
    const typeAt = new Map<string, string>();
    for (const ids of w.bySide) for (const i of ids) typeAt.set(`${Math.floor(w.sim.state.posX[i] / 65536)},${Math.floor(w.sim.state.posY[i] / 65536)}`, w.sim.unitTypes[w.sim.state.typeIdx[i]].id);
    expect(typeAt.size, `${map} ${arr.join('/')} spawned something`).toBeGreaterThan(20);
    const out: string[] = [];
    for (const [name, r] of groundsOf(shipped.find((x) => x.doc.map === map)!.doc, mode)) {
      for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) {
        const t = typeAt.get(`${x},${y}`);
        if (t !== undefined) out.push(`${map} ${arr.join('/')} ${mode} ${name} ${t}`);
      }
    }
    return out;
  };

  it('GH-976 P3, P4: no flag and no scoring ground has a unit on it at tick 0 in the mirror, where every mode is offered', () => {
    for (const { doc } of shipped) for (const mode of ['flag', 'points'] as const) expect(underAUnit(doc.map, ['kdf', 'kdf'], mode), `${doc.map} ${mode}`).toEqual([]);
  });

  it('GH-976 P4: in every KDF-v-Sarim arrangement a mode file can be offered in, the grounds under a unit are exactly the known three, each a Sarim atgm_cell (an exemption that stops being true must be deleted)', () => {
    const found: string[] = [];
    for (const map of FACTION_MATCHUP_MAPS) for (const arr of ARRANGEMENTS.slice(1)) for (const mode of ['flag', 'points'] as const) found.push(...underAUnit(map, arr, mode));
    // None of these cells is offered (`WIN_MODE_FAIR_FACTION_CELLS` is empty); the first explains tel_marum's flag row in the PR: a
    // Sarim atgm_cell stands on the friendly flag ground in the KDF-host room, so a Sarim raid there begins with its hold running.
    expect(found).toEqual(['tel_marum kdf/sarim flag friendly flag atgm_cell', 'wadi_tarfan kdf/sarim points bluff_near_1 atgm_cell', 'wadi_tarfan sarim/kdf points bluff_near_0 atgm_cell']);
  });

  it('the three camp maps\' camps are point-symmetric about the map centre, forward of the seat, and read where they stand', () => {
    const doc = (map: string): NonNullable<Doc['camps']> => shipped.find((s) => s.doc.map === map)!.doc.camps!;
    const sizeOf = (map: string): number => (maps as unknown as Record<string, { width: number }>)[map].width;
    for (const map of ['wadi_tarfan', 'milh_flats', 'wadi_tarfan_l']) {
      const c = doc(map);
      const n = sizeOf(map);
      // tile (x, y) maps to (n - 1 - x, n - 1 - y), so a w x h camp at (x, y) maps to (n - w - x, n - h - y) and has the same size; the exits are point mirrors of each other.
      expect(c.hostile.size, map).toEqual(c.friendly.size);
      expect(c.hostile.at, map).toEqual([n - c.friendly.size[0] - c.friendly.at[0], n - c.friendly.size[1] - c.friendly.at[1]]);
      expect(c.hostile.exit, map).toEqual([n - 1 - c.friendly.exit![0], n - 1 - c.friendly.exit![1]]);
    }
    // The ground each camp mode was READ fair on (GH-976 camp-mode; wadi_tarfan and wadi_tarfan_l on 28000-28191, 5 Nov). A one-tile move is a
    // different cell: the surface is a race, re-read it.
    expect(doc('milh_flats')).toEqual({ friendly: { at: [13, 37], size: [3, 3], exit: [12, 36] }, hostile: { at: [32, 8], size: [3, 3], exit: [35, 11] } }); // V5 (GH-976 camp rush): 3x3 camps, two tiles back. Was (15,39) / (31,7), 2x2.
    expect(doc('wadi_tarfan')).toEqual({ friendly: { at: [13, 18], size: [2, 2], exit: [12, 17] }, hostile: { at: [33, 28], size: [2, 2], exit: [35, 30] } });
    expect(doc('wadi_tarfan_l')).toEqual({ friendly: { at: [26, 30], size: [2, 2], exit: [25, 29] }, hostile: { at: [68, 64], size: [2, 2], exit: [70, 66] } });
    // wadi_tarfan's mode camps are no longer its rules file's economy camps (7,7) / (39,39): the economy keeps its yards at the seat (CAMP_REACH 6).
    expect(versusRules.wadi_tarfan.ends.friendly.camp.at).not.toEqual(doc('wadi_tarfan').friendly.at);
  });

  it('on a point-symmetric map the points zones come in the map\'s point-symmetric pairs, so both seats are offered the same ground', () => {
    for (const s of shipped.filter((x) => SYMMETRIC_MAPS.includes(x.doc.map))) {
      const mapJson = (maps as unknown as Record<string, { zones: Record<string, number[]>; width: number }>)[s.doc.map];
      const rects = mapJson.zones;
      const pts = s.doc.modes.points!;
      // A ground the file declares is read from the file; the others from the map.
      const declared = Object.fromEntries(pts.zones.filter((z) => z.at !== undefined).map((z) => [z.zone, [z.at![0], z.at![1], z.size![0], z.size![1]]]));
      const rect = (n: string): number[] => declared[n] ?? rects[n];
      const centre = (n: string): [number, number] => [rect(n)[0] + rect(n)[2] / 2, rect(n)[1] + rect(n)[3] / 2];
      const w = mapJson.width;
      const pair = new Map(pts.zones.map((z) => [z.zone, z.per_min]));
      for (const z of pts.zones) {
        const [cx, cy] = centre(z.zone);
        const twin = pts.zones.find((o) => { const [ox, oy] = centre(o.zone); return ox === w - cx && oy === w - cy; });
        expect(twin, `${s.doc.map} ${z.zone} has a point-symmetric twin in the scoring zones`).toBeDefined();
        expect(pair.get(twin!.zone), `${s.doc.map} ${z.zone} and its twin pay alike`).toBe(z.per_min);
      }
    }
  });

  // GH-976 (the lead's ruling, 8 Nov): the placement rule "no camp tile is a tile the placed force spawns on" EXEMPTS AIRCRAFT. A flying unit never blocks a camp
  // (V5 on milh_flats, 3x3 camps, puts a recon drone over each footprint). "Aircraft" is read from the sim's own `isAir`, which is the unit JSON's
  // `mobility.domain === 'air'`, never from a unit id, so a ground unit on a camp tile is refused whatever its name.
  const campRoom = (map: string): MatchWorld => {
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map, mode: 'versus', seats: [0, 1].map((s) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' })), pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: 'camp' } as never) as MatchConfig;
    return buildMatchWorld(c);
  };
  /** The units standing on a camp's footprint, as `{ id, air, at }`; with `aircraftExempt` (the rule) a flying unit is not counted. */
  const unitsOnCamp = (w: MatchWorld, camp: { at: readonly number[]; size: readonly number[] }, aircraftExempt: boolean): { id: string; air: boolean; at: string }[] => {
    const out: { id: string; air: boolean; at: string }[] = [];
    const st = w.sim.state;
    for (let i = 0; i < w.sim.entityCount; i++) {
      if (st.alive[i] !== 1) continue;
      const type = w.sim.unitTypes[st.typeIdx[i]];
      if (aircraftExempt && type.isAir) continue;
      const x = Math.floor(st.posX[i] / 65536);
      const y = Math.floor(st.posY[i] / 65536);
      if (x >= camp.at[0] && x < camp.at[0] + camp.size[0] && y >= camp.at[1] && y < camp.at[1] + camp.size[1]) out.push({ id: type.id, air: type.isAir, at: `${x},${y}` });
    }
    return out;
  };

  it('no camp tile is a tile the placed force spawns on (aircraft exempt)', () => {
    // Only the files that carry the `camp` mode have camps (the mode is read fair nowhere: GH-976 P1).
    for (const { doc } of shipped.filter((x) => x.doc.camps !== undefined)) {
      const w = campRoom(doc.map);
      for (const end of ['friendly', 'hostile'] as const) {
        expect(unitsOnCamp(w, doc.camps![end], true), `${doc.map} ${end} camp tile under a ground unit`).toEqual([]);
      }
    }
  });

  it('an aircraft on a camp tile is exempt, and a ground unit on a camp tile is still refused', () => {
    const w = campRoom('milh_flats');
    const camp = { at: [20, 20], size: [2, 2] } as const; // open ground well clear of both seats and both shipped camps
    expect(unitsOnCamp(w, camp, false), 'nothing stands there before the test puts it').toEqual([]);
    const typeIdx = (air: boolean): number => w.sim.unitTypes.findIndex((u) => u.isAir === air && u.id !== '');
    const spawnOn = (idx: number): void => { w.sim.spawn(idx, 0, fx.from(camp.at[0] + 0.5), fx.from(camp.at[1] + 0.5)); };
    // an aircraft, whichever the roster has: not counted by the rule, counted without the exemption
    spawnOn(typeIdx(true));
    expect(unitsOnCamp(w, camp, true), 'the rule lets an aircraft stand on a camp tile').toEqual([]);
    expect(unitsOnCamp(w, camp, false).map((u) => u.air), 'without the exemption it would be refused').toEqual([true]);
    // a ground unit: refused, named, whatever its id is
    spawnOn(typeIdx(false));
    const refused = unitsOnCamp(w, camp, true);
    expect(refused.length, 'a ground unit on a camp tile is refused').toBe(1);
    expect(refused[0].air).toBe(false);
  });
});

describe('versusModeFailures, one mutation at a time', () => {
  const only = (doc: Doc, file = 'data/versus/modes/wadi_tarfan.json'): string[] => versusModeFailures([{ file, doc }], mapsById);
  const wt = (): Doc => modeFor('wadi_tarfan')[0].doc;
  const camps = (d: Doc): NonNullable<Doc['camps']> => d.camps!;

  it('id is the map; the map is offered; a second file for a map; a map that is not there', () => {
    expect(only({ ...wt(), id: 'tel_marum' })).toEqual(['data/versus/modes/wadi_tarfan.json: id "tel_marum" is not its map "wadi_tarfan" -- one file per map, named by it']);
    expect(only({ ...wt(), id: 'tile_x', map: 'tile_x' })[0]).toMatch(/not a map a versus room is offered on/);
    expect(versusModeFailures([...modeFor('wadi_tarfan'), ...modeFor('wadi_tarfan')], mapsById).some((f) => /a second mode file/.test(f))).toBe(true);
    expect(only({ ...wt(), id: 'qarn_hadid', map: 'qarn_hadid' }, 'x.json').some((f) => /not a map a versus room is offered on/.test(f))).toBe(true);
  });

  it('the camp mode needs camps, and camps need the camp mode', () => {
    const noCamps = wt();
    delete (noCamps as { camps?: unknown }).camps;
    expect(only(noCamps)).toEqual(['data/versus/modes/wadi_tarfan.json: the camp mode needs `camps`']);
    const noMode = wt();
    delete (noMode.modes as { camp?: unknown }).camp;
    expect(only(noMode)).toEqual(['data/versus/modes/wadi_tarfan.json: `camps` is declared and no camp mode uses it']);
  });

  it('a camp tile off the map, on a building or a ridge, far from its anchor, or overlapping the other', () => {
    const off = wt();
    camps(off).friendly.at = [-1, 7];
    expect(only(off).some((f) => /is off the 48x48 map/.test(f))).toBe(true);
    const wall = wt();
    camps(wall).hostile.at = [40, 10]; // wadi_tarfan row 10 col 40 is a house tile
    expect(only(wall).some((f) => /not open ground/.test(f))).toBe(true);
    const far = wt();
    camps(far).friendly.at = [22, 22]; // 12 tiles from the (10,10) anchor; the most is 10
    expect(only(far).some((f) => /tiles \(Chebyshev\) from the friendly anchor/.test(f))).toBe(true);
    const clash = wt();
    camps(clash).hostile = { at: [13, 18], size: [2, 2] };
    expect(only(clash).some((f) => /the two camps overlap/.test(f))).toBe(true);
  });

  it('GH-976 (5 Nov): a mode camp may stand 10 tiles from its anchor and no more; the economy camps keep 6', () => {
    expect(MODE_CAMP_REACH).toBe(10);
    // wadi_tarfan's friendly seat is (10,10): a 2x2 whose nearest tile is 10 away passes, 11 fails (a pair moved together keeps the mirror).
    const at10 = wt();
    camps(at10).friendly = { at: [20, 18], size: [2, 2], exit: [19, 17] };
    camps(at10).hostile = { at: [26, 28], size: [2, 2], exit: [28, 30] };
    expect(only(at10).filter((f) => /Chebyshev/.test(f))).toEqual([]);
    const at11 = wt();
    camps(at11).friendly = { at: [21, 18], size: [2, 2], exit: [20, 17] };
    camps(at11).hostile = { at: [25, 28], size: [2, 2], exit: [27, 30] };
    expect(only(at11).some((f) => /11 tiles \(Chebyshev\) from the friendly anchor .*the most is 10/.test(f))).toBe(true);
    expect(CAMP_REACH).toBe(6);
  });

  it('GH-976: a camp exit is an open ring tile; on a point-symmetric map the two exits are point mirrors', () => {
    const base = wt();
    expect(only(base)).toEqual([]);
    const nudgedHostile = wt(); // one tile off the mirror, still a ring tile
    camps(nudgedHostile).hostile.exit = [34, 30];
    expect(only(nudgedHostile).some((f) => /not point mirrors/.test(f))).toBe(true);
    const nudgedFriendly = wt();
    camps(nudgedFriendly).friendly.exit = [13, 17];
    expect(only(nudgedFriendly).some((f) => /not point mirrors/.test(f))).toBe(true);
    const inside = wt();
    camps(inside).friendly.exit = [13, 18];
    expect(only(inside).some((f) => /not a ring tile/.test(f))).toBe(true);
    const far = wt();
    camps(far).friendly.exit = [4, 4];
    expect(only(far).some((f) => /not a ring tile/.test(f))).toBe(true);
    const derived = wt(); // derived: with no exit, the NW scan gives (32,27) for the hostile camp, not the mirror (35,30) of (12,17)
    delete (camps(derived).hostile as { exit?: unknown }).exit;
    expect(only(derived).some((f) => /not point mirrors/.test(f))).toBe(true);
  });

  it('GH-976: the two camp footprints are point mirrors on a point-symmetric map, beside the exits', () => {
    const wide = wt(); // a 3x2 hostile camp whose exit (35,30) is still a ring tile and still the mirror of (12,17): only the footprint is off
    camps(wide).hostile.size = [3, 2];
    const fails = only(wide).filter((f) => /footprints/.test(f));
    expect(fails.length).toBe(1);
    expect(only(wide).some((f) => /camp exits .* not point mirrors/.test(f))).toBe(false);
    const lopsided = wt(); // a 3x2 FRIENDLY camp: its corner sums with the hostile's still reach the far edge, only the sizes differ
    camps(lopsided).friendly = { at: [13, 18], size: [3, 2], exit: [12, 17] };
    expect(only(lopsided).filter((f) => /footprints/.test(f)).length).toBe(1);
    const shifted = wt(); // a camp one tile nearer its end, with an exit that still mirrors the other: the exits alone pass this
    camps(shifted).friendly = { at: [12, 18], size: [2, 2], exit: [12, 17] };
    expect(only(shifted).some((f) => /footprints/.test(f))).toBe(true);
    expect(only(shifted).some((f) => /camp exits .* not point mirrors/.test(f))).toBe(false);
    for (const s of shipped.filter((x) => x.doc.camps !== undefined && SYMMETRIC_MAPS.includes(x.doc.map))) {
      expect(versusModeFailures([clone(s)], mapsById).filter((f) => /footprints/.test(f)), s.file).toEqual([]);
    }
  });

  it('GH-976: camp `wipe` is ends or after_camp in the schema and the validator; all three camp maps ship after_camp', () => {
    for (const wipe of ['ends', 'after_camp']) {
      const d = wt();
      d.modes.camp = { wipe };
      expect(validate(d), wipe).toBe(true);
      expect(only(d), wipe).toEqual([]);
    }
    const bad = wt();
    bad.modes.camp = { wipe: 'never' };
    expect(validate(bad)).toBe(false);
    expect(only(bad).some((f) => /is not ends or after_camp/.test(f))).toBe(true);
    expect(shipped.find((s) => s.doc.map === 'milh_flats')!.doc.modes.camp).toEqual({ wipe: 'after_camp' });
    for (const map of ['wadi_tarfan', 'wadi_tarfan_l']) expect(shipped.find((s) => s.doc.map === map)!.doc.modes.camp, map).toEqual({ wipe: 'after_camp' });
  });

  it('a points zone the map does not have, listed twice, or holding a seat\'s anchor', () => {
    const ghost = wt();
    ghost.modes.points!.zones.push({ zone: 'nowhere', per_min: 10 });
    expect(only(ghost)).toEqual(['data/versus/modes/wadi_tarfan.json: points zone "nowhere" is not a zone of map "wadi_tarfan"']);
    const twice = wt();
    twice.modes.points!.zones.push({ zone: 'centre_ford', per_min: 10 });
    expect(only(twice)).toEqual(['data/versus/modes/wadi_tarfan.json: points zone "centre_ford" is listed twice']);
    // The friendly seat of wadi_tarfan is (10,10), inside the map's own `camp_0` zone [5,1,10,19].
    const home = wt();
    home.modes.points!.zones.push({ zone: 'camp_0', per_min: 10 });
    expect(only(home)).toEqual(['data/versus/modes/wadi_tarfan.json: points zone "camp_0" holds the friendly anchor (10,10): that seat would score from its first tick']);
  });

  it('GH-976 P4: a points zone that declares its ground: at and size together, a name the map lacks, inside the map, half open, clear of the anchors', () => {
    const declare = (z: Record<string, unknown>): Doc => {
      const d = wt();
      d.modes.points!.zones.push({ per_min: 10, ...z } as never);
      return d;
    };
    const file = 'data/versus/modes/wadi_tarfan.json';
    // A clean declared ground (open ground east of the centre) is fine, and its name is not in the map.
    expect(only(declare({ zone: 'hold_a', at: [24, 36], size: [4, 4] }))).toEqual([]);
    expect(Object.hasOwn((maps.wadi_tarfan as unknown as { zones: object }).zones, 'hold_a')).toBe(false);
    // One of the pair is not a ground.
    expect(only(declare({ zone: 'hold_a', at: [24, 36] }))).toEqual([`${file}: points zone "hold_a" gives \`at\` or \`size\` without the other`, `${file}: points zone "hold_a" is not a zone of map "wadi_tarfan"`]);
    expect(only(declare({ zone: 'hold_a', size: [4, 4] }))[0]).toBe(`${file}: points zone "hold_a" gives \`at\` or \`size\` without the other`);
    // A declared name the map already has, or one the loader gives a flag or a camp.
    expect(only(declare({ zone: 'ne_ford', at: [24, 36], size: [4, 4] })).some((f) => /declares its own ground, and the map already has a zone of that name/.test(f))).toBe(true);
    expect(only(declare({ zone: 'flag_x', at: [24, 36], size: [4, 4] })).some((f) => /takes a name the loader gives a flag or a camp/.test(f))).toBe(true);
    expect(only(declare({ zone: 'camp_yard_x', at: [24, 36], size: [4, 4] })).some((f) => /takes a name the loader gives a flag or a camp/.test(f))).toBe(true);
    // Off the map, and on the south-west boulder field (row 46-47 is all boulder: not open ground).
    expect(only(declare({ zone: 'hold_a', at: [46, 46], size: [4, 4] })).some((f) => /tile \(48,46\) is off the 48x48 map/.test(f))).toBe(true);
    expect(only(declare({ zone: 'hold_a', at: [0, 46], size: [4, 2] })).some((f) => /is 0 open tiles of 8: a side could hardly stand in it/.test(f))).toBe(true);
    // Half open is enough; fewer is not (the boulder rows 46-47 against open row 45 tiles 9 and 14).
    expect(only(declare({ zone: 'hold_a', at: [11, 44], size: [4, 2] }))).toEqual([]);
    // Holding a seat's anchor is refused for a declared ground exactly as for a map zone.
    expect(only(declare({ zone: 'hold_a', at: [9, 9], size: [3, 3] }))).toEqual([`${file}: points zone "hold_a" holds the friendly anchor (10,10): that seat would score from its first tick`]);
    // Listed twice.
    const twice = declare({ zone: 'hold_a', at: [24, 36], size: [4, 4] });
    twice.modes.points!.zones.push({ zone: 'hold_a', per_min: 10, at: [30, 36], size: [4, 4] });
    expect(only(twice)).toEqual([`${file}: points zone "hold_a" is listed twice`]);
  });

  const flags = (d: Doc): NonNullable<Doc['flags']> => d.flags!;

  it('GH-976 P3: the flag mode needs flags, and flags need the flag mode', () => {
    const noFlags = wt();
    delete (noFlags as { flags?: unknown }).flags;
    expect(only(noFlags)).toEqual(['data/versus/modes/wadi_tarfan.json: the flag mode needs `flags`']);
    const noMode = wt();
    delete (noMode.modes as { flag?: unknown }).flag;
    // GH-976 v2: the staged flag_setup beside it needs the flag mode too, so the file now says that as well.
    expect(only(noMode)).toEqual(['data/versus/modes/wadi_tarfan.json: `flags` is declared and no flag mode uses it', 'data/versus/modes/wadi_tarfan.json: flag_setup needs the flag mode (`modes.flag`) beside it']);
  });

  it('GH-976 P3: a flag tile off the map or on a building, a flag on a seat, flags that overlap each other or a camp, and a zone the map already has', () => {
    const off = wt();
    flags(off).friendly.at = [-1, 26];
    expect(only(off).some((f) => /friendly flag tile \(-1,26\) is off the 48x48 map/.test(f))).toBe(true);
    const wall = wt();
    flags(wall).hostile.at = [40, 10]; // row 10 col 40 is a house tile
    expect(only(wall).some((f) => /hostile flag tile .* not open ground/.test(f))).toBe(true);
    const seat = wt();
    flags(seat).friendly.at = [8, 8]; // the friendly anchor is (10,10)
    expect(only(seat).some((f) => /the friendly flag holds the friendly anchor \(10,10\)/.test(f))).toBe(true);
    const clash = wt();
    flags(clash).hostile.at = [...flags(clash).friendly.at];
    expect(only(clash).some((f) => /the two flags overlap/.test(f))).toBe(true);
    const onCamp = wt();
    flags(onCamp).friendly.at = [11, 16]; // the camp is [13,18,2,2]
    expect(only(onCamp).some((f) => /the friendly flag overlaps the friendly camp/.test(f))).toBe(true);
    const named = clone(modeFor('wadi_tarfan')[0]);
    const taken = { ...(maps.wadi_tarfan as unknown as { zones: Record<string, number[]> }) };
    taken.zones = { ...taken.zones, flag_friendly: [0, 0, 1, 1] };
    const byId = new Map<string, unknown>(mapsById);
    byId.set('wadi_tarfan', { ...(maps.wadi_tarfan as object), zones: taken.zones });
    expect(versusModeFailures([named], byId).some((f) => /the map already has a zone "flag_friendly"/.test(f))).toBe(true);
  });

  it('a mode no code knows, and a deadline', () => {
    const odd = wt();
    (odd.modes as Record<string, unknown>).rally = {};
    expect(only(odd)).toEqual(['data/versus/modes/wadi_tarfan.json: mode "rally" is not one of camp, points, flag']);
    const dead = wt();
    (dead.modes as Record<string, unknown>).camp = { seconds: 300 };
    expect(only(dead).some((f) => /no `seconds`/.test(f))).toBe(true);
  });
});

describe('versus_mode.schema.json', () => {
  const doc = (): Doc => clone(shipped[1].doc);
  it('refuses a file with no modes, an unknown key, a target outside 100..5000, a rate outside 1..120, and a float', () => {
    const none = doc();
    (none as { modes: unknown }).modes = {};
    expect(validate(none)).toBe(false);
    expect(validate({ ...doc(), extra: 1 })).toBe(false);
    for (const target of [99, 5001, 600.5]) {
      const d = doc();
      (d.modes.points as { target: number }).target = target;
      expect(validate(d), String(target)).toBe(false);
    }
    for (const per_min of [0, 121, 1.5]) {
      const d = doc();
      d.modes.points!.zones[0] = { zone: 'centre_ford', per_min };
      expect(validate(d), String(per_min)).toBe(false);
    }
    const d = doc();
    (d.modes.points as { per_value_destroyed: number }).per_value_destroyed = 21;
    expect(validate(d)).toBe(false);
  });

  it('GH-976 P4: a points zone may declare its ground with at and size together, whole tiles, and takes nothing else', () => {
    const d0 = doc();
    d0.modes.points!.zones.push({ zone: 'hold_a', per_min: 10, at: [24, 36], size: [4, 4] });
    expect(validate(d0)).toBe(true);
    for (const bad of [{ at: [24, 36] }, { size: [4, 4] }, { at: [24], size: [4, 4] }, { at: [24, 36, 1], size: [4, 4] }, { at: [24.5, 36], size: [4, 4] }, { at: [-1, 36], size: [4, 4] }, { at: [24, 36], size: [0, 4] }, { at: [24, 36], size: [4, 4], rect: 1 }]) {
      const d = doc();
      d.modes.points!.zones.push({ zone: 'hold_a', per_min: 10, ...bad } as never);
      expect(validate(d), JSON.stringify(bad)).toBe(false);
    }
  });

  it('GH-976 P3: the flag hold is a whole number of seconds, 5 to 120, and the flag block takes nothing else', () => {
    for (const hold_s of [4, 121, 30.5, '30']) {
      const d = doc();
      (d.modes as { flag?: unknown }).flag = { hold_s };
      expect(validate(d), String(hold_s)).toBe(false);
    }
    const extra = doc();
    (extra.modes as { flag?: unknown }).flag = { hold_s: 30, seconds: 30 };
    expect(validate(extra)).toBe(false);
    const none = doc();
    (none.modes as { flag?: unknown }).flag = {};
    expect(validate(none)).toBe(false);
    const bad = doc();
    (bad as { flags?: unknown }).flags = { friendly: { at: [1, 1], size: [5, 5] } };
    expect(validate(bad)).toBe(false);
  });
});

describe('versusModeMissionOf', () => {
  const file = (): VersusModeFileJson => asFile(shipped.find((s) => s.doc.map === 'wadi_tarfan')!.doc);

  it('camp: each side razes the camp at the OTHER side\'s end, both camps stand owned by their end\'s side, and the objectives have no deadline', () => {
    const { mission, zones } = versusModeMissionOf(file(), 'camp', { friendly: 0, hostile: 1 });
    expect(mission.objectives).toEqual([
      { id: 'raze_camp_0', type: 'raze', primary: true, side: 0, target: campYardZone('hostile') },
      { id: 'raze_camp_1', type: 'raze', primary: true, side: 1, target: campYardZone('friendly') },
    ]);
    expect(mission.structures).toEqual([
      { type: 'camp', at: [13, 18], size: [2, 2], side: 0, owner: 0 },
      { type: 'camp', at: [33, 28], size: [2, 2], side: 1, owner: 1 },
    ]);
    expect(zones).toEqual({ camp_yard_friendly: [13, 18, 2, 2], camp_yard_hostile: [33, 28, 2, 2] });
    expect(JSON.stringify(mission)).not.toContain('seconds');
  });

  it('camp: with the sides at the other ends, side 0 razes the camp now at the FRIENDLY end', () => {
    const { mission } = versusModeMissionOf(file(), 'camp', { friendly: 1, hostile: 0 });
    expect(mission.objectives[0]).toEqual({ id: 'raze_camp_0', type: 'raze', primary: true, side: 0, target: campYardZone('friendly') });
    expect(mission.structures.map((s) => [s.side, s.at])).toEqual([[0, [33, 28]], [1, [13, 18]]]);
  });

  it('points: both sides run the same score block, side 0 first', () => {
    const { mission, zones } = versusModeMissionOf(file(), 'points', { friendly: 0, hostile: 1 });
    expect(zones).toEqual({});
    expect(mission.structures).toEqual([]);
    expect(mission.objectives.map((o) => [o.id, o.side])).toEqual([['score_0', 0], ['score_1', 1]]);
    expect(mission.objectives[0].score).toEqual(mission.objectives[1].score);
    expect(mission.objectives[0].score).toEqual(file().modes.points);
  });

  it('GH-976 P4 points: a ground the file declares joins the zones the room adds, and the objective names it without the rectangle', () => {
    const f = clone(file()) as unknown as { modes: { points: { zones: { zone: string; per_min: number; at?: number[]; size?: number[] }[] } } };
    f.modes.points.zones.push({ zone: 'hold_a', per_min: 15, at: [24, 36], size: [4, 4] });
    const { mission, zones } = versusModeMissionOf(f as unknown as VersusModeFileJson, 'points', { friendly: 0, hostile: 1 });
    expect(zones).toEqual({ hold_a: [24, 36, 4, 4] });
    const score = mission.objectives[0].score!;
    expect(score.zones.at(-1)).toEqual({ zone: 'hold_a', per_min: 15 });
    expect(Object.keys(score.zones.at(-1)!).sort()).toEqual(['per_min', 'zone']);
    expect(mission.objectives[1].score).toEqual(score);
    // The room refuses a declared name the map already has (the same check a flag's name meets).
    const clash = clone(f);
    clash.modes.points.zones.push({ zone: 'ne_ford', per_min: 5, at: [24, 36], size: [4, 4] });
    const cfg = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: 'wadi_tarfan', mode: 'versus', seats: [0, 1].map((s) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' })), pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: 'points' } as never) as MatchConfig;
    const was = versusModes.wadi_tarfan;
    (versusModes as Record<string, unknown>).wadi_tarfan = clash;
    try { expect(() => buildMatchWorld(cfg)).toThrow(/zone "ne_ford" is already a zone of the map/); } finally { (versusModes as Record<string, unknown>).wadi_tarfan = was; }
  });

  it('GH-976 P3 flag: each side captures the flag zone at the OTHER side\'s end, alone, for the same hold, and the zones are added', () => {
    const { mission, zones } = versusModeMissionOf(file(), 'flag', { friendly: 0, hostile: 1 });
    expect(mission.objectives).toEqual([
      { id: 'raid_flag_0', type: 'capture', primary: true, side: 0, target: flagZone('hostile'), seconds: 30 },
      { id: 'raid_flag_1', type: 'capture', primary: true, side: 1, target: flagZone('friendly'), seconds: 30 },
    ]);
    expect(zones).toEqual({ flag_friendly: [6, 30, 5, 5], flag_hostile: [37, 13, 5, 5] });
    expect(mission.structures).toEqual([]);
    // With the sides at the other ends, side 0 raids the flag now at the FRIENDLY end.
    const swapped = versusModeMissionOf(file(), 'flag', { friendly: 1, hostile: 0 }).mission;
    expect(swapped.objectives[0]).toMatchObject({ id: 'raid_flag_0', side: 0, target: flagZone('friendly') });
    expect(swapped.objectives[1]).toMatchObject({ id: 'raid_flag_1', side: 1, target: flagZone('hostile') });
  });

  it('refuses a mode the file does not carry', () => {
    const noFlag = { ...file(), modes: { camp: {} } } as VersusModeFileJson;
    expect(() => versusModeMissionOf(noFlag, 'flag', { friendly: 0, hostile: 1 })).toThrow(/no flag mode/);
    const noFlags = { ...file(), flags: undefined } as VersusModeFileJson;
    expect(() => versusModeMissionOf(noFlags, 'flag', { friendly: 0, hostile: 1 })).toThrow(/no flag mode/);
    const noPoints = { ...file(), modes: { camp: {} } } as VersusModeFileJson;
    expect(() => versusModeMissionOf(noPoints, 'points', { friendly: 0, hostile: 1 })).toThrow(/no points mode/);
    const noCamp = { ...file(), modes: { points: file().modes.points } } as VersusModeFileJson;
    expect(() => versusModeMissionOf(noCamp, 'camp', { friendly: 0, hostile: 1 })).toThrow(/no camp mode/);
  });
});

describe('a win-mode room (buildMatchWorld)', () => {
  const config = (map: string, mode: 'camp' | 'points' | 'flag' | undefined, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'] = ['kdf', 'kdf']): MatchConfig => {
    const sides = factions[0] !== factions[1] && factions[0] === 'sarim' ? [1, 0] : [0, 1];
    const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, ...(mode !== undefined ? { winMode: mode } : {}) } as never);
    if (c === null) throw new Error('bad config');
    return c;
  };

  it('GH-976: a camp room answers each camp\'s AUTHORED exit through structureExit (the wiring in modeRuntime)', () => {
    const w = buildMatchWorld(config('milh_flats', 'camp'));
    const camps = shipped.find((s) => s.doc.map === 'milh_flats')!.doc.camps!;
    const answer = (end: 'friendly' | 'hostile'): number[] => w.sim.structureExit(w.sim.structureAt(camps[end].at[0], camps[end].at[1])).map((v) => v / 65536);
    expect(answer('friendly')).toEqual([12.5, 36.5]);
    expect(answer('hostile')).toEqual([35.5, 11.5]);
    // and the NW scan would have said otherwise for the east camp, so the check can fail
    expect(w.sim.structureExit(w.sim.structureAt(32, 8)).map((v) => v / 65536)).not.toEqual([31.5, 7.5]);
  });

  it('a camp room stands two OWNED camps, the owner being the side at that end, and a points room stands none', () => {
    for (const map of ['wadi_tarfan', 'milh_flats']) {
      const w = buildMatchWorld(config(map, 'camp'));
      expect(w.winMode).toBe('camp');
      expect(w.runtime).not.toBeNull();
      expect(w.structureTypes).toEqual(['camp']);
      const camps = shipped.find((s) => s.doc.map === map)!.doc.camps!;
      const owners = (['friendly', 'hostile'] as const).map((end) => {
        const s = w.sim.structureAt(camps[end].at[0], camps[end].at[1]);
        expect(s, `${map} ${end} camp stands`).toBeGreaterThanOrEqual(0);
        return w.sim.structures.owner[s];
      });
      expect(owners).toEqual([0, 1]); // a mirror: side 0 friendly
      const p = buildMatchWorld(config(map, 'points'));
      expect(p.winMode).toBe('points');
      expect(p.structureTypes).toEqual([]);
    }
  });

  it('GH-976 P3: a flag room stands no structure, adds the two flag zones to the runtime\'s ground, and runs one capture per side', () => {
    for (const map of ['wadi_tarfan', 'milh_flats']) {
      const w = buildMatchWorld(config(map, 'flag'));
      expect(w.winMode).toBe('flag');
      expect(w.structureTypes).toEqual([]);
      expect(w.runtime!.objectiveList.map((o) => [o.id, o.type, o.zone, o.primary])).toEqual([
        ['raid_flag_0', 'capture', 'flag_hostile', true],
        ['raid_flag_1', 'capture', 'flag_friendly', true],
      ]);
      expect(w.map.zones.flag_friendly).toBeUndefined(); // the map itself is untouched: the room adds them to the runtime only
    }
  });

  it('a Sarim host is side 1 at the FRIENDLY end: the camp there is side 1\'s, and the room is no economy room', () => {
    const c = config('wadi_tarfan', 'camp', ['sarim', 'kdf']);
    expect(economyRoom(c)).toBe(false);
    expect(economyRoom({ ...c, winMode: undefined })).toBe(true);
    const w = buildMatchWorld(c);
    expect(w.sim.structures.owner[w.sim.structureAt(13, 18)]).toBe(1);
    expect(w.sim.structures.owner[w.sim.structureAt(33, 28)]).toBe(0);
    // Goals only: no production line, in a room that would otherwise have a camp menu.
    expect(w.runtime!.productionLines(0)).toEqual([]);
    expect(w.runtime!.productionLines(1)).toEqual([]);
  });

  it('an annihilation room is what it was: no winMode, no runtime in a mirror, an economy runtime in a faction room', () => {
    const m = buildMatchWorld(config('wadi_tarfan', undefined));
    expect(m.winMode).toBeNull();
    expect(m.runtime).toBeNull();
    const e = buildMatchWorld(config('wadi_tarfan', undefined, ['kdf', 'sarim']));
    expect(e.winMode).toBeNull();
    expect(e.runtime!.productionLines(0).length).toBeGreaterThan(0);
  });

  it('refuses a mode the map has no file for, and a winMode on a sandbox config or one that is not a mode', () => {
    expect(() => buildMatchWorld(config('tel_marum', 'camp'))).toThrow(/has no "camp" win mode/);
    const base = config('wadi_tarfan', 'camp') as MatchConfig;
    expect(validateConfig({ ...base, winMode: 'rally' })).toBeNull();
    expect(validateConfig({ ...base, winMode: 'flag' })).not.toBeNull();
    expect(validateConfig({ ...base, mode: 'sandbox' })).toBeNull();
    expect(validateConfig({ ...base })).not.toBeNull();
  });
});

describe('a win-mode room survives a snapshot (a rejoin)', () => {
  // The runtime's score, objective status and completion tick (GH-976 P2) are `ObjectiveState` rows, so the runtime
  // section carries them: this is the proof, on a real room, for each mode, cut mid-race and mid-raze.
  it.each([['wadi_tarfan', 'points'], ['milh_flats', 'points'], ['wadi_tarfan', 'camp'], ['wadi_tarfan', 'flag'], ['milh_flats', 'flag']] as const)('%s %s: a fresh world restored from bytes plays on to the same hash and the same score', async (map, mode) => {
    const { encodeSim, restoreSim } = await import('@lions/sim');
    const { matchTick } = await import('../../packages/app/src/net/match-world');
    const { pointsOrder, campOrder, flagOrder, raidParty, modeConfig } = await import('./backtest/versus-modes');
    const { matchDigest } = await import('@lions/net');
    const cfg = modeConfig(map, mode, 1000);
    const zones = versusModes[map].modes.points?.zones.map((z) => z.zone) ?? [];
    const parties = new Map<number, readonly number[]>();
    const drive = (w: ReturnType<typeof buildMatchWorld>, t: number): void => {
      const ends: [0 | 1, 0 | 1] = [w.endOfSide[0] === 'friendly' ? 0 : 1, w.endOfSide[0] === 'friendly' ? 1 : 0];
      if (t % 400 === 0) { if (mode === 'points') pointsOrder(w, zones, -1); else if (mode === 'flag') flagOrder(w, map, parties, new Set(), ends); else campOrder(w, map, -1); }
      matchTick(w);
    };
    const a = buildMatchWorld(cfg);
    if (mode === 'flag') for (const side of [0, 1] as const) parties.set(side, raidParty(a, side)); // ids are the same in the restored world
    // A camp game is short (a camp stands about two minutes under attack), so its cut and its end come earlier.
    // A raid is mid-hold at tick 900 (arrival about 30 s in, the hold 30 s more) and over by 1500.
    const [cut, end] = mode === 'camp' ? [500, 1100] : mode === 'flag' ? [900, 1500] : [1500, 3500];
    for (let t = 0; t < cut; t++) drive(a, t);
    const bytes = encodeSim(a.sim, {}, a.runtime!);
    const b = buildMatchWorld(cfg);
    restoreSim(b.sim, bytes, b.runtime!);
    const hash = (w: typeof a): number => matchDigest(w.sim.hash(), w.runtime!.digest(), 0);
    expect(hash(b)).toBe(hash(a));
    for (let t = cut; t < end; t++) {
      drive(a, t);
      drive(b, t);
      if (t % 100 === 0) expect(hash(b), `tick ${t}`).toBe(hash(a));
    }
    expect(b.runtime!.scoreUnitsOf(0)).toBe(a.runtime!.scoreUnitsOf(0));
    expect(b.runtime!.scoreUnitsOf(1)).toBe(a.runtime!.scoreUnitsOf(1));
    if (mode === 'points') expect(a.runtime!.scoreUnitsOf(0) + a.runtime!.scoreUnitsOf(1)).toBeGreaterThan(0); // the race had moved
    if (mode === 'flag') expect(a.runtime!.objectiveList.some((o) => o.status === 'complete' || o.ticksLeft !== 600)).toBe(true); // a hold had begun
  }, 90_000);
});


// ---------------------------------------------------------------------------------------------------
// GH-976 v2: the staged `flag_setup` block
// ---------------------------------------------------------------------------------------------------
describe('GH-976 v2: flag_setup', () => {
  const SETUP_MAPS = ['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
  type Setup = { flags: { friendly: { at: number[]; size: number[] }; hostile: { at: number[]; size: number[] } }; hold_s: number; setup: { seconds: number; band_tiles: number; kit: Record<string, number> } };
  const withSetup = (map: string): { file: string; doc: Doc & { flag_setup: Setup } }[] => modeFor(map) as { file: string; doc: Doc & { flag_setup: Setup } }[];
  /** The failures after `edit` has changed the staged block of `map`'s file. */
  const failuresAfter = (map: string, edit: (fs: Setup, doc: Doc) => void): string[] => {
    const f = withSetup(map);
    edit(f[0].doc.flag_setup, f[0].doc);
    return versusModeFailures(f, mapsById);
  };
  const mirror = (at: number[], size: number[], map: string): number[] => [(maps[map as keyof typeof maps] as unknown as { width: number }).width - at[0] - size[0], (maps[map as keyof typeof maps] as unknown as { height: number }).height - at[1] - size[1]];

  it('exactly the five v1 maps carry it, beside the unchanged flags and modes.flag, and each is a valid file', () => {
    expect(shipped.filter((s) => (s.doc as { flag_setup?: unknown }).flag_setup !== undefined).map((s) => s.doc.map)).toEqual([...SETUP_MAPS].sort());
    for (const m of SETUP_MAPS) {
      const doc = shipped.find((s) => s.doc.map === m)!.doc as Doc & { flag_setup: Setup };
      expect(doc.flags, m).toBeDefined();
      expect(doc.modes.flag, m).toBeDefined();
      expect(doc.flag_setup.hold_s, m).toBe(45);
      expect(doc.flag_setup.setup.kit, m).toEqual(SETUP_KIT);
      expect(doc.flag_setup.setup.seconds, m).toBe(SETUP_SECONDS);
      expect(doc.flag_setup.setup.band_tiles, m).toBe(maps[m as keyof typeof maps].width > 48 ? SETUP_BAND_TILES_LARGE : SETUP_BAND_TILES_48);
    }
  });

  it('the validator\'s copies of the constants are the shipped ones', () => {
    expect(MJS_KIT).toEqual(SETUP_KIT);
    expect(MJS_SECONDS).toBe(SETUP_SECONDS);
    expect(MJS_BAND_48).toBe(SETUP_BAND_TILES_48);
    expect(MJS_BAND_LARGE).toBe(SETUP_BAND_TILES_LARGE);
  });

  // The falsifications: each shipped file with ONE edit, and the line it must name.
  it('the shipped wadi_tarfan_l flags in flag_setup -> G-ratio (own path 68, enemy path 34)', () => {
    const lines = failuresAfter('wadi_tarfan_l', (fs, doc) => { fs.flags = clone(doc.flags!) as Setup['flags']; });
    expect(lines.some((l) => l.includes('G-ratio') && l.includes('own path 68, enemy path 34'))).toBe(true);
  });
  it('wadi_tarfan flags at own path 13 -> G-depth', () => {
    const lines = failuresAfter('wadi_tarfan', (fs) => { fs.flags.friendly.at = [20, 3]; fs.flags.hostile.at = mirror([20, 3], [5, 5], 'wadi_tarfan'); });
    expect(lines.some((l) => l.includes('G-depth') && l.includes('own path 13 is not 6-12'))).toBe(true);
  });
  it('a top-left x of 2 -> G-edge', () => {
    const lines = failuresAfter('wadi_tarfan', (fs) => { fs.flags.friendly.at = [2, 3]; fs.flags.hostile.at = mirror([2, 3], [5, 5], 'wadi_tarfan'); });
    expect(lines.some((l) => l.includes('G-edge'))).toBe(true);
  });
  it.each([
    ['friendly', [3, 2], 'top'],
    ['friendly', [2, 3], 'left'],
    ['hostile', [41, 20], 'right'],
    ['hostile', [20, 41], 'bottom'],
  ] as const)('G-edge, one flag alone (the %s flag at %j, its %s edge): the mirror cannot stand in for the clause', (end, at, edge) => {
    const lines = failuresAfter('wadi_tarfan', (fs) => { fs.flags[end].at = [...at]; });
    expect(lines.some((l) => l.includes(`${end} flag`) && l.includes('G-edge')), `${edge} edge`).toBe(true);
  });
  it('wadi_tarfan band_tiles 2 -> S4 (the staged flags stand 22 tiles off the line, so S3 stays quiet at band 2: see the S2/S3 case)', () => {
    const lines = failuresAfter('wadi_tarfan', (fs) => { fs.setup.band_tiles = 2; });
    expect(lines.some((l) => l.includes('S4 band_tiles 2 is under 8'))).toBe(true);
  });
  it('milh_flats band_tiles 6 -> S4', () => {
    expect(failuresAfter('milh_flats', (fs) => { fs.setup.band_tiles = 6; }).some((l) => l.includes('S4'))).toBe(true);
  });
  it('a band that is not the size class\'s -> named, even when it is wide enough', () => {
    expect(failuresAfter('milh_flats', (fs) => { fs.setup.band_tiles = 10; }).some((l) => l.includes('band_tiles 10 is not 8'))).toBe(true);
  });
  it('one flag moved one tile -> mirror', () => {
    const lines = failuresAfter('wadi_tarfan_l', (fs) => { fs.flags.hostile.at = [fs.flags.hostile.at[0] + 1, fs.flags.hostile.at[1]]; });
    expect(lines.some((l) => l.includes('point mirrors'))).toBe(true);
  });
  it('hesco 13 -> kit', () => {
    expect(failuresAfter('wadi_tarfan', (fs) => { fs.setup.kit.hesco = 13; }).some((l) => l.includes('kit hesco is 13'))).toBe(true);
  });
  it('seconds 120 -> seconds (and the mode-objective seconds rule does not fire on the block)', () => {
    const lines = failuresAfter('wadi_tarfan', (fs) => { fs.setup.seconds = 120; });
    expect(lines.some((l) => l.includes('flag_setup seconds is 120'))).toBe(true);
    expect(lines.some((l) => l.includes('a mode objective has no `seconds`'))).toBe(false);
    // ...while a stray `seconds` anywhere else still does.
    const f = withSetup('wadi_tarfan');
    (f[0].doc.modes.flag as Record<string, unknown>).seconds = 30;
    expect(versusModeFailures(f, mapsById).some((l) => l.includes('a mode objective has no `seconds`'))).toBe(true);
  });
  it('a flag apron one tile over the band -> S2', () => {
    const lines = failuresAfter('wadi_tarfan', (fs) => { fs.flags.friendly.at = [14, 14]; fs.flags.hostile.at = mirror([14, 14], [5, 5], 'wadi_tarfan'); });
    expect(lines.some((l) => l.includes('S2') && l.includes('1 tiles of its 11x11 apron'))).toBe(true);
    expect(lines.some((l) => l.includes('S3'))).toBe(true); // the same flag stands inside 17 tiles of the enemy region
  });
  it('flag_setup on a map that is not point-symmetric, or with no flag mode, is refused', () => {
    const f = clone(shipped.find((s) => s.doc.map === 'tel_marum')!) as { file: string; doc: Doc & { flag_setup?: Setup } };
    f.doc.flag_setup = clone((shipped.find((s) => s.doc.map === 'wadi_tarfan')!.doc as unknown as { flag_setup: Setup }).flag_setup);
    expect(versusModeFailures([f], mapsById).some((l) => l.includes('only for a point-symmetric map'))).toBe(true);
    expect(failuresAfter('wadi_tarfan', (_fs, doc) => { delete doc.modes.flag; delete doc.flags; }).some((l) => l.includes('needs the flag mode'))).toBe(true);
  });
  it('a flag over an exit, a blocked tile, an anchor or a camp is refused', () => {
    expect(failuresAfter('wadi_tarfan', (fs) => { (fs.flags.friendly as Record<string, unknown>).exit = [1, 1]; }).some((l) => l.includes('declares an exit'))).toBe(true);
    expect(failuresAfter('wadi_tarfan', (fs) => { fs.flags.friendly.at = [8, 8]; }).some((l) => l.includes('holds the friendly anchor'))).toBe(true);
    expect(failuresAfter('wadi_tarfan', (fs) => { fs.flags.friendly.at = [12, 17]; }).some((l) => l.includes('overlaps the friendly camp'))).toBe(true);
  });

  describe('the region twin', () => {
    const anchorsOfMap = (m: string): { friendly: [number, number]; hostile: [number, number] } => {
      const mk = (maps[m as keyof typeof maps] as unknown as { markers: Record<string, number[]> }).markers;
      return { friendly: mk.versus_0 as [number, number], hostile: mk.versus_1 as [number, number] };
    };
    it('for each of the five maps, .mjs setupRegion equals @lions/data setupRegionOf, cell for cell', () => {
      for (const m of SETUP_MAPS) {
        const map = maps[m as keyof typeof maps] as unknown as { width: number; height: number };
        const a = m === 'wadi_tarfan' ? { friendly: [10, 10] as [number, number], hostile: [37, 37] as [number, number] } : anchorsOfMap(m);
        const band = map.width > 48 ? 12 : 8;
        expect([...setupRegion(map, a, band)], m).toEqual([...setupRegionOf(map.width, map.height, a.friendly, a.hostile, band)]);
      }
    });
    it('both match the 12x1 literals', () => {
      const want = [0, 0, 0, 0, 0, -1, 1, 1, 1, 1, 1, 1];
      expect(setupRegion({ width: 12, height: 1 }, { friendly: [0, 0], hostile: [10, 0] }, 2)).toEqual(want);
      expect([...setupRegionOf(12, 1, [0, 0], [10, 0], 2)]).toEqual(want);
    });
    it('96x96 with corner seats (D^2 past int32): the .mjs twin equals a BigInt oracle written here, cell for cell (R0.20)', () => {
      const W = 96;
      const got = setupRegion({ width: W, height: W }, { friendly: [0, 0], hostile: [95, 95] }, 12);
      const A = [1n, 1n];
      const B = [191n, 191n];
      const L = (A[0] - B[0]) ** 2n + (A[1] - B[1]) ** 2n;
      let beyond = 0;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          const c = [BigInt(2 * x + 1), BigInt(2 * y + 1)];
          const D = (c[0] - B[0]) ** 2n + (c[1] - B[1]) ** 2n - ((c[0] - A[0]) ** 2n + (c[1] - A[1]) ** 2n);
          if (D * D > 2n ** 31n) beyond++;
          expect(got[y * W + x], `(${x},${y})`).toBe(D * D >= 4n * 144n * L ? (D > 0n ? 0 : 1) : -1);
        }
      }
      expect(beyond).toBeGreaterThan(0);
    });
  });

  it('R0.25: the validator\'s foot mask is parseMap\'s own, for every symbol of the legend', () => {
    const symbols = [...Object.keys(TERRAIN_LEGEND), ...Object.keys(STRUCTURE_SYMBOLS)];
    expect(symbols.length).toBeGreaterThan(10);
    for (const sym of symbols) {
      // A 6x6 block of the symbol: big enough for any footprint, and parseMap reads the mask itself.
      const rows = Array.from({ length: 6 }, () => sym.repeat(6));
      let parsed;
      try {
        parsed = parseMap({ id: 'foot_probe', width: 6, height: 6, rows, theme: 'wetland', markers: {} } as unknown as MapJson);
      } catch {
        continue; // a structure symbol the loader will not take as a bare block is judged by the legend below
      }
      expect(FOOT_OPEN.has(sym), `symbol ${sym}`).toBe(parsed.blocked[0] === 0);
    }
    for (const sym of Object.keys(TERRAIN_LEGEND)) expect(FOOT_OPEN.has(sym), `terrain ${sym}`).toBe(TERRAIN_LEGEND[sym].blocked === 0);
    for (const sym of Object.keys(STRUCTURE_SYMBOLS)) expect(FOOT_OPEN.has(sym), `structure ${sym}`).toBe(false);
  });
});


// ---------------------------------------------------------------------------------------------------
// GH-976 v2 WP4: the runtime wiring over the five staged maps
// ---------------------------------------------------------------------------------------------------
describe('GH-976 v2 WP4: a flagSetup world over the five staged maps', () => {
  const FIVE = ['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
  /** A KDF mirror flag room with `flagSetup` (what the Worker mints for a listed map); seat 0 is side 0 at the friendly end. */
  const setupRoom = (map: string): MatchConfig => {
    const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: 'flag', flagSetup: true });
    if (c === null) throw new Error('bad config');
    return c;
  };
  /** The maps in `list` whose mode file has no staged `flag_setup`: the check `FLAG_SETUP_MAPS` is held to. */
  const unstaged = (list: readonly string[]): string[] => list.filter((m) => (versusModes[m] as VersusModeFileJson | undefined)?.flag_setup === undefined);

  it('the cap twin: data\'s FLAG_SETUP_CAP_MINUTES is net\'s, and is 30', () => {
    expect(NET_FLAG_SETUP_CAP_MINUTES).toBe(FLAG_SETUP_CAP_MINUTES);
    expect(FLAG_SETUP_CAP_MINUTES).toBe(30);
  });
  it('every map in FLAG_SETUP_MAPS has a flag_setup block (and the check sees a map that has none)', () => {
    expect(unstaged(FLAG_SETUP_MAPS)).toEqual([]);
    // The loop above is empty while the list is: prove the check itself can fail, on the five and on a map without a block.
    expect(unstaged(FIVE)).toEqual([]);
    expect(unstaged(['wadi_tarfan', 'tel_marum', 'nowhere'])).toEqual(['tel_marum', 'nowhere']);
  });
  it.each(FIVE)('S1 %s: built with flagSetup, every unit of each side stands inside its own side\'s region', (map) => {
    const w = buildMatchWorld(setupRoom(map));
    expect(w.bySide[0].length).toBeGreaterThan(0);
    expect(w.bySide[1].length).toBeGreaterThan(0);
    for (const side of [0, 1] as const) {
      for (const id of w.bySide[side]) {
        const tx = w.sim.state.posX[id] >> 16;
        const ty = w.sim.state.posY[id] >> 16;
        expect(w.sim.setupRegionAt(tx, ty), `${map} side ${side} unit ${id} at (${tx},${ty})`).toBe(side);
      }
    }
  });
  it.each(FIVE)('the structure budget %s: map structures + 2 x SETUP_PLACEMENTS_PER_SIDE fit the 256 the table holds (ids are never reused, R0.10)', (map) => {
    const w = buildMatchWorld(setupRoom(map));
    // 256 is the sim's MAX_STRUCTURES (sim.ts, not exported): `addStructure` throws past it.
    expect(w.sim.structureCount + 2 * SETUP_PLACEMENTS_PER_SIDE, map).toBeLessThanOrEqual(256);
  });
  it('SETUP_PLACEMENTS_PER_SIDE is 36, twice the kit (R0.10)', () => {
    expect(SETUP_PLACEMENTS_PER_SIDE).toBe(2 * (SETUP_KIT.hesco + SETUP_KIT.sandbag_post + SETUP_KIT.t_wall));
    expect(SETUP_PLACEMENTS_PER_SIDE).toBe(36);
  });
  /**
   * The camp-exit LZ (WP2 sim-guard review). A unit built during the set-up is put at its camp's `structureExit` by `spawnPlacement`
   * (production delivers `count: 1`, so the placement spread `SPREAD` -- 1.25 tiles, `(k % 3) * SPREAD` -- is 0 for the one body),
   * and an air carrier is then settled by `settleOnGround` -> `lzFor`, a ring search to `LZ_SEARCH_TILES` Chebyshev from that tile.
   * None of it is clamped to the region, so the whole square of radius `LZ_SEARCH_TILES` round the exit tile must be the camp owner's
   * region. Camps are read from both places a camp is authored: the mode file's `camps` and the economy rules file's `ends[].camp`.
   */
  const campExits = (map: string): { source: string; end: 'friendly' | 'hostile'; exit: [number, number] }[] => {
    const parsed = maps[map as keyof typeof maps] as unknown as { width: number; height: number; rows: string[] };
    const out: { source: string; end: 'friendly' | 'hostile'; exit: [number, number] }[] = [];
    const modeCamps = (versusModes[map] as unknown as { camps?: Record<'friendly' | 'hostile', { at: [number, number]; size: [number, number]; exit?: [number, number] }> }).camps;
    const ruleCamps = (versusRules[map] as unknown as { ends: Record<'friendly' | 'hostile', { camp: { at: [number, number]; size: [number, number]; exit?: [number, number] } }> } | undefined)?.ends;
    for (const end of ['friendly', 'hostile'] as const) {
      for (const [source, camp] of [['mode camps', modeCamps?.[end]], ['rules camp', ruleCamps?.[end].camp]] as const) {
        if (camp === undefined) continue;
        const exit = camp.exit ?? (scanExit(parsed, camp) as [number, number] | null);
        if (exit === null) throw new Error(`${map} ${source} ${end}: no exit`);
        out.push({ source, end, exit });
      }
    }
    return out;
  };
  /** Foreign tiles within `reach` (Chebyshev, clipped to the map) of `exit`: the camp owner's region must hold them all. */
  const foreignWithin = (w: ReturnType<typeof buildMatchWorld>, owner: 0 | 1, exit: readonly [number, number], reach: number): { tile: [number, number]; dist: number }[] => {
    const out: { tile: [number, number]; dist: number }[] = [];
    for (let y = Math.max(0, exit[1] - reach); y <= Math.min(w.sim.height - 1, exit[1] + reach); y++) {
      for (let x = Math.max(0, exit[0] - reach); x <= Math.min(w.sim.width - 1, exit[0] + reach); x++) {
        if (w.sim.setupRegionAt(x, y) !== owner) out.push({ tile: [x, y], dist: Math.max(Math.abs(x - exit[0]), Math.abs(y - exit[1])) });
      }
    }
    return out;
  };
  /** The failures of the camp-exit LZ rule over `exits`, each naming the map, the camp, the tile and its distance. */
  const lzFailures = (map: string, w: ReturnType<typeof buildMatchWorld>, exits: ReturnType<typeof campExits>): string[] => {
    const out: string[] = [];
    for (const c of exits) {
      const owner: 0 | 1 = w.endOfSide[0] === c.end ? 0 : 1;
      for (const f of foreignWithin(w, owner, c.exit, LZ_SEARCH_TILES)) out.push(`${map} ${c.source} ${c.end} exit (${c.exit}): tile (${f.tile}) is not side ${owner}'s, ${f.dist} from the exit`);
    }
    return out;
  };
  it.each(FIVE)('camp-exit LZ %s: every tile within LZ_SEARCH_TILES of each camp exit is the camp owner\'s region', (map) => {
    const w = buildMatchWorld(setupRoom(map));
    const exits = campExits(map);
    expect(exits.length, `${map}: a camp to test`).toBeGreaterThan(0);
    expect(lzFailures(map, w, exits)).toEqual([]);
  });
  it('camp-exit LZ: the rule goes red for a camp exit moved (in memory) to within 6 tiles of the band, and names the tile and distance', () => {
    const w = buildMatchWorld(setupRoom('wadi_tarfan'));
    const moved = campExits('wadi_tarfan').map((c) => (c.end === 'friendly' ? { ...c, exit: [20, 20] as [number, number] } : c));
    const failures = lzFailures('wadi_tarfan', w, moved);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toMatch(/wadi_tarfan .* friendly exit \(20,20\): tile \(\d+,\d+\) is not side 0's, [1-6] from the exit/);
    // Only the moved end fails: the hostile exits, still where they were shipped, read clean.
    expect(failures.every((f) => f.includes('friendly'))).toBe(true);
  });
});
