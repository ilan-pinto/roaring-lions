// GH-1387 S0: the spend probe's arithmetic and its refusal, on numbers written out by hand (C10, C11). Nothing here runs a mission.
import { describe, expect, it } from 'vitest';
import type { Banking } from './banking';
import { SPEND_BOUND, installRefusal, spendProbeFailures, spendReport, spendRows, type SpendRow, type SpendRun } from './spend-table';

const run = (id: string, b: Banking, o: Partial<SpendRun> = {}): SpendRun => ({ id, result: 'victory', minutes: 6, stars: 2, roe: 80, banking: b, refused: 0, ...o });

describe('spendRows, against a hand recomputation (C10)', () => {
  // beit_sahwan_2_foothold, the design's table: start 400, earned 608, so P 1,008; it ends holding 716, so it spent 292 and banked 71%.
  // 716 / 1008 = 0.7103. khan_rafid_3_clearance: start 400, earned 151, P 551, spent 0, holds all 551: 100%.
  const rows = spendRows([
    run('beit_sahwan_2_foothold', { start: 400, earned: 608, zoneEarned: 300, held: 716 }),
    run('khan_rafid_3_clearance', { start: 400, earned: 151, zoneEarned: 0, held: 551 }),
    run('a_spender', { start: 400, earned: 500, zoneEarned: 0, held: 100 }),
    // 200 / 300 = 66.67%: the report rounds to the nearest whole percent, so it reads 67, not 66.
    run('two_thirds', { start: 300, earned: 0, zoneEarned: 0, held: 200 }),
    run('nothing_to_bank', { start: 0, earned: 0, zoneEarned: 0, held: 0 }),
  ]);
  it('P, spent and the banked percent are the hand figures', () => {
    expect(rows.map((r) => [r.id, r.purse, r.spent, r.bankPct])).toEqual([
      ['beit_sahwan_2_foothold', 1008, 292, 71],
      ['khan_rafid_3_clearance', 551, 0, 100],
      ['a_spender', 900, 800, 11],
      ['two_thirds', 300, 100, 67],
      ['nothing_to_bank', 0, 0, null],
    ]);
  });
  it('over 30% is strict: 71 and 100 are over, 11 is not, and 30.0 exactly is not', () => {
    expect(rows.map((r) => r.over30)).toEqual([true, true, false, true, false]);
    expect(spendRows([run('edge', { start: 100, earned: 0, zoneEarned: 0, held: 30 })])[0]?.over30).toBe(false);
    expect(spendRows([run('edge', { start: 100, earned: 0, zoneEarned: 0, held: 31 })])[0]?.over30).toBe(true);
  });
  it('the report counts them as the design\'s section 2 does', () => {
    const lines = spendReport(rows, false);
    expect(lines[0]).toBe('spend probe (as played, nothing refused): 5 winning-plan runs');
    expect(lines.at(-1)).toBe('spend probe: 3 of 5 bank over 30%, 2 spend nothing, 5 of 5 win');
    expect(lines[1]).toContain('purse  1008  spent   292  bank 71%');
  });
});

describe('the refusal refuses (C11)', () => {
  it('installRefusal makes both spend methods answer false, counts each call, and reports which runtime it was', () => {
    const proto = { requestBuild: () => true, requestSupport: () => true, other: () => 'kept' };
    const seen: string[] = [];
    const count = installRefusal(proto, (_rt, m) => seen.push(m));
    expect([proto.requestBuild(), proto.requestSupport(), proto.requestBuild(), proto.other()]).toEqual([false, false, false, 'kept']);
    expect([count(), seen]).toEqual([3, ['requestBuild', 'requestSupport', 'requestBuild']]);
  });
  it('a runtime with no such method is an error, not a silent no-op', () => {
    expect(() => installRefusal({ requestBuild: () => true }, () => undefined)).toThrow(/no requestSupport/);
  });
  it('a refusal that refused nothing in any run fails the table (the control reading "wins" because the probe did nothing)', () => {
    const rows: SpendRow[] = spendRows([run('a', { start: 1, earned: 0, zoneEarned: 0, held: 1 })]);
    expect(spendProbeFailures(rows, true)).toEqual([expect.stringContaining('refused 0 spend calls')]);
    expect(spendProbeFailures(rows, false)).toEqual([]);
    expect(spendProbeFailures(spendRows([run('a', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { refused: 2 })]), true)).toEqual([]);
  });
});

describe('SPEND_BOUND', () => {
  it('is empty until slice S1 binds the first missions', () => {
    expect([...SPEND_BOUND]).toEqual([]);
  });
  it('a bound mission whose plan still wins with every spend refused fails; one that loses, or is missing, is judged as it should be', () => {
    const won = spendRows([run('m1', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { refused: 3 })]);
    const lost = spendRows([run('m1', { start: 1, earned: 0, zoneEarned: 0, held: 1 }, { refused: 3, result: 'defeat' })]);
    expect(spendProbeFailures(won, true, new Set(['m1']))).toEqual([expect.stringContaining('m1 is bound')]);
    expect(spendProbeFailures(lost, true, new Set(['m1']))).toEqual([]);
    expect(spendProbeFailures(lost, true, new Set(['m2']))).toEqual([expect.stringContaining('m2 is bound but no run')]);
  });
});
