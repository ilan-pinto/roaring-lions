import { describe, expect, it } from 'vitest';
import { newMissionLog, type MissionLog } from '../mission-log';
import { afterAction, promotionsBetween, type AfterActionInputs } from './after-action';

const NAMES: Record<string, string> = { inf_squad: 'Rifle Squad', jeep_shoded: 'Shoded Jeep', at_team: 'Spike AT Team' };

function log(): MissionLog {
  const l = newMissionLog();
  l.objectives.push({ tick: 5040, id: 'raze', status: 'complete' }, { tick: 10080, id: 'hold', status: 'complete' });
  l.losses.push(
    { tick: 6800, entity: 7, type: 'inf_squad', name: 'Barzel', veterancy: 1, x: 33, y: 24 },
    { tick: 2600, entity: 9, type: 'jeep_shoded', veterancy: 0, x: 27, y: 42 }
  );
  l.deductions.push({ tick: 2400, reason: 'fire into protected structure (hall_block)', penalty: 5, x: 23, y: 29 }, { tick: 3000, reason: 'civilian casualties', penalty: 3 });
  l.kills = 31;
  return l;
}

/** Wadi Halam V, won on two stars. */
function wh5(over: Partial<AfterActionInputs> = {}): AfterActionInputs {
  return {
    result: 'victory',
    stars: 2,
    roe: 84,
    roeFloor: 60,
    ticks: 8460,
    targetMinutes: 7,
    objectives: [
      { id: 'raze', text: 'Raze the depot inside five minutes', primary: true, carries: false, status: 'complete' },
      { id: 'gate', text: 'Kill or capture whoever is holding the gate', primary: true, carries: false, status: 'complete' },
      { id: 'hold', text: 'Hold the depot for four minutes once it is down', primary: true, carries: false, status: 'complete' },
      { id: 'bleed', text: 'Stay in the field for the first five minutes', primary: false, carries: true, status: 'failed' },
    ],
    log: log(),
    invoice: [{ label: 'Civic hall struck', cause: 'struck', count: 2, total: 10, ticks: [2400, 3100] }],
    withdrew: 6,
    credits: { paid: 220, balance: 1460 },
    promotions: [{ name: 'Tzur', type: 'inf_squad', from: 2, to: 3 }],
    replacements: [{ name: 'Gefen', predecessor: 'Barzel' }],
    unlocks: [{ name: 'Lavi MBT' }, { name: 'Recon Drone' }],
    next: { name: 'Khan Rafid I' },
    typeName: (id) => NAMES[id] ?? id,
    ...over,
  };
}

