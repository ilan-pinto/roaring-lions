import { describe, it, expect } from 'vitest';
import { factionsOfMatchup, isFactionPair, matchupField, validateConfig, fnv1a32, type MatchConfig } from './config';

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
  it('refuses a missing seat, a non-integer seed, a bad mode and an unknown faction', () => {
    expect(validateConfig({ ...CONFIG, seats: [CONFIG.seats[0]] })).toBeNull();
    expect(validateConfig({ ...CONFIG, seed: 1.5 })).toBeNull();
    expect(validateConfig({ ...CONFIG, mode: 'coop' })).toBeNull();
    expect(validateConfig({ ...CONFIG, seats: [CONFIG.seats[0], { ...CONFIG.seats[1], faction: 'ashwar' }] })).toBeNull();
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
});
