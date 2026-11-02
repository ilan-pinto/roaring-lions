// GH-913 L3: a room's entity capacity is its map's (versus rules `capacity`, default 256).
// `spawn` never reuses a dead slot, so capacity budgets everyone who ever enters the match.
import { describe, expect, it } from 'vitest';
import { doctrines, versusCapacityOf, versusRules, type VersusRulesJson } from '@lions/data';
import { sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { encodeSim, restoreSim } from '@lions/sim';
import { buildMatchWorld, roomCapacity, type MatchWorld } from './match-world';

function config(map: string, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'], seed = 1234): MatchConfig {
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

/** Spawn side-2 bodies (no population against either side's cap) until the sim holds `n` entities (the room's own forces count). */
function fillTo(w: MatchWorld, n: number): void {
  while (w.sim.entityCount < n) w.sim.spawn(0, 2, 0, 0);
}

const BUILD_UNIT = doctrines.kdf.menu[0];

describe('versusCapacityOf', () => {
  const base = versusRules.wadi_tarfan;
  it('is 256 when the file says nothing, and for a map with no rules file', () => {
    expect(versusCapacityOf(base)).toBe(256);
    expect(versusCapacityOf(undefined)).toBe(256);
  });
  it('is the file\'s value in range, and a throw outside the schema\'s 256..1024', () => {
    const at = (capacity: number): VersusRulesJson => ({ ...base, capacity });
    expect(versusCapacityOf(at(512))).toBe(512);
    expect(versusCapacityOf(at(1024))).toBe(1024);
    for (const bad of [255, 1025, 0, -1, 300.5, Number.NaN]) expect(() => versusCapacityOf(at(bad)), String(bad)).toThrow(/capacity/);
  });
});

describe('the shipped capacities (literals)', () => {
  it('rujm_sawda, wadi_tarfan_l and milh_flats_l are 512 and every other rules file is the default 256', () => {
    expect(roomCapacity('rujm_sawda')).toBe(512);
    expect(roomCapacity('wadi_tarfan_l')).toBe(512); // GH-920 B3
    expect(roomCapacity('milh_flats_l')).toBe(512); // GH-920 B3 (Milh Flats (large))
    for (const map of ['tel_marum', 'wadi_tarfan', 'beit_sahwan_outskirts', 'milh_flats']) expect(roomCapacity(map), map).toBe(256);
  });
});

describe('a 256 room builds the world it always built', () => {
  // LITERALS measured on the build before this change (and so on the default path now): world hash and
  // runtime digest at tick 0, seed 1234. Nothing here may move with a capacity field that is absent.
  it('capacity 256, and the same tick-0 digest for each shipped matchup', () => {
    // wadi_tarfan re-pinned for GH-945 (seats (11,11)/(36,36) -> (10,10)/(37,37), every tunnel route at capacity 3; the seats and the
    // route state are hashed, the runtime digest is not). Was 886210996 (kdf/kdf) and 2315748974 (kdf/sarim); the digests did not move.
    const pins: [string, ['kdf' | 'sarim', 'kdf' | 'sarim'], number, number][] = [
      ['wadi_tarfan', ['kdf', 'kdf'], 181436852, 0],
      ['wadi_tarfan', ['kdf', 'sarim'], 1484097134, 3577900654],
      ['tel_marum', ['kdf', 'sarim'], 3736181609, 733838646],
    ];
    for (const [map, f, hash, digest] of pins) {
      const w = buildMatchWorld(config(map, f));
      expect(w.sim.capacity, map).toBe(256);
      expect([w.sim.hash(), w.runtime?.digest() ?? 0], `${map} ${f.join('/')}`).toEqual([hash, digest]);
    }
  });
});

describe('a 512 room', () => {
  it('is built at 512 and accepts spawns past 256', () => {
    const w = buildMatchWorld(config('rujm_sawda', ['kdf', 'sarim']));
    expect(w.sim.capacity).toBe(512);
    expect(w.sim.entityCount).toBeLessThan(256);
    fillTo(w, 300);
    expect(w.sim.entityCount).toBe(300);
    expect(() => w.sim.spawn(0, 2, 0, 0)).not.toThrow();
    expect(w.runtime?.buildBlockedReason(BUILD_UNIT)).toBeNull();
  });

  it('refuses a build at 512 with the reason, and a spawn with the sim\'s own error', () => {
    const w = buildMatchWorld(config('rujm_sawda', ['kdf', 'sarim']));
    fillTo(w, 511);
    expect(w.runtime?.buildBlockedReason(BUILD_UNIT)).toBeNull();
    fillTo(w, 512);
    expect(w.sim.entityCount).toBe(512);
    expect(w.runtime?.buildBlockedReason(BUILD_UNIT)).toMatch(/no room on the field/);
    expect(w.runtime?.canBuild(BUILD_UNIT)).toBe(false);
    expect(() => w.sim.spawn(0, 2, 0, 0)).toThrow(/sim at capacity/);
  });

  it('a mirror room on the same map is 512 too: the budget is the map\'s', () => {
    expect(buildMatchWorld(config('rujm_sawda', ['kdf', 'kdf'])).sim.capacity).toBe(512);
  });

  it('a 256 room still refuses at 256, with the same reason', () => {
    const w = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
    fillTo(w, 255);
    expect(w.runtime?.buildBlockedReason(BUILD_UNIT)).toBeNull();
    fillTo(w, 256);
    expect(w.runtime?.buildBlockedReason(BUILD_UNIT)).toMatch(/no room on the field/);
    expect(() => w.sim.spawn(0, 2, 0, 0)).toThrow(/sim at capacity/);
  });

  it('a snapshot taken past 256 restores into a world built from the config: same capacity, same hash', () => {
    const cfg = config('rujm_sawda', ['kdf', 'sarim']);
    const source = buildMatchWorld(cfg);
    fillTo(source, 300);
    for (let i = 0; i < 40; i++) source.sim.tick();
    const raw = encodeSim(source.sim, {}, source.runtime ?? undefined);
    const target = buildMatchWorld(cfg);
    expect(target.sim.capacity).toBe(512);
    restoreSim(target.sim, raw, target.runtime ?? undefined);
    expect(target.sim.capacity).toBe(512);
    expect(target.sim.entityCount).toBe(300);
    expect(target.sim.hash()).toBe(source.sim.hash());
  });
});
