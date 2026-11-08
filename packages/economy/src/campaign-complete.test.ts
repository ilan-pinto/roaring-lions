import { describe, expect, it } from 'vitest';
import { campaignComplete } from './campaign-complete';
import type { ParsedWorld } from './world';

const town = (id: string, missions: string[]) => ({ id, name: id, at: [0, 0] as const, missions });
const region = (id: string, missions: string[], unlock?: { afterMission: string }) => ({
  id,
  name: id,
  faction: 'f',
  doctrine: 'd',
  towns: [town(`${id}_t`, missions)],
  ...(unlock ? { unlock } : {}),
});
const world = (second: ReturnType<typeof region>): ParsedWorld => ({
  id: 'w',
  name: 'w',
  art: 'a.svg',
  regions: [region('r1', ['a', 'b']), second],
});
const allDone = { 'campaign.completed_missions': ['a', 'b', 'c'] };

describe('campaignComplete', () => {
  it('is false while a region is gated, even with every mission done', () => {
    expect(campaignComplete(world(region('r2', ['c'], { afterMission: 'never' })), allDone)).toBe(false);
  });
  it('is true once the gate is dropped', () => {
    expect(campaignComplete(world(region('r2', ['c'])), allDone)).toBe(true);
  });
  it('is false with a mission missing, and for a world with no missions', () => {
    expect(campaignComplete(world(region('r2', ['c'])), { 'campaign.completed_missions': ['a', 'b'] })).toBe(false);
    expect(campaignComplete({ id: 'w', name: 'w', art: 'a', regions: [] }, allDone)).toBe(false);
  });
});
