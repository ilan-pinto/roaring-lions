import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { UnitTypeJson } from '@lions/sim';
import { argOf, engagement, manpadHover, manpadPass, quantile, sf2, summarise, type Tally } from './vehicle-health-probe';

const U = units as unknown as Record<string, UnitTypeJson>;

/**
 * The ONE gate on a report-only probe (GH-560): when a Lavi duels a Lavi, no hull dies with its bar
 * at half or better, and the bar a dead hull showed is low. Under the HP model only hit points
 * destroy a hull, and a penetration costs at most 0.51 of the bar, so a tank that was more than half
 * healthy does not die to one lucky roll. The literals are the design's reading (run C9: 0% luck,
 * median bar 0.07 at 200 seeds), not values imported from the probe.
 *
 * 20 seeds, READING (this branch): 11 deaths, 0 luck deaths, median bar at death 0.03 (the 200-seed
 * median is 0.07). Measured runtime 0.07 s for the duel (0.5 s for the file), so the 30 s timeout
 * below is headroom for a loaded CI box, not a need.
 * The death count is asserted too: a duel that killed nobody would read "0 luck" for nothing.
 * The median bar is implied by luck 0 (every death under 0.5 puts the median under 0.5); it is kept
 * because the plan asks for it, and it is the number that moves first if the model drifts.
 *
 * Falsified by a one-line mutation of rollComponent (see the commit message): a constant 8-weight
 * catastrophic branch that destroys the hull makes luck deaths non-zero and this test red.
 */
describe('vehicle-health probe: the Lavi v Lavi duel', () => {
  it('has no luck deaths and a low bar at death (20 seeds)', () => {
    const t = engagement(U, [{ id: 'mbt_lavi', n: 1, range: 9 }], 20);
    const s = summarise(t);
    expect(s.deaths).toBeGreaterThanOrEqual(5); // 11 read
    expect(s.luckDeaths).toBe(0);
    expect(s.medianBar).toBeLessThan(0.5);
  }, 30_000);
});

/**
 * GH-868 (SF-2): the per-hit HP floor was a flat 34% of the bar for every round that penetrates, so a
 * Peten (640 hp, 15 mm side) died to a technical's DShK in 3 hits: 199/200 in 8.3 s, where main read
 * 110/200 in 13.7 s, and the Remetz killed the same technical in 2.7 s (main 9.6 s). The floor now
 * scales by damage / R below R = 85 (PEN_HP_REF_DAMAGE), so the DShK pays 40/85 of it.
 *
 * 100 seeds, READING (R = 85): technical v Peten side 84/100 killed, ttk median 19.5 s, 6.8 pens/run;
 * technical v Remetz side 100/100, 6.6 s, 7.0 pens/run. The flat floor reads 100/100 in 7.7 s with 3.0
 * pens/run, and 100/100 in 2.9 s with 3.0 pens/run. Every bound below sits between the flat reading
 * and the R = 85 reading, so no committed unit test or balance gate saw the inversion but this one.
 * Upper bounds and the kill-count floor keep R from drifting the other way (R = 125 reads ~50% kills
 * on the Peten row, 9.4 s on the Remetz row; R = 300, 7/200).
 *
 * Falsified by setting PEN_HP_REF_DAMAGE to 1 (the flat-floor equivalent): both tests go red (Peten killed 100 > 95; Remetz median 2.85 s < 4.5 s).
 */
describe('vehicle-health probe: a small round against a light hard hull (GH-868, SF-2)', () => {
  it('technical v Peten (side) is no longer a three-hit kill', () => {
    const r = sf2(U, 'heli_peten', 'technical', 1, 'side', 30, 100);
    const med = r.ttk[r.ttk.length >> 1];
    expect(r.killed).toBeGreaterThanOrEqual(70); // 84 read: a technical still kills a Peten most of the time
    expect(r.killed).toBeLessThanOrEqual(95); // flat floor: 100
    expect(med).toBeGreaterThanOrEqual(15); // 19.5 read; flat 7.7
    expect(med).toBeLessThanOrEqual(25);
    expect(r.pensPerRun).toBeGreaterThanOrEqual(5); // 6.8 read; flat 3.0
  }, 60_000);

  it('technical v Remetz (side) takes more than a couple of seconds', () => {
    const r = sf2(U, 'aa_remetz', 'technical', 1, 'side', 60, 100);
    const med = r.ttk[r.ttk.length >> 1];
    expect(r.killed).toBe(100); // the Remetz still kills it every time
    expect(med).toBeGreaterThanOrEqual(4.5); // 6.6 read; flat 2.9
    expect(med).toBeLessThanOrEqual(8.5); // main 9.6
    expect(r.pensPerRun).toBeGreaterThanOrEqual(5); // 7.0 read; flat 3.0
  }, 60_000);
});

