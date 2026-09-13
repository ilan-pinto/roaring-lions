import { describe, expect, it } from 'vitest';

import { resolveUpgrades, starsEarned, unlockReason, type UnlockGate } from './unlock';
import type { LedgerData, MissionJson, PlacementJson } from './mission';

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
    // averages to 45.5 and must pass.
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

  it('reports the Conduct gate first when both gates fail, since it is the harder one to fix', () => {
    const why = unlockReason(
      { roeMin: 60, afterMission: 'beit_sahwan_3_clearance' },
      { 'roe.mission_ratings': { a: 10 } }
    );
    expect(why).toContain('Conduct 60');
  });

  it('survives a ledger holding junk of the wrong type', () => {
    const junk = { 'campaign.completed_missions': 'not an array' } as unknown as Parameters<typeof unlockReason>[1];
    expect(unlockReason({ afterMission: 'x' }, junk)).toContain('x');
  });

  it('sums earned stars with integer addition and gates on them', () => {
    const ledger: LedgerData = { 'campaign.mission_results': { a: { stars: 2, roe: 90, ticks: 1, lost: 0 }, b: { stars: 3, roe: 90, ticks: 1, lost: 0 } } };
    expect(starsEarned(ledger)).toBe(5);
    expect(starsEarned(undefined)).toBe(0);
    expect(unlockReason({ starsMin: 5 }, ledger)).toBe(null);
    expect(unlockReason({ starsMin: 6 }, ledger)).toBe('requires 6 stars (currently 5)');
    expect(unlockReason({ starsMin: 1 }, {})).toBe('requires 1 star (currently 0)');
  });

  it('reports Conduct before stars, and stars before the mission gate', () => {
    const why = unlockReason({ roeMin: 60, starsMin: 9, afterMission: 'x' }, { 'roe.mission_ratings': { a: 10 } });
    expect(why).toContain('Conduct 60');
    const why2 = unlockReason({ starsMin: 9, afterMission: 'x' }, {});
    expect(why2).toBe('requires 9 stars (currently 0)');
  });
});

describe('resolveUpgrades', () => {
  const gates: Record<string, UnlockGate | undefined> = { breach_team: { starsMin: 12 } };
  const unlockOf = (id: string): UnlockGate | undefined => gates[id];
  const mission = {
    id: 'm', starting_force: [
      { unit: 'inf_squad', count: 1, at: [1, 1], upgrades_to: 'breach_team' },
      { unit: 'mbt_lavi', count: 1, at: [2, 2] },
    ],
  } as unknown as MissionJson;

  it('fields the base unit while the gate is closed', () => {
    const out = resolveUpgrades(mission, {}, unlockOf);
    const force = out.starting_force as PlacementJson[];
    expect(force[0].unit).toBe('inf_squad');
    expect('upgrades_to' in force[0]).toBe(false);
  });

  it('fields the upgrade once the gate is open, and never mutates the input', () => {
    const ledger: LedgerData = {
      'campaign.mission_results': {
        a: { stars: 3, roe: 90, ticks: 1, lost: 0 },
        b: { stars: 3, roe: 90, ticks: 1, lost: 0 },
        c: { stars: 3, roe: 90, ticks: 1, lost: 0 },
        d: { stars: 3, roe: 90, ticks: 1, lost: 0 },
      },
    };
    const out = resolveUpgrades(mission, ledger, unlockOf);
    const force = out.starting_force as PlacementJson[];
    expect(force[0].unit).toBe('breach_team');
    expect(force[1].unit).toBe('mbt_lavi');
    expect((mission.starting_force as PlacementJson[])[0].unit).toBe('inf_squad');
  });
});
