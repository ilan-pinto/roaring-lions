// The end of the campaign (polish audit: "no campaign-complete line anywhere").
// Complete is read off world.json and the ledger; the exchange is said once,
// on the victory that finishes the war, and never otherwise.
import { describe, expect, it } from 'vitest';
import worldJson from '../../../data/campaign/world.json';
import { parseWorld } from './campaign';
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