/**
 * GH-868 (the MANPAD half): a Peten is 640 hp and a Yanshuf 760, and a MANPAD hit cost 300 of it, so a lone
 * team needed three hits, and a hit that rolls a mobility kill lands the helicopter first, which takes it
 * out of the air-only MANPAD's reach. A lone team destroyed a hovering Peten 0 times in 200 (43 before PR
 * 866). The lead's 28 Oct ruling made the warhead 420: two hits kill either helicopter.
 *
 * 60 seeds (the first 60 of the 200-seed rows), READING at damage 420: hover 30 s, destroyed Peten v 1 team
 * 18, v 2 teams 45; Yanshuf v 1 15, v 2 40; destroyed-or-grounded Peten v 1 team 37. Firing pass v 3 teams,
 * Peten survives 36. READING at 300: 0, 16, 0, 10, 26 and 51. A one-hit warhead (damage 640) reads
 * 200-seed Peten v 1 hover 170 (about 51 of 60) and pass survival 22% against three, so the upper bounds hold
 * it from overshooting.
 *
 * Falsified by setting manpad_team's damage back to 300 in data/units/enemy/manpad_team.json: the four
 * destroyed floors, the grounded floor and the pass ceiling all go red (see the commit message).
 */
describe('vehicle-health probe: a helicopter against MANPAD teams (GH-868)', () => {
  it('a lone team can destroy a hovering Peten or Yanshuf again; a pair usually does', () => {
    const p1 = manpadHover(U, 'heli_peten', 1, 30, 60);
    const p2 = manpadHover(U, 'heli_peten', 2, 30, 60);
    const y1 = manpadHover(U, 'heli_yanshuf', 1, 30, 60);
    const y2 = manpadHover(U, 'heli_yanshuf', 2, 30, 60);
    expect(p1.destroyed).toBeGreaterThanOrEqual(8); // 18 read; at 300: 0
    expect(p1.destroyed).toBeLessThanOrEqual(30); // a one-hit warhead reads about 51
    expect(p2.destroyed).toBeGreaterThanOrEqual(30); // 45 read; at 300: 16
    expect(y1.destroyed).toBeGreaterThanOrEqual(7); // 15 read; at 300: 0
    expect(y2.destroyed).toBeGreaterThanOrEqual(25); // 40 read; at 300: 10
    expect(p1.downOrDead).toBeGreaterThanOrEqual(32); // 37 read; at 300: 26
    // Destroyed is a subset of destroyed-or-grounded: a count that broke that would read a bigger DD for nothing.
    for (const r of [p1, p2, y1, y2]) expect(r.downOrDead).toBeGreaterThanOrEqual(r.destroyed);
  }, 60_000);

  it('three teams in a firing pass bring a Peten down far more often than at 300', () => {
    const p = manpadPass(U, 'heli_peten', 3, 60);
    expect(p.survives).toBeGreaterThanOrEqual(25); // 36 read; a one-hit warhead reads about 13
    expect(p.survives).toBeLessThanOrEqual(45); // at 300: 51
    expect(p.intact).toBeLessThanOrEqual(p.survives);
  }, 60_000);
});

describe('the instrument', () => {
  const death = (hpShown: number): Tally['deaths'][number] => ({ hpShown, pens: 3, t: 10 });
  const tallyOf = (bars: number[]): Tally => ({
    runs: 1,
    deaths: bars.map(death),
    pens: 0,
    hpEndAlive: [],
    atkLost: 0,
    atkCount: 0,
    extra: {},
  });

  it('counts a death whose bar read 0.5 or more as luck, and 0.49 as not', () => {
    expect(summarise(tallyOf([0.5, 0.49, 0.07])).luckDeaths).toBe(1);
    expect(summarise(tallyOf([0.49, 0.07])).luckDeaths).toBe(0);
  });

  it('reads the median of the bars', () => {
    expect(summarise(tallyOf([0.9, 0.1, 0.2])).medianBar).toBe(0.2);
  });

  it('an empty tally has no median, so the gate cannot pass on it', () => {
    expect(summarise(tallyOf([])).deaths).toBe(0);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });

  it('reads --name=value flags', () => {
    expect(argOf(['--seeds=20', '--tier=max'], 'seeds')).toBe('20');
    expect(argOf(['--seeds=20'], 'tier')).toBeUndefined();
  });
});
