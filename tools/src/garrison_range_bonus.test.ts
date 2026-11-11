// GH-34: which shipped structure types author their own garrison range bonus. A literal table, so a data edit that moves a building's reach
// (and with it every garrison fight on a map that has one) fails here and has to be read, measured (`garrison-probes.ts --reach`) and re-pinned.
import { describe, expect, it } from 'vitest';
import { structures } from '@lions/data';

describe('garrison_range_bonus in data/structures.json', () => {
  const authored = Object.fromEntries(
    Object.entries(structures as Record<string, { garrison_range_bonus?: number }>)
      .filter(([, s]) => s.garrison_range_bonus !== undefined)
      .map(([id, s]) => [id, s.garrison_range_bonus])
  );
  it('only the apartment block authors one (2 tiles); every other type keeps the global tile', () => {
    expect(authored).toEqual({ apartment: 2 });
  });
  it('only a garrisonable type authors one', () => {
    for (const id of Object.keys(authored)) expect((structures as Record<string, { garrison_slots: number }>)[id].garrison_slots).toBeGreaterThan(0);
  });
});
