import { describe, expect, it } from 'vitest';

import { unlockReason } from './unlock';

describe('unlockReason', () => {
  it('returns null when there is no gate at all', () => {
    expect(unlockReason(undefined, {})).toBe(null);
  });

  it('names the floor it wants when the campaign rating is too low', () => {
    const why = unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 20, b: 40 } });
    expect(why).toContain('45');
  });

  it('distinguishes no rating yet from a low rating', () => {
    expect(unlockReason({ roeMin: 45 }, {})).toContain('no missions rated yet');
  });

  it('passes when the average reaches the floor exactly, without dividing', () => {
    // 40 + 50 = 90, floor 45, two missions: 90 >= 45*2. Compared as integers, because
    // this package bans floating point -- and the comparison is exact, where a
    // truncated mean would have rejected a legitimately passing campaign.
    expect(unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 40, b: 50 } })).toBe(null);
  });

  it('rejects one point below the floor, where a truncating mean would have passed it', () => {
    // 44 + 45 = 89 < 90. A `(89/2)|0` mean is 44, so both agree here -- but 45+46=91
    // averages to 45 exactly and must pass.
    expect(unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 44, b: 45 } })).not.toBe(null);
    expect(unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 45, b: 46 } })).toBe(null);
  });

  it('honours a legacy save that has a bare cumulative rating and no map', () => {
    expect(unlockReason({ roeMin: 45 }, { 'roe.cumulative_rating': 60 })).toBe(null);
    expect(unlockReason({ roeMin: 45 }, { 'roe.cumulative_rating': 31 })).not.toBe(null);
  });

  it('names the actual figure on a legacy save that is below the floor', () => {
    const why = unlockReason({ roeMin: 45 }, { 'roe.cumulative_rating': 31 });
    expect(why).toContain('45');
    expect(why).toContain('31');
    expect(why).not.toContain('no missions rated yet');
  });

  it('says nothing about a figure once per-mission ratings exist, since the shell shows it', () => {
    const why = unlockReason({ roeMin: 45 }, { 'roe.mission_ratings': { a: 20 } });
    expect(why).toContain('45');
    expect(why).not.toContain('no missions rated yet');
  });

  it('names the mission that has not been cleared', () => {
    const why = unlockReason({ afterMission: 'beit_sahwan_3_clearance' }, {});
    expect(why).toContain('beit_sahwan_3_clearance');
  });

  it('passes once that mission is in the completed list', () => {
    const done = { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] };
    expect(unlockReason({ afterMission: 'beit_sahwan_3_clearance' }, done)).toBe(null);
  });

  it('reports the ROE gate first when both gates fail, since it is the harder one to fix', () => {
    const why = unlockReason(
      { roeMin: 60, afterMission: 'beit_sahwan_3_clearance' },
      { 'roe.mission_ratings': { a: 10 } }
    );
    expect(why).toContain('60');
  });

  it('survives a ledger holding junk of the wrong type', () => {
    const junk = { 'campaign.completed_missions': 'not an array' } as unknown as Parameters<typeof unlockReason>[1];
    expect(unlockReason({ afterMission: 'x' }, junk)).toContain('x');
  });
});
