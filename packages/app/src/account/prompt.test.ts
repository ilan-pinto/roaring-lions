import { describe, expect, it } from 'vitest';
import { memStorage } from './fixtures';
import { parseWorld } from '@lions/economy';
import worldJson from '../../../../data/campaign/world.json';
import tutorial from '../../../../data/missions/beit_sahwan_0_tutorial.json';
import { markNever, markShown, promptDue, PROMPT_KEY, saveMoment } from './prompt';

const base = { enabled: true, open: true, signedIn: false, moment: 'firstVictory' as const, tutorial: false, pageShown: false };
const due = (storage: Parameters<typeof promptDue>[0]['storage'], over: Partial<Parameters<typeof promptDue>[0]> = {}): boolean =>
  promptDue({ storage, ...base, ...over });
const boom = (): never => {
  throw new Error('blocked');
};

describe('the save prompt rules (A2-13)', () => {
  it('is absent with no moment (the menu at boot) and in the tutorial', () => {
    const s = memStorage();
    expect(due(s, { moment: null })).toBe(false);
    expect(due(s, { tutorial: true })).toBe(false);
  });
  it('is shown at each of the three moments', () => {
    for (const moment of ['firstVictory', 'firstTown', 'campaignDone'] as const) expect(due(memStorage(), { moment })).toBe(true);
  });
  it('is absent when off, closed or signed in', () => {
    const s = memStorage();
    expect(due(s, { enabled: false })).toBe(false);
    expect(due(s, { open: false })).toBe(false);
    expect(due(s, { signedIn: true })).toBe(false);
  });
  it('is absent after three showings', () => {
    const s = memStorage();
    for (let i = 0; i < 3; i++) {
      expect(due(s)).toBe(true);
      markShown(s);
    }
    expect(due(s)).toBe(false);
    expect(JSON.parse(s.map.get(PROMPT_KEY) ?? '')).toEqual({ version: 1, shown: 3, never: false });
  });
  it('"never" stops it for good', () => {
    const s = memStorage();
    markNever(s);
    expect(due(s)).toBe(false);
    expect(JSON.parse(s.map.get(PROMPT_KEY) ?? '')).toMatchObject({ never: true });
  });
  it('a damaged record reads as a fresh one', () => {
    const s = memStorage();
    s.setItem(PROMPT_KEY, '{"version":7,"shown":99}');
    expect(due(s)).toBe(true);
    s.setItem(PROMPT_KEY, 'not json');
    expect(due(s)).toBe(true);
  });
});

describe('the prompt under throwing storage (A1-12, prompt half)', () => {
  const refusing = { getItem: boom, setItem: boom, removeItem: boom };
  it('does not throw and answers by the page alone: at most once per page load', () => {
    expect(due(refusing, { pageShown: false })).toBe(true);
    expect(() => markShown(refusing)).not.toThrow();
    expect(() => markNever(refusing)).not.toThrow();
    expect(due(refusing, { pageShown: true })).toBe(false);
  });
  it('a null storage behaves the same', () => {
    expect(due(null, { pageShown: false })).toBe(true);
    expect(due(null, { pageShown: true })).toBe(false);
  });
  it('still honours the other rules', () => {
    expect(due(refusing, { moment: null })).toBe(false);
    expect(due(refusing, { signedIn: true })).toBe(false);
  });
});

describe('a setItem that throws while getItem works', () => {
  const quota = (): Parameters<typeof promptDue>[0]['storage'] => ({ getItem: () => null, setItem: boom, removeItem: boom });
  it('markShown reports the failure, and the prompt then shows once per page, not on every load', () => {
    const s = quota();
    expect(due(s)).toBe(true);
    const kept = markShown(s);
    expect(kept).toBe(false);
    expect(due(s, { pageShown: true, unpersisted: !kept })).toBe(false);
    expect(due(s, { pageShown: false, unpersisted: !kept })).toBe(true);
  });
  it('a working storage reports true', () => {
    expect(markShown(memStorage())).toBe(true);
  });
});

describe('saveMoment (A2-13): which moment a victory is', () => {
  const world = parseWorld(worldJson);
  const marj = world.regions[0]!;
  const beit = marj.towns[0]!; // 5 missions
  const khan = marj.towns[1]!; // 3 missions, same region
  const led = (ids: readonly string[]) => ({ 'campaign.completed_missions': [...ids] });
  const win = (town: string | undefined, before: readonly string[], add: string, campaign = true, victory = true) =>
    saveMoment(world, town, campaign, victory, led(before), led([...before, add]));

  it('the first campaign mission won is firstVictory', () => {
    expect(win('beit_sahwan', [], beit.missions[0]!)).toBe('firstVictory');
  });
  it('a later win in an unfinished town is nothing', () => {
    expect(win('beit_sahwan', [beit.missions[0]!], beit.missions[1]!)).toBeNull();
  });
  it('the first town finished is firstTown, at the town and not at the end of its region', () => {
    expect(win('beit_sahwan', beit.missions.slice(0, -1), beit.missions.at(-1)!)).toBe('firstTown');
    // Beit is done, the region (Marj) is not: finishing the next town is NOT "the first" again.
    expect(win('khan_rafid', [...beit.missions, ...khan.missions.slice(0, -1)], khan.missions.at(-1)!)).toBeNull();
  });
  it('the last mission of the war is campaignDone, checked first', () => {
    const all = world.regions.flatMap((r) => r.towns.flatMap((t) => [...t.missions]));
    expect(win('wadi_halam', all.slice(0, -1), all.at(-1)!)).toBe('campaignDone');
  });
  it('is null for a defeat, a non-campaign mission and the tutorial', () => {
    expect(win('beit_sahwan', [], beit.missions[0]!, true, false)).toBeNull();
    expect(win('beit_sahwan', [], beit.missions[0]!, false)).toBeNull();
    // The tutorial produces nothing: it does not write completed_missions, so it cannot count toward firstVictory.
    const produces = (tutorial as { ledger: { produces: string[] } }).ledger.produces;
    expect(produces).not.toContain('campaign.completed_missions');
    expect(saveMoment(world, 'beit_sahwan', produces.length > 0, true, led([]), led([]))).toBeNull();
  });
});
