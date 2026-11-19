import { describe, expect, it } from 'vitest';
import { branchedTracks, maxTiers, units } from '@lions/data';
import { TIERS_MAX_TIER, TIERS_MAX_TRACKS, TIERS_MAX_TYPES } from '@lions/net';
import { KIT_BRANCHES, KIT_TRACKS } from './kit-tracks';

/** Every KDF type's tracks at their maximum tier, read from the data. */
function fromData(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, u] of Object.entries(units)) {
    if ((u as { faction?: string }).faction !== 'kdf') continue;
    const m = maxTiers(u as Parameters<typeof maxTiers>[0]);
    if (Object.keys(m).length > 0) out[id] = m;
  }
  return out;
}

describe('the kit tracks a seat may claim', () => {
  it('are exactly @lions/data\'s KDF types and their tracks at maximum tier, both ways', () => {
    const data = fromData();
    expect(KIT_TRACKS, `paste into kit-tracks.ts:\n${JSON.stringify(data, null, 2)}`).toEqual(data);
  });
  it('no type outside the KDF carries a track, so nothing is left out of the table', () => {
    for (const [id, u] of Object.entries(units)) {
      if ((u as { faction?: string }).faction === 'kdf') continue;
      expect(maxTiers(u as Parameters<typeof maxTiers>[0]), id).toEqual({});
    }
  });
  it('fits inside the bounds validateConfig puts on a seat\'s tiers', () => {
    expect(Object.keys(KIT_TRACKS).length).toBeLessThanOrEqual(TIERS_MAX_TYPES);
    for (const [id, tracks] of Object.entries(KIT_TRACKS)) {
      expect(Object.keys(tracks).length, id).toBeLessThanOrEqual(TIERS_MAX_TRACKS);
      for (const max of Object.values(tracks)) expect(max, id).toBeLessThanOrEqual(TIERS_MAX_TIER);
    }
  });
});

/** GH-1384: every KDF type's branched tracks, read from the data. */
function branchesFromData(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, u] of Object.entries(units)) {
    if ((u as { faction?: string }).faction !== 'kdf') continue;
    const b = branchedTracks(u as Parameters<typeof branchedTracks>[0]);
    if (b.length > 0) out[id] = [...b];
  }
  return out;
}

describe('the branched tracks a seat may pick on (GH-1384)', () => {
  it('are exactly @lions/data\'s KDF types and their branched tracks, both ways', () => {
    const data = branchesFromData();
    const table = Object.fromEntries(Object.entries(KIT_BRANCHES).map(([id, t]) => [id, [...t].sort()]));
    expect(table, `paste into kit-tracks.ts:\n${JSON.stringify(data, null, 2)}`).toEqual(data);
  });
  it('are the thirteen units of the design, one branched track each today (literal)', () => {
    expect(Object.keys(KIT_BRANCHES).sort()).toEqual(['apc_eitan', 'apc_kipod', 'at_team', 'dozer_d9', 'heli_peten', 'ifv_namer', 'inf_squad', 'jeep_shoded', 'mbt_lavi', 'mortar_team', 'recon_drone', 'scout_shachaf', 'sniper_team']);
  });
  it('name only tracks the kit table declares, whose LAST tier is the branched one', () => {
    for (const [id, tracks] of Object.entries(KIT_BRANCHES)) {
      for (const track of tracks) {
        expect(KIT_TRACKS[id]?.[track], `${id}.${track}`).toBeGreaterThan(0);
        const tiers = (units as Record<string, { upgrades?: Record<string, { tiers: readonly object[] }> }>)[id].upgrades?.[track]?.tiers ?? [];
        expect(tiers.length, `${id}.${track}`).toBe(KIT_TRACKS[id][track]);
        expect('branches' in (tiers.at(-1) ?? {}), `${id}.${track} last tier`).toBe(true);
        expect(tiers.slice(0, -1).some((t) => 'branches' in t), `${id}.${track} below the last`).toBe(false);
      }
    }
  });
});
