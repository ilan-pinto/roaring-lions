import { describe, it, expect } from 'vitest';
import { FLAG_SETUP_CAP_MINUTES, FLAG_SETUP_MAPS, flagSetupFor, flagSetupRoom, matchCapMinutesOf, matchCapTicksOf, MAP_CAP_MINUTES, MATCH_CAP_MINUTES_DEFAULT, endOfSeat, matchCapMinutes, matchCapTicks, maxLogCmdChars, sidesOfFactions, sidesOfMatchup, FACTION_MATCHUP_MAPS, TIERS_MAX_TIER, TIERS_MAX_TRACKS, TIERS_MAX_TYPES, VERSUS_FAIR_MAPS, factionsOfMatchup, isFactionPair, matchupAllowed, matchupField, validateConfig, fnv1a32, isSnapshotTick, snapshotEvery, versusMapAllowed, winModeAllowed, winModeOpen, winModeRequest, winModesOffered, WIN_MODE_FAIR_FACTION_CELLS, WIN_MODE_FAIR_MAPS, type MatchConfig } from './config';

export const CONFIG: MatchConfig = {
  matchId: 'm1', code: 'ABCDEF', seed: 20260727, map: 'beit_sahwan_outskirts', mode: 'sandbox',
  seats: [
    { seat: 0, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p0', callsign: 'Host', kind: 'human' },
    { seat: 1, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p1', callsign: 'Guest', kind: 'human' },
  ],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: '0.123.1', dataDigest: 0,
};

describe('validateConfig', () => {
  it('accepts the sandbox config and returns it typed', () => {
    expect(validateConfig(JSON.parse(JSON.stringify(CONFIG)))).toEqual(CONFIG);
  });
  it('accepts a Sarim host on side 1 and its KDF guest on side 0 (LD1, N3)', () => {
    const sarimHost: MatchConfig = { ...CONFIG, mode: 'versus', map: 'tel_marum', seats: [
      { ...CONFIG.seats[0], side: 1, faction: 'sarim' }, { ...CONFIG.seats[1], side: 0, faction: 'kdf' },
    ] };
    expect(validateConfig(JSON.parse(JSON.stringify(sarimHost)))).toEqual(sarimHost);
  });
  it('refuses a missing seat, a non-integer seed, a bad mode and an unknown faction', () => {
    expect(validateConfig({ ...CONFIG, seats: [CONFIG.seats[0]] })).toBeNull();
    expect(validateConfig({ ...CONFIG, seed: 1.5 })).toBeNull();
    expect(validateConfig({ ...CONFIG, mode: 'coop' })).toBeNull();
    expect(validateConfig({ ...CONFIG, seats: [CONFIG.seats[0], { ...CONFIG.seats[1], faction: 'ashwar' }] })).toBeNull();
  });
  it("GH-1102: a seat's unlocks are at most 32 strings (SPECIALS_MAX, literal), so a stored config is bounded as the body is", () => {
    const withUnlocks = (unlocks: unknown[]) => ({ ...CONFIG, seats: [{ ...CONFIG.seats[0], unlocks }, CONFIG.seats[1]] });
    expect(validateConfig(withUnlocks(Array.from({ length: 32 }, (_, i) => `u${i}`)))).not.toBeNull();
    expect(validateConfig(withUnlocks(Array.from({ length: 33 }, (_, i) => `u${i}`)))).toBeNull();
    expect(validateConfig(withUnlocks(['demo_tzav', 7]))).toBeNull();
  });
});

describe('validateConfig: SeatConfig.tiers is the account\'s nested per-type shape', () => {
  const withTiers = (tiers: unknown) => ({ ...CONFIG, seats: [{ ...CONFIG.seats[0], kit: 'brigade', tiers }, CONFIG.seats[1]] });
  it('accepts a nested per-type tier map, and still accepts {}', () => {
    expect(validateConfig(withTiers({ mbt_lavi: { armour: 2 } }))?.seats[0].tiers).toEqual({ mbt_lavi: { armour: 2 } });
    expect(validateConfig(withTiers({}))).not.toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: 0, firepower: 3 }, inf_squad: {} }))).not.toBeNull();
  });
  it('refuses the old flat shape', () => {
    expect(validateConfig(withTiers({ mbt_lavi: 2 }))).toBeNull();
  });
  it('refuses a fractional or negative leaf', () => {
    expect(validateConfig(withTiers({ mbt_lavi: { armour: 1.5 } }))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: -1 } }))).toBeNull();
  });
  it('refuses a non-numeric leaf, an array at either level and null', () => {
    expect(validateConfig(withTiers({ mbt_lavi: { armour: '2' } }))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: [2] }))).toBeNull();
    expect(validateConfig(withTiers([]))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: null }))).toBeNull();
  });
  it('is bounded: at most TIERS_MAX_TYPES ids, TIERS_MAX_TRACKS tracks an id, and no leaf above TIERS_MAX_TIER', () => {
    const ids = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`u${i}`, { armour: 1 }]));
    const tracks = (n: number) => ({ mbt_lavi: Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, 1])) });
    expect(validateConfig(withTiers(ids(TIERS_MAX_TYPES)))).not.toBeNull();
    expect(validateConfig(withTiers(ids(TIERS_MAX_TYPES + 1)))).toBeNull();
    expect(validateConfig(withTiers(tracks(TIERS_MAX_TRACKS)))).not.toBeNull();
    expect(validateConfig(withTiers(tracks(TIERS_MAX_TRACKS + 1)))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: TIERS_MAX_TIER } }))).not.toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: TIERS_MAX_TIER + 1 } }))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: Number.MAX_SAFE_INTEGER } }))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: Infinity } }))).toBeNull();
    expect(validateConfig(withTiers({ mbt_lavi: { armour: NaN } }))).toBeNull();
  });
  it('refuses __proto__, constructor and prototype as a key at either level (JSON-parsed, so each is an OWN key)', () => {
    // JSON.parse defines "__proto__" as an own property rather than setting
    // the prototype, so this is the shape a replay file or a stored config
    // really arrives in. Each control beside it is the same text with the
    // key renamed, so the refusal is the key and nothing else.
    const parsed = (text: string) => validateConfig(withTiers(JSON.parse(text)));
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(parsed(`{"${key}": {"armour": 1}}`), `type ${key}`).toBeNull();
      expect(parsed(`{"mbt_lavi": {"${key}": 1}}`), `track ${key}`).toBeNull();
    }
    expect(parsed('{"proto": {"armour": 1}}')).not.toBeNull();
    expect(parsed('{"mbt_lavi": {"constructors": 1}}')).not.toBeNull();
    // An own "__proto__" really is an own key here (not a prototype set).
    expect(Object.keys(JSON.parse('{"__proto__": {"armour": 1}}'))).toEqual(['__proto__']);
  });
});

