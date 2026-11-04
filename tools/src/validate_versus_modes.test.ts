// GH-976 P1: data/versus/modes/*.json, its schema, the rules tools/validate_versus_modes.mjs holds over it, and the
// loader that turns a mode into a goals-only mission. The plain-node validator carries copies of the mode list and
// the offered maps; this file holds both to the shipped code.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { VERSUS_FAIR_MAPS, WIN_MODES as NET_WIN_MODES, WIN_MODE_FAIR_MAPS, economyRoom, validateConfig, winModeAllowed, winModeField, type MatchConfig } from '@lions/net';
import { campYardZone, maps, versusModeMissionOf, versusModes, versusRules, WIN_MODES, type VersusModeFileJson } from '@lions/data';
import { OFFERED_MAPS, WIN_MODES as MJS_WIN_MODES, versusModeFailures } from '../validate_versus_modes.mjs';
import { buildMatchWorld } from '../../packages/app/src/net/match-world';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'data', 'versus', 'modes');
interface Doc {
  id: string;
  map: string;
  camps?: { friendly: { at: number[]; size: number[] }; hostile: { at: number[]; size: number[] } };
  modes: { camp?: Record<string, unknown>; points?: { zones: { zone: string; per_min: number }[]; per_value_destroyed: number; target: number } };
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

describe('the shipped win-mode files', () => {
  it('are the two open mirror maps, pass the schema and the cross-file rules, and are registered', () => {
    expect(shipped.map((s) => s.doc.map)).toEqual(['milh_flats', 'wadi_tarfan']);
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
    expect(winModeField('flag')).toBeUndefined();
    expect(winModeField(undefined)).toBeUndefined();
  });

  it('the maps a mode is read fair on all carry that mode and are maps a room is offered on; camp is read fair on none', () => {
    for (const mode of NET_WIN_MODES) {
      for (const map of WIN_MODE_FAIR_MAPS[mode]) {
        expect(VERSUS_FAIR_MAPS, `${mode} on ${map}`).toContain(map);
        expect(versusModes[map]?.modes[mode], `${mode} on ${map} has its mode file`).toBeDefined();
        expect(winModeAllowed(mode, map)).toBe(true);
      }
    }
    expect(WIN_MODE_FAIR_MAPS.points).toEqual(['wadi_tarfan', 'milh_flats']);
    expect(WIN_MODE_FAIR_MAPS.camp).toEqual([]); // 4.9% / 58.3% decided by the camp, passive ends win 8-47 of 288: see config.ts
    expect(winModeAllowed('camp', 'wadi_tarfan')).toBe(false);
    expect(winModeAllowed('points', 'tel_marum')).toBe(false);
  });

  it('wadi_tarfan\'s camps are its rules file\'s, and milh_flats\' two camps are point-symmetric about the map centre', () => {
    const w = shipped.find((s) => s.doc.map === 'wadi_tarfan')!.doc;
    expect(w.camps).toEqual(versusRules.wadi_tarfan.ends && { friendly: versusRules.wadi_tarfan.ends.friendly.camp, hostile: versusRules.wadi_tarfan.ends.hostile.camp });
    const m = shipped.find((s) => s.doc.map === 'milh_flats')!.doc.camps!;
    // 48x48: tile (x, y) maps to (47 - x, 47 - y), so a 2x2 at (x, y) maps to (46 - x, 46 - y).
    expect(m.hostile.at).toEqual([46 - m.friendly.at[0], 46 - m.friendly.at[1]]);
  });

  it('points zones come in the map\'s point-symmetric pairs, so both seats are offered the same ground', () => {
    for (const s of shipped) {
      const mapJson = (maps as unknown as Record<string, { zones: Record<string, number[]>; width: number }>)[s.doc.map];
      const rects = mapJson.zones;
      const pts = s.doc.modes.points!;
      const centre = (n: string): [number, number] => [rects[n][0] + rects[n][2] / 2, rects[n][1] + rects[n][3] / 2];
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

  it('no camp tile is a tile the placed force spawns on', () => {
    for (const { doc } of shipped) {
      const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map: doc.map, mode: 'versus', seats: [0, 1].map((s) => ({ seat: s, side: s, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' })), pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, winMode: 'camp' } as never) as MatchConfig;
      const w = buildMatchWorld(c);
      const occupied = new Set<string>();
      for (const ids of w.bySide) for (const i of ids) occupied.add(`${Math.floor(w.sim.state.posX[i] / 65536)},${Math.floor(w.sim.state.posY[i] / 65536)}`);
      for (const end of ['friendly', 'hostile'] as const) {
        const camp = doc.camps![end];
        for (let dy = 0; dy < camp.size[1]; dy++) for (let dx = 0; dx < camp.size[0]; dx++) {
          expect(occupied.has(`${camp.at[0] + dx},${camp.at[1] + dy}`), `${doc.map} ${end} camp tile under a unit`).toBe(false);
        }
      }
    }
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
    camps(far).friendly.at = [20, 20];
    expect(only(far).some((f) => /tiles \(Chebyshev\) from the friendly anchor/.test(f))).toBe(true);
    const clash = wt();
    camps(clash).hostile = { at: [7, 7], size: [2, 2] };
    expect(only(clash).some((f) => /the two camps overlap/.test(f))).toBe(true);
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

  it('a mode no code knows, and a deadline', () => {
    const odd = wt();
    (odd.modes as Record<string, unknown>).flag = {};
    expect(only(odd)).toEqual(['data/versus/modes/wadi_tarfan.json: mode "flag" is not one of camp, points']);
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
      { type: 'camp', at: [7, 7], size: [2, 2], side: 0, owner: 0 },
      { type: 'camp', at: [39, 39], size: [2, 2], side: 1, owner: 1 },
    ]);
    expect(zones).toEqual({ camp_yard_friendly: [7, 7, 2, 2], camp_yard_hostile: [39, 39, 2, 2] });
    expect(JSON.stringify(mission)).not.toContain('seconds');
  });

  it('camp: with the sides at the other ends, side 0 razes the camp now at the FRIENDLY end', () => {
    const { mission } = versusModeMissionOf(file(), 'camp', { friendly: 1, hostile: 0 });
    expect(mission.objectives[0]).toEqual({ id: 'raze_camp_0', type: 'raze', primary: true, side: 0, target: campYardZone('friendly') });
    expect(mission.structures.map((s) => [s.side, s.at])).toEqual([[0, [39, 39]], [1, [7, 7]]]);
  });

  it('points: both sides run the same score block, side 0 first', () => {
    const { mission, zones } = versusModeMissionOf(file(), 'points', { friendly: 0, hostile: 1 });
    expect(zones).toEqual({});
    expect(mission.structures).toEqual([]);
    expect(mission.objectives.map((o) => [o.id, o.side])).toEqual([['score_0', 0], ['score_1', 1]]);
    expect(mission.objectives[0].score).toEqual(mission.objectives[1].score);
    expect(mission.objectives[0].score).toEqual(file().modes.points);
  });

  it('refuses a mode the file does not carry', () => {
    const noPoints = { ...file(), modes: { camp: {} } } as VersusModeFileJson;
    expect(() => versusModeMissionOf(noPoints, 'points', { friendly: 0, hostile: 1 })).toThrow(/no points mode/);
    const noCamp = { ...file(), modes: { points: file().modes.points } } as VersusModeFileJson;
    expect(() => versusModeMissionOf(noCamp, 'camp', { friendly: 0, hostile: 1 })).toThrow(/no camp mode/);
  });
});

describe('a win-mode room (buildMatchWorld)', () => {
  const config = (map: string, mode: 'camp' | 'points' | undefined, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'] = ['kdf', 'kdf']): MatchConfig => {
    const sides = factions[0] !== factions[1] && factions[0] === 'sarim' ? [1, 0] : [0, 1];
    const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, ...(mode !== undefined ? { winMode: mode } : {}) } as never);
    if (c === null) throw new Error('bad config');
    return c;
  };

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

  it('a Sarim host is side 1 at the FRIENDLY end: the camp there is side 1\'s, and the room is no economy room', () => {
    const c = config('wadi_tarfan', 'camp', ['sarim', 'kdf']);
    expect(economyRoom(c)).toBe(false);
    expect(economyRoom({ ...c, winMode: undefined })).toBe(true);
    const w = buildMatchWorld(c);
    expect(w.sim.structures.owner[w.sim.structureAt(7, 7)]).toBe(1);
    expect(w.sim.structures.owner[w.sim.structureAt(39, 39)]).toBe(0);
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
    expect(validateConfig({ ...base, winMode: 'flag' })).toBeNull();
    expect(validateConfig({ ...base, mode: 'sandbox' })).toBeNull();
    expect(validateConfig({ ...base })).not.toBeNull();
  });
});

describe('a win-mode room survives a snapshot (a rejoin)', () => {
  // The runtime's score, objective status and completion tick (GH-976 P2) are `ObjectiveState` rows, so the runtime
  // section carries them: this is the proof, on a real room, for each mode, cut mid-race and mid-raze.
  it.each([['wadi_tarfan', 'points'], ['milh_flats', 'points'], ['wadi_tarfan', 'camp']] as const)('%s %s: a fresh world restored from bytes plays on to the same hash and the same score', async (map, mode) => {
    const { encodeSim, restoreSim } = await import('@lions/sim');
    const { matchTick } = await import('../../packages/app/src/net/match-world');
    const { pointsOrder, campOrder, modeConfig } = await import('./backtest/versus-modes');
    const { matchDigest } = await import('@lions/net');
    const cfg = modeConfig(map, mode, 1000);
    const zones = versusModes[map].modes.points?.zones.map((z) => z.zone) ?? [];
    const drive = (w: ReturnType<typeof buildMatchWorld>, t: number): void => {
      if (t % 400 === 0) { if (mode === 'points') pointsOrder(w, zones, -1); else campOrder(w, map, -1); }
      matchTick(w);
    };
    const a = buildMatchWorld(cfg);
    // A camp game is short (a camp stands about two minutes under attack), so its cut and its end come earlier.
    const [cut, end] = mode === 'camp' ? [500, 1100] : [1500, 3500];
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
  }, 90_000);
});
