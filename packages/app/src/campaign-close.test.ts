// The end of the campaign (polish audit: "no campaign-complete line anywhere").
// Complete is read off world.json and the ledger; the exchange is said once,
// on the victory that finishes the war, and never otherwise.
import { describe, expect, it } from 'vitest';
import worldJson from '../../../data/campaign/world.json';
import { parseWorld, regionProgress } from './campaign';
import { boardRestingLine, campaignComplete, closingExchange } from './campaign-close';
import { t } from './i18n/t';

const world = parseWorld(worldJson);
const all = world.regions.flatMap((r) => r.towns.flatMap((tw) => tw.missions));
const last = all[all.length - 1];
const done = (ids: readonly string[]) => ({ 'campaign.completed_missions': [...ids] });
const allButLast = done(all.slice(0, -1));
const everything = done(all);

describe('campaignComplete', () => {
  it('is true only once every mission on the board is done', () => {
    expect(last).toBe('wadi_halam_5_depot');
    expect(campaignComplete(world, everything)).toBe(true);
    expect(campaignComplete(world, allButLast)).toBe(false);
    expect(campaignComplete(world, {})).toBe(false);
    expect(campaignComplete(world, undefined)).toBe(false);
  });

  it('a world with nothing authored is not complete', () => {
    expect(campaignComplete({ ...world, regions: [] }, everything)).toBe(false);
  });
});

describe('closingExchange', () => {
  it('speaks on the victory that finishes the campaign: Idit, Shai, alternating', () => {
    const lines = closingExchange(world, allButLast, everything, 'victory');
    expect(lines?.map((l) => l.speaker)).toEqual(['idit', 'shai', 'idit', 'shai']);
    expect(lines?.map((l) => l.text)).toEqual([1, 2, 3, 4].map((n) => t(`debrief.closing.${n}`)));
    // Every line is a real catalogue entry, not a key echoed back.
    for (const l of lines ?? []) expect(l.text).not.toMatch(/^debrief\.closing/);
  });

  it('is absent on a defeat, on any other victory, and on a replay after the war is over', () => {
    expect(closingExchange(world, allButLast, allButLast, 'defeat')).toBeNull();
    expect(closingExchange(world, {}, done([all[0]]), 'victory')).toBeNull();
    expect(closingExchange(world, everything, everything, 'victory')).toBeNull();
  });
});

describe('boardRestingLine', () => {
  it('is the click hint while anything is open, and the end of the war once nothing is', () => {
    expect(boardRestingLine(world, allButLast)).toBe(t('world3d.hint'));
    expect(boardRestingLine(world, everything)).toBe(t('world.complete'));
    expect(t('world.complete')).not.toBe('world.complete');
  });
});

describe('the economy campaignComplete agrees with regionProgress on the shipped world', () => {
  const reference = (l: Parameters<typeof campaignComplete>[1]): boolean => {
    const counted = world.regions.filter((r) => regionProgress(r, l).total > 0);
    return counted.length > 0 && counted.every((r) => regionProgress(r, l).status === 'complete');
  };
  const gateMission = 'deir_amun_3_subterranean'; // the after_mission gate of the `sur` region
  const ledgers = {
    zero: done([]),
    one: done(all.slice(0, 1)),
    fifteen: done(all.slice(0, 15)),
    everything,
    'all but the gate': done(all.filter((m) => m !== gateMission)),
  };
  for (const [name, l] of Object.entries(ledgers)) {
    it(`${name}`, () => {
      expect(campaignComplete(world, l)).toBe(reference(l));
    });
  }
  it('the gate mission is a real mission, and its absence blocks completion', () => {
    expect(all).toContain(gateMission);
    expect(campaignComplete(world, ledgers['all but the gate'])).toBe(false);
    expect(campaignComplete(world, everything)).toBe(true);
  });
  it('a shipped region gated on a mission nobody can clear blocks completion even with every mission done', () => {
    const gated = { ...world, regions: world.regions.map((r, i) => (i === 0 ? { ...r, unlock: { afterMission: 'never' } } : r)) };
    expect(campaignComplete(gated, everything)).toBe(false);
    expect(regionProgress(gated.regions[0], everything).status).toBe('locked');
  });
});