describe('fnv1a32', () => {
  it('is the standard FNV-1a of the UTF-8 bytes', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5 | 0);
    expect(fnv1a32('a')).toBe(0xe40c292c | 0);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968 | 0);
  });
});

describe('the versus matchup (2026-10-14, KDF vs Sarim)', () => {
  it('the host\'s pick names each seat\'s faction; the guest gets the other', () => {
    expect(factionsOfMatchup('kdf')).toEqual(['kdf', 'sarim']);
    expect(factionsOfMatchup('sarim')).toEqual(['sarim', 'kdf']);
    expect(factionsOfMatchup('mirror')).toEqual(['kdf', 'kdf']);
  });

  it('LD1 (N3): the KDF seat is side 0 in a faction pairing, whichever seat hosts; a mirror is seat s on side s', () => {
    expect(sidesOfMatchup('sarim')).toEqual([1, 0]);
    expect(sidesOfMatchup('kdf')).toEqual([0, 1]);
    expect(sidesOfMatchup('mirror')).toEqual([0, 1]);
    expect(sidesOfFactions(['sarim', 'kdf'])).toEqual([1, 0]);
    expect(sidesOfFactions(['kdf', 'sarim'])).toEqual([0, 1]);
    expect(sidesOfFactions(['kdf', 'kdf'])).toEqual([0, 1]);
    expect(sidesOfFactions(['sarim', 'sarim'])).toEqual([0, 1]);
  });

  it('the spawn end follows the SEAT: the host stands on the friendly anchor whatever it picked', () => {
    expect(endOfSeat(0)).toBe('friendly');
    expect(endOfSeat(1)).toBe('hostile');
  });

  it('anything a client sends that is not kdf or sarim is the mirror', () => {
    for (const v of [undefined, null, '', 'KDF', 'ashwar', 1, {}]) expect(matchupField(v)).toBe('mirror');
    expect(matchupField('kdf')).toBe('kdf');
    expect(matchupField('sarim')).toBe('sarim');
  });

  it('a faction pair is exactly two known factions', () => {
    expect(isFactionPair(['kdf', 'sarim'])).toBe(true);
    expect(isFactionPair(['kdf'])).toBe(false);
    expect(isFactionPair(['kdf', 'rif'])).toBe(false);
    expect(isFactionPair('kdf,sarim')).toBe(false);
  });

  it('KDF vs Sarim is Tel Marum, Wadi Tarfan and Wadi Tarfan (large) only; the mirror plays anywhere (the lead, 2026-10-14)', () => {
    // Was ['tel_marum', 'wadi_tarfan']: Wadi Tarfan (large) joined at GH-920 B7 (both faction cells inside 60/40 at its seats).
    expect([...FACTION_MATCHUP_MAPS]).toEqual(['tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']);
    for (const map of ['tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']) {
      expect(matchupAllowed('sarim', map), map).toBe(true);
      expect(matchupAllowed('kdf', map), map).toBe(true);
    }
    // Milh Flats is mirror-only: Sarim on its west seat lost 33 of 48 in the probe.
    // Rujm Sawda (GH-913 L8) is mirror-only too: its KDF-v-Sarim cells read KDF 66-74% and the tunnels cell ~96%.
    for (const map of ['beit_sahwan_outskirts', 'milh_flats', 'rujm_sawda', 'qarn_hadid', '']) {
      expect(matchupAllowed('kdf', map)).toBe(false);
      expect(matchupAllowed('sarim', map)).toBe(false);
      expect(matchupAllowed('mirror', map)).toBe(true);
    }
  });

  it('a versus room is offered only on the maps measured close to even (the lead, 2026-10-14, #561)', () => {
    // Was five maps; Wadi Tarfan (large) is the sixth and Milh Flats (large) the seventh (GH-920 B7). The faction list below stays at three.
    expect([...VERSUS_FAIR_MAPS]).toEqual(['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l']);
    for (const map of VERSUS_FAIR_MAPS) expect(versusMapAllowed(map)).toBe(true);
    // Every other shipped map, a tile study, and things that are not a map id at all.
    for (const map of ['qarn_hadid', 'wadi_halam_basin', 'deir_amun', 'umm_zeitoun', 'khan_rafid', 'marj_perimeter', 'tel_marum_3', 'tile_road', 'tutorial_ground', '', '__proto__', 'Tel_Marum']) {
      expect(versusMapAllowed(map), map).toBe(false);
    }
  });

  it('a map KDF can face Sarim on is a fair map too: the narrower rule sits inside the wider one', () => {
    for (const map of FACTION_MATCHUP_MAPS) expect(VERSUS_FAIR_MAPS).toContain(map);
  });
});

