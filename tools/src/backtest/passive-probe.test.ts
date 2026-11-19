import { describe, expect, it } from 'vitest';
import { missions } from '@lions/data/content';
import {
  CHECKPOINTS_S,
  evacuatedAtCheckpoints,
  exitCodeFor,
  formatSummary,
  isWin,
  outcomeOf,
  seedsOf,
  summarise,
  verdictOf,
  type Outcome,
  type SeedRow,
} from './passive-probe-read';
import { civilianMissions, main, probeSeed } from './passive-probe';

/** A synthetic seed: only what a test names differs from a quiet passive loss. */
function row(seed: number, outcome: Outcome, evacuated = 0, over: Partial<SeedRow> = {}): SeedRow {
  return {
    seed,
    outcome,
    cause: outcome === 'defeat' ? 'objective:evac_settlements' : outcome === 'withdrawn' ? 'withdrawn' : undefined,
    endS: 269.9,
    evacuated,
    evacuatedAt: [0, 0, 0, evacuated, evacuated],
    downed: 0,
    killed: 0,
    taken: 0,
    peakLiving: 50,
    lifetime: 60,
    ...over,
  };
}

const losses = (n: number): SeedRow[] => Array.from({ length: n }, (_, k) => row(k + 1, 'defeat'));

describe('passive probe: the reading (synthetic outcomes)', () => {
  it('names one outcome per run, the limit and the cap apart from an objective defeat', () => {
    expect(outcomeOf('victory', undefined)).toBe('victory');
    expect(outcomeOf('defeat', 'objective:evac_settlements')).toBe('defeat');
    expect(outcomeOf('defeat', 'force_destroyed')).toBe('defeat');
    expect(outcomeOf('defeat', 'withdrawn')).toBe('withdrawn');
    expect(outcomeOf('ongoing', undefined)).toBe('stuck');
  });

  it('counts a victory, and only a victory, as a win', () => {
    expect(isWin('victory')).toBe(true);
    expect(isWin('defeat')).toBe(false);
    expect(isWin('withdrawn')).toBe(false);
    expect(isWin('stuck')).toBe(false);
  });

  it('reads 30 quiet losses as HOLDS, one win among them as WINS, one civilian counted in as LEAKS', () => {
    expect(verdictOf(losses(30))).toBe('HOLDS');
    expect(verdictOf([...losses(29), row(30, 'victory', 2)])).toBe('WINS');
    expect(verdictOf([...losses(29), row(30, 'defeat', 1)])).toBe('LEAKS');
    // A win outranks a leak; a run at the cap or by the limit is a loss for the verdict.
    expect(verdictOf([row(1, 'defeat', 1), row(2, 'victory')])).toBe('WINS');
    expect(verdictOf([row(1, 'stuck'), row(2, 'withdrawn')])).toBe('HOLDS');
  });

  it('refuses a verdict over no seeds (an empty sweep passes nothing vacuously)', () => {
    expect(() => verdictOf([])).toThrow(/no seeds/);
    expect(() => summarise('m', 'none', [])).toThrow(/no seeds/);
  });

  it('summarises counts, means, maxima and the winning seeds', () => {
    const s = summarise('m', 'none', [
      row(424242, 'defeat', 0, { downed: 2, peakLiving: 40, lifetime: 70 }),
      row(1, 'victory', 3, { taken: 4, peakLiving: 55, lifetime: 66 }),
      row(2, 'withdrawn', 1, { killed: 3 }),
      row(3, 'stuck'),
    ]);
    expect(s.seeds).toBe(4);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(2);
    expect(s.stuck).toBe(1);
    expect(s.leakSeeds).toBe(2);
    expect(s.evacMean).toBe(1);
    expect(s.evacMax).toBe(3);
    expect(s.downedMean).toBe(0.5);
    expect(s.killedMean).toBe(0.75);
    expect(s.takenMean).toBe(1);
    expect(s.peakLiving).toBe(55);
    expect(s.lifetimeMax).toBe(70);
    expect(s.winSeeds).toEqual([1]);
    expect(s.verdict).toBe('WINS');
    expect([...s.ends.entries()]).toEqual([
      ['defeat:objective:evac_settlements', 1],
      ['victory', 1],
      ['withdrawn', 1],
      ['stuck', 1],
    ]);
    expect(formatSummary(s)).toMatch(/^m \[none\]: WINS -- won 1\/4 \(seeds 1\)/);
  });

  it('gates only when asked, and only on the no-orders control', () => {
    const holds = summarise('a', 'none', losses(30));
    const wins = summarise('b', 'none', [...losses(29), row(30, 'victory')]);
    const leaks = summarise('c', 'none', [...losses(29), row(30, 'defeat', 1)]);
    const naiveWins = summarise('a', 'naive', [row(1, 'victory')]);
    expect(exitCodeFor([holds, wins], false)).toBe(0);
    expect(exitCodeFor([holds], true)).toBe(0);
    expect(exitCodeFor([holds, wins], true)).toBe(1);
    expect(exitCodeFor([holds, leaks], true)).toBe(1);
    expect(exitCodeFor([holds, naiveWins], true)).toBe(0);
  });

  it('reads the cumulative count at 60/120/180/240/300 s off the event ticks (20 Hz)', () => {
    expect(CHECKPOINTS_S).toEqual([60, 120, 180, 240, 300]);
    expect(evacuatedAtCheckpoints([], 20)).toEqual([0, 0, 0, 0, 0]);
    // 1200 is 60 s exactly (counted at 60), 1201 is not; 6001 is past the last checkpoint.
    expect(evacuatedAtCheckpoints([1200, 1201, 3000, 4801, 6001], 20)).toEqual([1, 2, 3, 3, 4]);
  });

  it('sweeps the pinned seed first, then 1.. (SWEEP_SEEDS for 30)', () => {
    expect(seedsOf(1)).toEqual([424242]);
    expect(seedsOf(4)).toEqual([424242, 1, 2, 3]);
    const thirty = seedsOf(30);
    expect(thirty.length).toBe(30);
    expect(thirty[29]).toBe(29);
    expect(() => seedsOf(0)).toThrow();
  });
});

