// GH-1102: the population exemption survives a snapshot rejoin. `MissionContext.popExempt` is context, not
// snapshot state, so a rejoining client's world must rebuild the same set from the config alone (`buildMatchWorld`
// fills it as the specials spawn) or its population, and so every build it allows, would differ from the live
// peer's. Two brigade economy rooms where the KDF seat owns every Store special, either seat order: 1,200 ticks with
// builds on the line and a special killed at 600, encode, restore through the rejoin path, then 100 more ticks
// compared on the sim hash and the runtime digest. Written by the PR 1110 sim review.
import { describe, expect, it } from 'vitest';
import { matchDigest, sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { encodeSim, restoreSim } from '@lions/sim';
import { buildMatchWorld, matchTick, type MatchWorld } from './match-world';
import { shippedContentDigest } from './content-digest';
import { restoreForRejoin } from './snapshot-rejoin';

const STORE = ['recon_zikit', 'heli_peten_gunship', 'inf_medic_squad', 'veh_ambulance', 'air_medevac_heli', 'mbt_lavi_camo', 'spg_long_range', 'ugv_recon_dog', 'spg_cluster', 'at_nlos_team', 'inf_grenadier', 'demo_tzav'];
const EVERY = 1200;

function cfg(map: string, kdfSeat: 0 | 1): MatchConfig {
  const factions: ['kdf' | 'sarim', 'kdf' | 'sarim'] = kdfSeat === 0 ? ['kdf', 'sarim'] : ['sarim', 'kdf'];
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'brigade', tiers: {}, unlocks: s === kdfSeat ? STORE : [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'ABCDEF', code: 'ABCDEF', seed: 1234, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0, snapshotEveryTicks: EVERY });
  if (c === null) throw new Error('bad fixture');
  return c;
}
const digestOf = (w: MatchWorld): number => matchDigest(w.sim.hash(), w.runtime?.digest() ?? 0, shippedContentDigest());

describe('GH-1102: popExempt survives a snapshot rejoin in a brigade economy room with specials', () => {
  for (const [map, kdfSeat] of [['wadi_tarfan', 1], ['tel_marum', 0]] as const) {
    it(`${map}, KDF seat ${kdfSeat}`, { timeout: 120_000 }, () => {
      const config = cfg(map, kdfSeat);
      const src = buildMatchWorld(config);
      const rt = src.runtime;
      if (rt === null) throw new Error('not an economy room');
      expect(src.specialsBySide[0].length).toBeGreaterThan(0);
      // Builds on the KDF side so the lines carry reservations, and kill a special later.
      for (let t = 0; t < EVERY; t++) {
        if (t === 5) { rt.requestBuild('inf_squad', 0, 0); rt.requestBuild('at_team', 0, 0); }
        if (t === 600) src.sim.debugKill(src.bySide[0][src.bySide[0].length - 1]);
        matchTick(src);
      }
      const d = digestOf(src);
      const raw = encodeSim(src.sim, { build: config.build, contentDigest: shippedContentDigest() >>> 0, matchId: config.matchId, frameTick: EVERY - 1, matchDigest: d >>> 0 }, rt);
      const got = restoreForRejoin(config, { raw, frameTick: EVERY - 1, matchDigest: d >>> 0 });
      expect(got.ok, got.ok ? '' : got.reason).toBe(true);
      if (!got.ok) return;
      const dst = got.world;
      const drt = dst.runtime;
      if (drt === null) throw new Error('no runtime after restore');
      expect(drt.population(0)).toBe(rt.population(0));
      expect(drt.population(1)).toBe(rt.population(1));
      expect(digestOf(dst)).toBe(digestOf(src));
      let diverged = -1;
      for (let t = 0; t < 100; t++) {
        if (t === 10) { rt.requestBuild('inf_squad', 0, 0); drt.requestBuild('inf_squad', 0, 0); }
        matchTick(src); matchTick(dst);
        if (diverged < 0 && (src.sim.hash() !== dst.sim.hash() || rt.digest() !== drt.digest())) diverged = t;
      }
      expect(diverged).toBe(-1);
      expect(dst.sim.hash()).toBe(src.sim.hash());
      expect(drt.digest()).toBe(rt.digest());
      // And a plain restoreSim onto a second fresh world reads the encoded digest back.
      const third = buildMatchWorld(config);
      restoreSim(third.sim, raw, third.runtime ?? undefined);
      expect(digestOf(third)).toBe(d);
    });
  }
});