describe('the per-map match cap (GH-913 L8)', () => {
  it('is 25 minutes on every map but the three large ones, Rujm Sawda, Wadi Tarfan (large) and Milh Flats (large), which get 35', () => {
    expect(MATCH_CAP_MINUTES_DEFAULT).toBe(25);
    // Was { rujm_sawda: 35 }: Wadi Tarfan (large) is 35 minutes too (GH-920 B3, the lead's ruling of 2 Nov: the seats are as far apart).
    expect({ ...MAP_CAP_MINUTES }).toEqual({ rujm_sawda: 35, wadi_tarfan_l: 35, milh_flats_l: 35 }); // milh_flats_l: GH-920 B3, the same seat distance
    for (const map of ['tel_marum', 'wadi_tarfan', 'milh_flats', 'beit_sahwan_outskirts', '', '__proto__', 'constructor', 'toString']) expect(matchCapMinutes(map), map).toBe(25);
    expect(matchCapMinutes(null)).toBe(25);
    expect(matchCapMinutes(undefined)).toBe(25);
    expect(matchCapMinutes('rujm_sawda')).toBe(35);
    expect(matchCapMinutes('wadi_tarfan_l')).toBe(35);
    expect(matchCapMinutes('milh_flats_l')).toBe(35);
  });
  it('in 20 Hz ticks: 30,000 by default, 42,000 on Rujm Sawda', () => {
    expect(matchCapTicks('tel_marum')).toBe(30_000);
    expect(matchCapTicks('rujm_sawda')).toBe(42_000);
  });
  it('scales the command-log character cap with it: 2,000,000 at 25 minutes, 2,800,000 at 35', () => {
    expect(maxLogCmdChars('tel_marum', 2_000_000)).toBe(2_000_000);
    expect(maxLogCmdChars('rujm_sawda', 2_000_000)).toBe(2_800_000);
    expect(maxLogCmdChars(undefined, 2_000_000)).toBe(2_000_000);
  });
});