describe('afterAction (GH-417, H4/H5)', () => {
  it('a win: the reason, the ladder, and three answers', () => {
    const a = afterAction(wh5());
    expect(a.reason).toEqual([
      'Raze the depot inside five minutes · 4:12',
      'Kill or capture whoever is holding the gate',
      'Hold the depot for four minutes once it is down · 8:24',
      '7:03 on the clock, of about 7:00',
    ]);
    expect(a.ladder.map((r) => [r.stars, r.met])).toEqual([[1, true], [2, true], [3, false]]);
    expect(a.ladder[2].text).toBe('Optional objectives that carry forward: 0 of 1');
    expect(a.well.map((w) => w.mark)).toEqual(['4:12', '', '8:24', '84', '31']);
    expect(a.well[1].glyph).toBe('complete');
    expect(a.well[4].text).toBe('31 enemy killed · 6 withdrew');
  });

  // PA-28: losses are people. Falsified: listing `log.losses` by type alone
  // loses "Barzel" and this goes red.
  it('names the fallen, says who took their place, and groups the nameless', () => {
    const poor = afterAction(wh5()).poor;
    const barzel = poor.find((p) => p.person);
    expect(barzel).toMatchObject({ text: 'Barzel · Rifle Squad', sub: 'Lost at 5:40. Gefen takes the place.', person: { type: 'inf_squad', lost: true } });
    expect(poor.map((p) => p.text)).toContain('Shoded Jeep ×1 lost (fresh crew)');
    expect(poor.map((p) => p.text)).toContain('Missed: Stay in the field for the first five minutes');
    expect(poor[0]).toMatchObject({ mark: '−10', text: 'Civic hall struck ×2', sub: '2:00, 2:35' });
  });

  // PA-21: an unlock is something to BUY, not a unit in the next force.
  it('says what changed, in the garage’s words', () => {
    const changed = afterAction(wh5()).changed.map((c) => c.text);
    expect(changed[0]).toBe('Credits paid · brigade now 1460');
    expect(changed).toContain('Tzur ★★ → ★★★');
    expect(changed).toContain('Gefen took Barzel’s place');
    expect(changed).toContain('Can now be bought: Lavi MBT, Recon Drone');
    expect(changed.join(' ')).not.toMatch(/available/);
  });

  it('pins every loss and every deduction that names a place, and only those', () => {
    const pins = afterAction(wh5()).pins;
    expect(pins).toEqual([
      { kind: 'loss', x: 33, y: 24, label: 'Barzel · 5:40' },
      { kind: 'loss', x: 27, y: 42, label: 'Shoded Jeep · 2:10' },
      { kind: 'deduction', x: 23, y: 29, label: '−5 · 2:00' },
    ]);
  });

  it('the third star is met only with Conduct over the floor AND every carrier done', () => {
    const allDone = wh5().objectives.map((o) => ({ ...o, status: 'complete' as const }));
    expect(afterAction(wh5({ objectives: allDone })).ladder[2].met).toBe(true);
    expect(afterAction(wh5({ objectives: allDone, roe: 50 })).ladder.map((r) => r.met)).toEqual([true, false, false]);
    const noCarrier = wh5().objectives.map((o) => ({ ...o, carries: false }));
    expect(afterAction(wh5({ objectives: noCarrier })).ladder[2]).toEqual({ stars: 3, met: false, text: 'No optional objective carries forward on this mission' });
  });

  it('a defeat: the reason, what went wrong, and nothing written', () => {
    const lost = wh5({
      result: 'defeat',
      stars: 0,
      credits: undefined,
      failure: 'Objective failed: Raze the depot inside five minutes · 5:00',
      objectives: wh5().objectives.map((o) => (o.id === 'raze' ? { ...o, status: 'failed' as const } : o.id === 'gate' ? o : { ...o, status: 'active' as const })),
    });
    lost.log.objectives = [{ tick: 6000, id: 'raze', status: 'failed' }];
    const a = afterAction(lost);
    expect(a.reason).toEqual(['Objective failed: Raze the depot inside five minutes · 5:00']);
    expect(a.ladder).toEqual([]);
    expect(a.poor[0]).toMatchObject({ mark: '5:00', text: 'Failed: Raze the depot inside five minutes' });
    expect(a.changed.map((c) => c.text)).toEqual(['Nothing was written to the campaign']);
    // A defeat promotes nobody and unlocks nothing, whatever it was handed
    // (this fixture still carries Tzur's promotion and two unlocks).
    expect(a.changed.some((c) => c.text.includes('Tzur') || c.text.includes('bought'))).toBe(false);
  });
});

describe('promotionsBetween', () => {
  it('matches by slot, and a new body in an old place is not a promotion', () => {
    const before = [
      { slot: 1, name: 'Tzur', type: 'inf_squad', veterancy: 2 },
      { slot: 2, name: 'Barzel', type: 'inf_squad', veterancy: 1 },
      { slot: 3, name: 'Sela', type: 'at_team', veterancy: 1 },
    ];
    const after = [
      { slot: 1, name: 'Tzur', type: 'inf_squad', veterancy: 3 },
      { slot: 2, name: 'Gefen', type: 'inf_squad', veterancy: 2 },
      { slot: 3, name: 'Sela', type: 'at_team', veterancy: 1 },
    ];
    expect(promotionsBetween(before, after)).toEqual([{ name: 'Tzur', type: 'inf_squad', from: 2, to: 3 }]);
  });
});
