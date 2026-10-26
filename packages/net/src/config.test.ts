import { describe, it, expect } from 'vitest';
import { endOfSeat, sidesOfFactions, sidesOfMatchup, FACTION_MATCHUP_MAPS, TIERS_MAX_TIER, TIERS_MAX_TRACKS, TIERS_MAX_TYPES, VERSUS_FAIR_MAPS, factionsOfMatchup, isFactionPair, matchupAllowed, matchupField, validateConfig, fnv1a32, isSnapshotTick, snapshotEvery, versusMapAllowed, type MatchConfig } from './config';

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

  it('KDF vs Sarim is Tel Marum and Wadi Tarfan only; the mirror plays anywhere (the lead, 2026-10-14)', () => {
    expect([...FACTION_MATCHUP_MAPS]).toEqual(['tel_marum', 'wadi_tarfan']);
    for (const map of ['tel_marum', 'wadi_tarfan']) {
      expect(matchupAllowed('sarim', map), map).toBe(true);
      expect(matchupAllowed('kdf', map), map).toBe(true);
    }
    // Milh Flats is mirror-only: Sarim on its west seat lost 33 of 48 in the probe.
    for (const map of ['beit_sahwan_outskirts', 'milh_flats', 'qarn_hadid', '']) {
      expect(matchupAllowed('kdf', map)).toBe(false);
      expect(matchupAllowed('sarim', map)).toBe(false);
      expect(matchupAllowed('mirror', map)).toBe(true);
    }
  });

  it('a versus room is offered only on the maps measured close to even (the lead, 2026-10-14, #561)', () => {
    expect([...VERSUS_FAIR_MAPS]).toEqual(['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats']);
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