describe('snapshotEveryTicks (snapshot S3)', () => {
  const withEvery = (v: unknown) => validateConfig({ ...CONFIG, snapshotEveryTicks: v });
  it('is optional: absent, 0 and 1200 are valid with hashEveryTicks 20', () => {
    expect(validateConfig(CONFIG)).not.toBeNull();
    expect(snapshotEvery(CONFIG)).toBe(0);
    expect(withEvery(0)?.snapshotEveryTicks).toBe(0);
    expect(withEvery(1200)?.snapshotEveryTicks).toBe(1200);
    expect(snapshotEvery({ snapshotEveryTicks: 1200 })).toBe(1200);
  });
  it('refuses a non-multiple of the hash cadence, a negative, a fraction, a string and a too-large value', () => {
    expect(withEvery(1210)).toBeNull();
    expect(withEvery(-20)).toBeNull();
    expect(withEvery(1.5)).toBeNull();
    expect(withEvery('1200')).toBeNull();
    expect(withEvery(72_020)).toBeNull();
    expect(withEvery(72_000)).not.toBeNull();
  });
  it('isSnapshotTick is the last tick of each interval, and never when off', () => {
    expect(isSnapshotTick(1199, 1200)).toBe(true);
    expect(isSnapshotTick(2399, 1200)).toBe(true);
    expect(isSnapshotTick(1200, 1200)).toBe(false);
    expect(isSnapshotTick(0, 1200)).toBe(false);
    expect(isSnapshotTick(1199, 0)).toBe(false);
    expect(isSnapshotTick(-1, 1200)).toBe(false);
  });
});

