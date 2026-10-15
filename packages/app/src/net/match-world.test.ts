import { describe, expect, it } from 'vitest';
import { validateConfig, type MatchConfig } from '@lions/net';
import { buildMatchWorld } from './match-world';

function config(map: string, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'], seed = 1234): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

describe('buildMatchWorld', () => {
  it('reproduces the mirror pins versus-force.test.ts holds (beit, tel; 200 ticks)', () => {
    // LITERALS (an oracle that imports its expectation from the code under test
    // cannot fail, CLAUDE.md). seed 20260727, 200 ticks, KDF against KDF.
    // tel_marum: 1260439781 is versus-force.test.ts's own pin (re-pinned 14 Oct, GH-420)
    // -- the map has no tunnels, so the helper's world and the browser's agree.
    // beit_sahwan_outskirts: versus-force.test.ts pins 580559085 through
    // `versus-world.test-helper.ts`, which registers NO tunnels. The browser's boot
    // (`bootBattlefield`) registers the map's four routes, and tunnel state is in the
    // hash, so the browser's world -- and so this builder's -- hashes differently.
    // The browser path is the truth; that is its own pin. Registering the prepass's
    // types instead of the raw units moves nothing (checked both ways); the tunnels
    // are the whole difference (drop the loop and this reads 580559085 again).
    for (const [map, pin] of [['beit_sahwan_outskirts', 3043363756], ['tel_marum', 1260439781]] as const) {
      const w = buildMatchWorld(config(map, ['kdf', 'kdf'], 20260727));
      for (let i = 0; i < 200; i++) w.sim.tick();
      expect(w.sim.hash()).toBe(pin);
    }
  });
  it('is a function of the config alone: two builds agree, a different seed differs', () => {
    const a = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
    const b = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
    const c = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim'], 99));
    for (const w of [a, b, c]) for (let i = 0; i < 100; i++) w.sim.tick();
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(c.sim.hash()).not.toBe(a.sim.hash());
  });
  it('spawns each side its faction force on its own anchor', () => {
    const w = buildMatchWorld(config('tel_marum', ['sarim', 'kdf']));
    const types = (ids: number[]) => new Set(ids.map((i) => w.sim.unitTypes[w.sim.state.typeIdx[i]].id));
    expect(types(w.bySide[0]).has('atgm_cell')).toBe(true);
    expect(types(w.bySide[1]).has('mbt_lavi')).toBe(true);
    expect(w.bySide[0].every((i) => w.sim.state.side[i] === 0)).toBe(true);
  });
  it('refuses a sandbox config', () => {
    expect(() => buildMatchWorld({ ...config('tel_marum', ['kdf', 'kdf']), mode: 'sandbox' })).toThrow(/versus/);
  });
});
