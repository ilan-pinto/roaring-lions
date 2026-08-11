import { describe, expect, it } from 'vitest';

import worldJson from '../../../data/campaign/world.json';
import type { LedgerData } from '@lions/sim';
import { campaignRoe, nextMissionAfter, nextMissionOf, parseWorld, regionProgress, townProgress } from './campaign';

const world = parseWorld(worldJson);
const marj = world.regions[0]!;
const sur = world.regions[1]!;
const beitSahwan = marj.towns[0]!;
const ALL_BS = beitSahwan.missions;

describe('parseWorld', () => {
  it('maps snake_case authoring keys onto the runtime spelling', () => {
    expect(sur.unlock?.afterMission).toBe('beit_sahwan_3_clearance');
  });

  it('keeps town positions as a fixed pair', () => {
    expect(beitSahwan.at).toHaveLength(2);
  });

  it('rejects a world whose regions are missing rather than yielding a half object', () => {
    expect(() => parseWorld({ id: 'x', name: 'x', art: 'a.svg' })).toThrow();
  });
});

describe('regionProgress', () => {
  it('is live with nothing done when the first region has no gate', () => {
    const p = regionProgress(marj, {});
    expect(p.status).toBe('live');
    expect(p.done).toBe(0);
    expect(p.lockedBecause).toBe(null);
  });

  it('counts completed missions across all of a region towns', () => {
    const p = regionProgress(marj, { 'campaign.completed_missions': [ALL_BS[0]!] });
    expect(p.done).toBe(1);
    expect(p.total).toBe(ALL_BS.length);
  });

  it('is complete only when every mission of every town is done', () => {
    const p = regionProgress(marj, { 'campaign.completed_missions': [...ALL_BS] });
    expect(p.status).toBe('complete');
    expect(p.done).toBe(p.total);
  });

  it('is locked, and says why, while its gate is unmet', () => {
    const p = regionProgress(sur, {});
    expect(p.status).toBe('locked');
    expect(p.lockedBecause).toContain('beit_sahwan_3_clearance');
  });

  it('opens once the gating mission is cleared', () => {
    const p = regionProgress(sur, { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    expect(p.status).toBe('live');
    expect(p.lockedBecause).toBe(null);
  });

  it('is not complete when it has no missions authored yet, however open it is', () => {
    // Sur's towns are empty until piece 2 authors them. total 0 must not read as
    // "finished", or an unwritten region would show up already greyed out.
    const p = regionProgress(sur, { 'campaign.completed_missions': ['beit_sahwan_3_clearance'] });
    expect(p.total).toBe(0);
    expect(p.status).toBe('live');
  });

  it('ignores completed missions that belong to other regions', () => {
    const p = regionProgress(sur, { 'campaign.completed_missions': [...ALL_BS] });
    expect(p.done).toBe(0);
  });
});

describe('nextMissionOf', () => {
  it('is the first mission when nothing is done', () => {
    expect(nextMissionOf(beitSahwan, {})).toBe(ALL_BS[0]);
  });

  it('skips what is already complete, in authored order', () => {
    expect(nextMissionOf(beitSahwan, { 'campaign.completed_missions': [ALL_BS[0]!] })).toBe(ALL_BS[1]);
  });

  it('returns the first incomplete mission even when a later one was cleared out of order', () => {
    const done = { 'campaign.completed_missions': [ALL_BS[2]!] };
    expect(nextMissionOf(beitSahwan, done)).toBe(ALL_BS[0]);
  });

  it('is null for a finished town, which is how the map knows to stop offering it', () => {
    expect(nextMissionOf(beitSahwan, { 'campaign.completed_missions': [...ALL_BS] })).toBe(null);
  });

  it('is null for a town with no missions authored yet', () => {
    expect(nextMissionOf(sur.towns[0]!, {})).toBe(null);
  });
});

describe('nextMissionAfter', () => {
  it('resolves through the owning town for a mission that is on the map', () => {
    const done = { 'campaign.completed_missions': [ALL_BS[0]!, ALL_BS[1]!] };
    expect(nextMissionAfter(world, ALL_BS[1]!, done)).toBe(ALL_BS[2]);
  });

  it('hands off to the current front when no town owns the finished mission', () => {
    // beit_sahwan_0_tutorial is deliberately not listed under any town -- it teaches
    // the mouse, not the war -- so this exercises the fallback, not the owning-town path.
    expect(nextMissionAfter(world, 'beit_sahwan_0_tutorial', {})).toBe(ALL_BS[0]);
  });

  it('is undefined for the last mission of the last authored town, not a wrap-around', () => {
    const done = { 'campaign.completed_missions': [...ALL_BS] };
    expect(nextMissionAfter(world, ALL_BS[ALL_BS.length - 1]!, done)).toBeUndefined();
  });

  it('still returns the following mission when the ledger already records the one that just finished', () => {
    // This is the shape main.ts actually calls it with -- updatedLedger already has the
    // just-finished mission merged in before nextMissionAfter ever sees it.
    const done = { 'campaign.completed_missions': [ALL_BS[0]!] };
    expect(nextMissionAfter(world, ALL_BS[0]!, done)).toBe(ALL_BS[1]);
  });
});

describe('townProgress', () => {
  it('counts only its own missions', () => {
    const p = townProgress(beitSahwan, { 'campaign.completed_missions': [ALL_BS[0]!, 'unrelated'] });
    expect(p).toEqual({ done: 1, total: ALL_BS.length });
  });
});

describe('campaignRoe', () => {
  it('is null before any mission has been rated', () => {
    expect(campaignRoe({})).toBe(null);
  });

  it('averages the per-mission bests', () => {
    const r = campaignRoe({ 'roe.mission_ratings': { a: 40, b: 80 } });
    expect(r?.mean).toBe(60);
  });

  it('names the worst-rated mission, so a low average is explainable', () => {
    const r = campaignRoe({ 'roe.mission_ratings': { a: 40, b: 80 } });
    expect(r?.worst).toEqual(['a', 40]);
  });

  it('reports no worst mission when only one has been played', () => {
    expect(campaignRoe({ 'roe.mission_ratings': { a: 40 } })?.worst).toBe(null);
  });

  it('falls back to a legacy save with a bare cumulative rating and no map', () => {
    const r = campaignRoe({ 'roe.cumulative_rating': 64 } as LedgerData);
    expect(r?.mean).toBe(64);
    expect(r?.worst).toBe(null);
  });
});