describe('the win mode a lobby offers and the Worker accepts (GH-976 P2, P4)', () => {
  const versus = (map: string, matchup: 'mirror' | 'kdf' | 'sarim' = 'mirror') => ({ mode: 'versus' as const, map, matchup });
  // The oracle is a literal, not a read of the tables under test (GH-976 P4): the seven open maps, and what each plays in each pairing.
  const CAMP_MAPS = ['wadi_tarfan', 'milh_flats', 'wadi_tarfan_l'];
  const SEVEN = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
  // GH-976, 12 Nov (the lead's ruling): points drifted out of 60/40 on these two (71.5% east, 65.3% west) and is delisted until a fresh read.
  const POINTS_DELISTED = ['beit_sahwan_outskirts', 'rujm_sawda'];
  const FLAG_MAPS = ['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];
  it('offers points on five of the seven open maps in the mirror (GH-976 P4; two delisted 12 Nov), the camp on wadi_tarfan, milh_flats and wadi_tarfan_l, the flag on the five staged maps (12 Nov relist), and nothing else anywhere', () => {
    for (const map of SEVEN) {
      const want = [...(CAMP_MAPS.includes(map) ? ['camp'] : []), ...(POINTS_DELISTED.includes(map) ? [] : ['points']), ...(FLAG_MAPS.includes(map) ? ['flag'] : [])];
      expect(winModesOffered(map), map).toEqual(want);
    }
    expect([...WIN_MODE_FAIR_MAPS.points]).toEqual(['tel_marum', 'wadi_tarfan', 'milh_flats', 'wadi_tarfan_l', 'milh_flats_l']);
    // camp failed the passive-seat bar at its first camps; moved forward it passes on milh_flats (GH-976) and, with wipe after_camp, on wadi_tarfan and wadi_tarfan_l (5 Nov; config.ts); milh_flats_l, rujm_sawda and tel_marum stay out; a map that is not open has no mode file
    for (const map of ['qarn_hadid', 'tel_marum_1', 'tutorial_ground', 'nowhere', '']) expect(winModesOffered(map), map).toEqual([]);
    for (const map of SEVEN) expect(winModeAllowed('camp', map), map).toBe(CAMP_MAPS.includes(map));
  });
  it('GH-976, 12 Nov: points is refused on the two delisted maps (lobby and Worker) and every other mode they keep is still offered', () => {
    for (const map of POINTS_DELISTED) {
      expect(winModesOffered(map), map).not.toContain('points');
      expect(winModeAllowed('points', map), map).toBe(false);
      expect(winModeRequest('points', versus(map)).refused, map).toBe('win mode not offered on this map');
      // annihilation (no mode) is still a legal room there, and the maps are still open versus maps
      expect(winModeRequest('annihilation', versus(map)), map).toEqual({ mode: undefined });
      expect(VERSUS_FAIR_MAPS, map).toContain(map);
    }
    // a mode that stays is still offered where it was: camp has no cell on either, so none is lost; the others keep points
    expect(winModeRequest('points', versus('tel_marum'))).toEqual({ mode: 'points' });
  });
  /** Runs `fn` with one faction cell added to the table, and takes it out again, also on a throw. The table is empty today
   *  (GH-976 P4 review), so the mechanism is exercised with a cell the test adds. */
  const withCell = <T,>(mode: 'points' | 'flag', map: string, hosts: ('kdf' | 'sarim')[], fn: () => T): T => {
    const cells = WIN_MODE_FAIR_FACTION_CELLS[mode] as Record<string, readonly ('kdf' | 'sarim')[]>;
    cells[map] = hosts;
    try { return fn(); } finally { delete cells[map]; }
  };
  it('GH-976 P4: KDF against Sarim is offered nothing on any map today: no cell passed the review', () => {
    expect(WIN_MODE_FAIR_FACTION_CELLS).toEqual({ camp: {}, points: {}, flag: {} });
    for (const map of SEVEN) for (const matchup of ['kdf', 'sarim'] as const) expect(winModesOffered(map, matchup), `${map} ${matchup}`).toEqual([]);
    // A key that merely exists on every object is not a map: the faction table is read as own data.
    for (const map of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(winModeAllowed('points', map, 'kdf'), map).toBe(false);
      expect(winModeAllowed('flag', map, 'sarim'), map).toBe(false);
    }
  });
  it('GH-976 P4: a cell in the faction table is offered to the hosts it names and to no one else', () => {
    withCell('points', 'wadi_tarfan_l', ['kdf'], () => {
      expect(winModesOffered('wadi_tarfan_l', 'kdf')).toEqual(['points']);
      expect(winModesOffered('wadi_tarfan_l', 'sarim')).toEqual([]);
      expect(winModesOffered('wadi_tarfan', 'kdf')).toEqual([]);
      expect(winModeAllowed('flag', 'wadi_tarfan_l', 'kdf')).toBe(false);
      expect(winModeAllowed('points', 'wadi_tarfan_l')).toBe(true);   // the mirror table is its own
      expect(winModeRequest('points', versus('wadi_tarfan_l', 'kdf'))).toEqual({ mode: 'points' });
      expect(winModeRequest('points', versus('wadi_tarfan_l', 'sarim')).refused).toBe('win mode not offered on this map for this matchup');
    });
    expect(winModesOffered('wadi_tarfan_l', 'kdf')).toEqual([]);   // and it is out again
  });
  it('GH-976 relist (12 Nov): flag is offered on exactly the five staged maps in the mirror, with the set-up rules, and nowhere else', () => {
    const FIVE = ['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];   // literals, not the table
    expect(WIN_MODE_FAIR_MAPS.flag).toEqual(FIVE);
    expect(FLAG_SETUP_MAPS).toEqual(FIVE);   // the two lists change together (GH-1139)
    for (const map of FIVE) {
      expect(winModesOffered(map)).toContain('flag');
      expect(winModeRequest('flag', versus(map))).toEqual({ mode: 'flag' });
      expect(flagSetupFor(map, 'flag'), map).toBe(true);
    }
    // Still refused: the two staged-less open maps and the non-lobby maps in the mirror...
    for (const map of ['beit_sahwan_outskirts', 'tel_marum', 'qarn_hadid', 'tel_marum_1']) {
      expect(winModesOffered(map), map).not.toContain('flag');
      expect(winModeAllowed('flag', map), map).toBe(false);
      expect(winModeRequest('flag', versus(map)).refused, map).toBe('win mode not offered on this map');
    }
    // ...and every KDF-v-Sarim cell, on the five too, from either host.
    for (const map of [...FIVE, 'beit_sahwan_outskirts', 'tel_marum']) {
      for (const matchup of ['kdf', 'sarim'] as const) {
        expect(winModesOffered(map, matchup), `${map} ${matchup}`).not.toContain('flag');
        expect(winModeAllowed('flag', map, matchup), `${map} ${matchup}`).toBe(false);
        expect(winModeRequest('flag', versus(map, matchup)).refused, `${map} ${matchup}`).toBe('win mode not offered on this map for this matchup');
      }
    }
    expect(WIN_MODE_FAIR_FACTION_CELLS.flag).toEqual({});
    expect(winModeRequest('flag', { ...versus('wadi_tarfan'), mode: 'sandbox' }).refused).toBe('win mode is for versus rooms');
    // The other modes are untouched by it, and flag is open for a tool that is told it.
    expect(winModeRequest('points', versus('wadi_tarfan_l'))).toEqual({ mode: 'points' });
    expect([winModeOpen('flag'), winModeOpen('points'), winModeOpen('camp')]).toEqual([true, true, true]);
  });
  it('a request is annihilation (no mode), a mode on a fair map in a fair pairing, or a reason', () => {
    for (const none of [undefined, null, 'annihilation']) expect(winModeRequest(none, versus('tel_marum', 'kdf'))).toEqual({ mode: undefined });
    expect(winModeRequest('points', versus('milh_flats'))).toEqual({ mode: 'points' });
    expect(winModeRequest('points', versus('tel_marum'))).toEqual({ mode: 'points' });
    expect(winModeRequest('flag', versus('milh_flats_l'))).toEqual({ mode: 'flag' });   // GH-976 relist
    expect(winModeRequest('flag', versus('tel_marum')).refused).toBe('win mode not offered on this map');
    expect(winModeRequest('rally', versus('milh_flats')).refused).toBe('unknown win mode');
    expect(winModeRequest('', versus('milh_flats')).refused).toBe('unknown win mode');
    expect(winModeRequest('camp', versus('milh_flats'))).toEqual({ mode: 'camp' });
    expect(winModeRequest('camp', versus('wadi_tarfan'))).toEqual({ mode: 'camp' });
    expect(winModeRequest('camp', versus('wadi_tarfan_l'))).toEqual({ mode: 'camp' });
    for (const out of ['milh_flats_l', 'rujm_sawda', 'tel_marum']) expect(winModeRequest('camp', versus(out)).refused, out).toBe('win mode not offered on this map');
    expect(winModeRequest('points', versus('qarn_hadid')).refused).toBe('win mode not offered on this map');
    expect(winModeRequest('points', { ...versus('wadi_tarfan'), mode: 'sandbox' }).refused).toBe('win mode is for versus rooms');
  });
  it('GH-976 P4: the Worker\'s question for a KDF-v-Sarim room is the faction table: every one of the 42 cells is refused today', () => {
    const why = 'win mode not offered on this map for this matchup';
    for (const map of SEVEN) for (const matchup of ['kdf', 'sarim'] as const) for (const mode of ['camp', 'points', 'flag']) {
      expect(winModeRequest(mode, versus(map, matchup)).refused, `${mode} ${map} ${matchup}`).toBe(why);
    }
    // The reasons the mirror and a sandbox give are unchanged.
    expect(winModeRequest('flag', versus('qarn_hadid')).refused).toBe('win mode not offered on this map');
    expect(winModeRequest('points', { ...versus('wadi_tarfan_l', 'kdf'), mode: 'sandbox' }).refused).toBe('win mode is for versus rooms');
  });
  it('a config carries a mode in a versus room only, and one of the known modes', () => {
    const versusConfig = { ...CONFIG, mode: 'versus' as const };
    expect(validateConfig({ ...versusConfig, winMode: 'points' })?.winMode).toBe('points');
    expect(validateConfig({ ...versusConfig, winMode: 'rally' })).toBeNull();
    expect(validateConfig({ ...CONFIG, winMode: 'points' })).toBeNull();
  });
});

describe('capture the flag v2: flagSetup, FLAG_SETUP_MAPS and the cap twin (GH-976 WP4, R0.8, R0.25)', () => {
  const flagRoom = (extra: Record<string, unknown> = {}, map = 'rujm_sawda') => ({ ...CONFIG, mode: 'versus', map, winMode: 'flag', ...extra });
  it('FLAG_SETUP_MAPS is the five staged maps: a flag room there is minted flagSetup, another mode or another map is not', () => {
    expect(FLAG_SETUP_MAPS).toEqual(['wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l']);
    expect(flagSetupFor('rujm_sawda', 'flag')).toBe(true);
    expect(flagSetupFor('rujm_sawda', 'points')).toBeUndefined();
    expect(flagSetupFor('tel_marum', 'flag')).toBeUndefined();
  });
  it('flagSetupFor mints true only for a FLAG room on a listed map (read at call time)', () => {
    const list = FLAG_SETUP_MAPS as string[];
    const before = [...list]; // restored below, never cleared
    list.push('tel_marum');
    try {
      expect(flagSetupFor('tel_marum', 'flag')).toBe(true);
      expect(flagSetupFor('tel_marum', 'points')).toBeUndefined();
      expect(flagSetupFor('tel_marum', null)).toBeUndefined();
      expect(flagSetupFor('beit_sahwan_outskirts', 'flag')).toBeUndefined();
    } finally { list.splice(0, list.length, ...before); }
  });
  it('the cap: 30 minutes (36,000 ticks) in a set-up room on rujm_sawda, 35 without it', () => {
    expect(FLAG_SETUP_CAP_MINUTES).toBe(30);
    expect(matchCapTicksOf({ map: 'rujm_sawda', winMode: 'flag', flagSetup: true })).toBe(36000);
    expect(matchCapTicksOf({ map: 'rujm_sawda', winMode: 'flag' })).toBe(42000);
    expect(matchCapTicksOf({ map: 'rujm_sawda' })).toBe(matchCapTicks('rujm_sawda'));
    // The field alone is not a set-up room: it needs the flag mode as well.
    expect(flagSetupRoom({ winMode: 'points', flagSetup: true })).toBe(false);
    expect(flagSetupRoom({ flagSetup: true })).toBe(false);
    expect(flagSetupRoom({ winMode: 'flag' })).toBe(false);
    expect(flagSetupRoom({ winMode: 'flag', flagSetup: true })).toBe(true);
    expect(matchCapMinutesOf({ map: 'wadi_tarfan_l', winMode: 'flag', flagSetup: true })).toBe(30);
  });
  it('maxLogCmdChars scales by the room\'s cap: 2,400,000 at 30 minutes, 2,800,000 at 35', () => {
    expect(maxLogCmdChars({ map: 'rujm_sawda', winMode: 'flag', flagSetup: true }, 2_000_000)).toBe(2_400_000);
    expect(maxLogCmdChars({ map: 'rujm_sawda', winMode: 'flag' }, 2_000_000)).toBe(2_800_000);
    expect(maxLogCmdChars('rujm_sawda', 2_000_000)).toBe(2_800_000);
  });
  it('validateConfig accepts flagSetup: true in a flag room and keeps it', () => {
    expect(validateConfig(flagRoom({ flagSetup: true }))?.flagSetup).toBe(true);
    expect(validateConfig(flagRoom())?.flagSetup).toBeUndefined();
  });
  it('validateConfig refuses flagSetup without winMode flag, and anything but strictly true (R0.25)', () => {
    expect(validateConfig({ ...CONFIG, mode: 'versus', flagSetup: true })).toBeNull();
    expect(validateConfig(flagRoom({ flagSetup: true, winMode: 'points' }))).toBeNull();
    expect(validateConfig({ ...CONFIG, flagSetup: true, winMode: 'flag' })).toBeNull();
    for (const bad of [1, 'true', false, null, {}, [true]]) expect(validateConfig(flagRoom({ flagSetup: bad })), String(bad)).toBeNull();
  });
});