describe('passive probe: on the real sim', () => {
  it('probes every mission with civilians, and only those', () => {
    const set = civilianMissions();
    expect(set).toContain('beit_sahwan_breach');
    expect(set).toContain('beit_sahwan_0_tutorial');
    expect(set).not.toContain('beit_sahwan_2_foothold'); // no civilians block
    expect(set).not.toContain('deir_amun_1_recon');
    expect(set.length).toBeGreaterThanOrEqual(25); // section 3's census; 29 on dev at the time of writing
  });

  it("reads First Light's passive control as a quiet loss on 424242 (the pinned `pnpm playtest` control)", () => {
    const r = probeSeed('beit_sahwan_breach', () => {}, 424242);
    expect(r.outcome).toBe('defeat');
    expect(r.cause).toBe('objective:evac_settlements');
    expect(r.evacuated).toBe(0);
    expect(r.lifetime).toBeGreaterThan(0);
    expect(r.peakLiving).toBeGreaterThan(0);
  }, 60_000);

  // Section 10.2's E11 test, on the shipped mission: a crowd standing INSIDE its own refuge zone counts itself in on
  // the first evaluation (N44), so the passive player wins, and the gated harness exits 1. The fixture moves the
  // north-west village (3 bodies; the primary needs 2) to (24.5, 24.5), inside `compound` [18,17,13,13]; the shipped
  // placement is put back whatever happens.
  it('reads a crowd placed inside its refuge as WINS, and exits 1 under --gate', () => {
    const g = (missions.beit_sahwan_breach as unknown as { civilians: { groups: { at: number[] }[] } }).civilians.groups[0];
    const was = g.at;
    const lines: string[] = [];
    g.at = [24.5, 24.5];
    try {
      // Measured: all three counted in on the first evaluation, so 3 at every checkpoint; the primary completes.
      const r = probeSeed('beit_sahwan_breach', () => {}, 424242);
      expect(r.outcome).toBe('victory');
      expect(r.evacuated).toBe(3);
      expect(r.evacuatedAt).toEqual([3, 3, 3, 3, 3]);
      expect(main(['--missions=beit_sahwan_breach', '--seeds=1', '--gate'], (l) => lines.push(l))).toBe(1);
      expect(main(['--missions=beit_sahwan_breach', '--seeds=1'], () => {})).toBe(0); // report-only
    } finally {
      g.at = was;
    }
    expect(lines.join('\n')).toMatch(/beit_sahwan_breach \[none\]: WINS -- won 1\/1/);
    // And the shipped placement holds, gated.
    expect(main(['--missions=beit_sahwan_breach', '--seeds=1', '--gate'], () => {})).toBe(0);
  }, 60_000);
});
