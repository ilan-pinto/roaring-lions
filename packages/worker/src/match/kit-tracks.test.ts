import { describe, expect, it } from 'vitest';
import { maxTiers, units } from '@lions/data';
import { TIERS_MAX_TIER, TIERS_MAX_TRACKS, TIERS_MAX_TYPES } from '@lions/net';
import { KIT_TRACKS } from './kit-tracks';

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
