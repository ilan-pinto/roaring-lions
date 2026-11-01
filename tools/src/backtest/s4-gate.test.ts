// The S4 gate's own checks (GH-859 P1b, Task 7). The gate decides whether a formation ships, so what must not
// pass quietly is the gate. Every oracle below is a literal written by hand (the sign-test values were
// computed once, outside the code, with Python's math.comb); nothing is imported from s4-gate.ts but the code
// under test. The gate's main behaviours were each seen red under a one-line mutation of s4-gate.ts (the rerun
// band ignored, the baseline clause ignored, a one-sided sign test, --seed-from ignored, the pairing guard
// removed), listed in the messages of commits 379b05299 and 2a80a3bbd; the other tests here were not mutated one by one.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PER_SEED_SCHEMA, type PerSeedFile, type PerSeedRow } from './per-seed';
import { countsOf, gate, judgeCell, main, signTestP, type EndsCarrying, type GateInput } from './s4-gate';

/** Rows of `n` games from game index `from`, for the pairing `spec`, as the END `end` sees them. The first
 *  `arm - toward` games are won by `end` in both; then `toward` games it wins only in the arm, then `away`
 *  games it wins only in the base; the rest are lost by it in both (to the other end, a third of them drawn). */
interface Spec { n: number; from?: number; end?: 0 | 1; base: number; arm: number; toward: number; away: number }
function pair(s: Spec): { base: PerSeedRow[]; arm: PerSeedRow[] } {
  const end = s.end ?? 0;
  const other = end === 0 ? 1 : 0;
  const from = s.from ?? 0;
  const both = s.arm - s.toward;
  expect(s.base - s.away, 'the table must be consistent: base wins = both + away').toBe(both);
  expect(both + s.toward + s.away, 'the table must fit the seeds').toBeLessThanOrEqual(s.n);
  const base: PerSeedRow[] = [];
  const arm: PerSeedRow[] = [];
  for (let i = 0; i < s.n; i++) {
    const lose = i % 3 === 0 ? null : other;
    const row = (winner: 0 | 1 | null): PerSeedRow => ({ n: from + i, seed: 1000 + 7919 * (from + i), winner, by: 'annihilation', ticks: 1000 + i });
    let b: 0 | 1 | null = lose;
    let a: 0 | 1 | null = lose;
    if (i < both) { b = end; a = end; } else if (i < both + s.toward) { a = end; } else if (i < both + s.toward + s.away) { b = end; }
    base.push(row(b));
    arm.push(row(a));
  }
  return { base, arm };
}

const file = (key: string, rows: PerSeedRow[], formation: PerSeedFile['formation'], over: Partial<PerSeedFile> = {}): PerSeedFile => ({
  schema: PER_SEED_SCHEMA, seedFrom: rows[0]?.n ?? 0, seeds: rows.length, rules: 'room', capSeconds: 600, formation,
  cells: [{ key, map: 'tel_marum', arr: 'kdf/kdf', world: 'placed', rows }], ...over,
});
const FORMED: Record<EndsCarrying, PerSeedFile['formation']> = {
  both: { id: 'attack', ends: [true, true] }, friendly: { id: 'attack', ends: [true, false], looseAir: 'separate' }, hostile: { id: 'attack', ends: [false, true], looseAir: 'separate' },
};
const KEY = 'tel_marum kdf/kdf placed';

/** The gate's verdict on one cell given set A, and set B when there is one. */
function verdictOf(kind: EndsCarrying, a: Spec, b?: Omit<Spec, 'from'>, end?: 0 | 1) {
  const A = pair({ ...a, end });
  const B = b === undefined ? undefined : pair({ ...b, from: a.n, end });
  const input: GateInput = {
    kind,
    baseA: [{ name: 'base-a', file: file(KEY, A.base, null) }],
    armA: [{ name: 'arm-a', file: file(KEY, A.arm, FORMED[kind]) }],
    ...(B === undefined ? {} : { baseB: [{ name: 'base-b', file: file(KEY, B.base, null) }], armB: [{ name: 'arm-b', file: file(KEY, B.arm, FORMED[kind]) }] }),
  };
  const r = gate(input);
  return { r, line: r.lines.find((l) => l.startsWith(KEY)) ?? '', report: r.reports[0] };
}

describe('the sign test', () => {
  // Literals: p = min(1, 2 * sum_{k <= min(a,b)} C(a+b, k) / 2^(a+b)), computed outside the code.
  const cases: [number, number, number][] = [
    [21, 7, 0.012540951371192932],
    [0, 0, 1],
    [5, 0, 0.0625],
    [3, 3, 1],
    [20, 5, 0.004077315330505371],
    [3, 23, 0.00008797645568847656],
    [7, 6, 1],
    [6, 7, 1],
    [4, 0, 0.125],
    [11, 0, 0.0009765625],
  ];
  it('is the exact two-sided binomial test over the discordant seeds', () => {
    expect(cases).toHaveLength(10);
    for (const [a, b, p] of cases) expect(signTestP(a, b), `(${a}, ${b})`).toBeCloseTo(p, 9);
  });
  it('reads 0.0125 at four places for (21, 7), 1 for no discordant seeds, and is symmetric', () => {
    expect(signTestP(21, 7).toFixed(4)).toBe('0.0125');
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(7, 21)).toBe(signTestP(21, 7));
  });
});

describe('countsOf', () => {
  it('counts the discordant seeds toward and away from an end, and the shares', () => {
    const { base, arm } = pair({ n: 30, base: 12, arm: 10, toward: 3, away: 5 });
    expect(countsOf(base, arm, 0)).toEqual({ seeds: 30, base: 12, arm: 10, toward: 3, away: 5 });
    // The other end: its wins are the games end 0 lost to it, the same in both arms, so no flips.
    const o = countsOf(base, arm, 1);
    expect(o.toward - o.away).toBe(o.arm - o.base);
  });
});

describe('the verdict, per cell', () => {
  // Every case is one cell at 192 seeds a set; wins are out of 192. The fourth column is the verdict the
  // lead's ruling reads, written by hand.
  interface Case { name: string; kind: EndsCarrying; a: Spec; b?: Omit<Spec, 'from'>; end?: 0 | 1; verdict: string; set: 'A' | 'A+B'; code: number; p?: string }
  const A = { n: 192 } as const;
  const cases: Case[] = [
    { name: '(b) 74%, flips 21/7: the formation made the cell worse', kind: 'both', a: { ...A, base: 128, arm: 142, toward: 21, away: 7 }, verdict: 'TRIP', set: 'A', code: 1, p: '0.0125' },
    { name: '(b) 54% passes', kind: 'both', a: { ...A, base: 100, arm: 104, toward: 4, away: 0 }, verdict: 'PASS', set: 'A', code: 0 },
    { name: '(b) 105 of 192 (54.7%) passes', kind: 'both', a: { ...A, base: 100, arm: 105, toward: 5, away: 0 }, verdict: 'PASS', set: 'A', code: 0 },
    { name: '(b) 106 of 192 (55.2%) is just over 55: a RERUN', kind: 'both', a: { ...A, base: 100, arm: 106, toward: 6, away: 0 }, verdict: 'RERUN', set: 'A', code: 3 },
    { name: '(b) 58% at set A is a RERUN, not a pass', kind: 'both', a: { ...A, base: 100, arm: 111, toward: 11, away: 0 }, verdict: 'RERUN', set: 'A', code: 3 },
    { name: '(b) 58% at A, 60% at B: pooled 58.9% passes', kind: 'both', a: { ...A, base: 100, arm: 111, toward: 11, away: 0 }, b: { n: 192, base: 100, arm: 115, toward: 15, away: 0 }, verdict: 'PASS', set: 'A+B', code: 0 },
    { name: '(b) 62.5% at A, 61.5% at B: pooled 62% with a 49% base is a TRIP', kind: 'both', a: { ...A, base: 94, arm: 120, toward: 26, away: 0 }, b: { n: 192, base: 94, arm: 118, toward: 24, away: 0 }, verdict: 'TRIP', set: 'A+B', code: 1 },
    { name: '(b) 125 of 192 (65.1%) is over 65, so the baseline clause: a 52% base trips', kind: 'both', a: { ...A, base: 99, arm: 125, toward: 26, away: 0 }, verdict: 'TRIP', set: 'A', code: 1 },
    { name: '(b) base 67% and arm 68%, flips 7/6: outside before, not worse', kind: 'both', a: { ...A, base: 129, arm: 130, toward: 7, away: 6 }, verdict: 'PASS (baseline outside, not worse)', set: 'A', code: 0, p: '1.0000' },
    { name: '(b) base 67% and arm 68%, flips 6/7 the other way', kind: 'both', a: { ...A, base: 130, arm: 129, toward: 6, away: 7 }, verdict: 'PASS (baseline outside, not worse)', set: 'A', code: 0, p: '1.0000' },
    { name: '(b) base 67% and arm 75%, flips 20/5: the formation pushed it', kind: 'both', a: { ...A, base: 129, arm: 144, toward: 20, away: 5 }, verdict: 'TRIP', set: 'A', code: 1, p: '0.0041' },
    { name: '(b) base 80%, arm 70%, flips 3/23: significant, but away from the end: not worse', kind: 'both', a: { ...A, base: 154, arm: 134, toward: 3, away: 23 }, verdict: 'PASS (baseline outside, not worse)', set: 'A', code: 0, p: '0.0001' },
    { name: '(b) base 68%, arm 72%, flips 12/4 (p 0.0768, above 0.05): outside before, not worse', kind: 'both', a: { ...A, base: 130, arm: 138, toward: 12, away: 4 }, verdict: 'PASS (baseline outside, not worse)', set: 'A', code: 0, p: '0.0768' },
    { name: '(b) base 68%, arm 72%, flips 11/2 (p 0.0225, below 0.05): the formation pushed it', kind: 'both', a: { ...A, base: 130, arm: 139, toward: 11, away: 2 }, verdict: 'TRIP', set: 'A', code: 1, p: '0.0225' },
    { name: '(b) 124 of 192 (64.6%) is still the RERUN band', kind: 'both', a: { ...A, base: 100, arm: 124, toward: 24, away: 0 }, verdict: 'RERUN', set: 'A', code: 3 },
    { name: '(b) pooled 230 of 384 (59.9%) passes', kind: 'both', a: { ...A, base: 100, arm: 115, toward: 15, away: 0 }, b: { n: 192, base: 100, arm: 115, toward: 15, away: 0 }, verdict: 'PASS', set: 'A+B', code: 0 },
    { name: '(b) pooled 231 of 384 (60.2%) is over 60: a 52% base trips', kind: 'both', a: { ...A, base: 100, arm: 115, toward: 15, away: 0 }, b: { n: 192, base: 100, arm: 116, toward: 16, away: 0 }, verdict: 'TRIP', set: 'A+B', code: 1 },
    { name: '(b) 57.8% at A, 62.8% pooled: the baseline clause reads the POOLED base (61.7%) and flips (15/11)', kind: 'both', a: { ...A, base: 108, arm: 111, toward: 9, away: 6 }, b: { n: 192, base: 129, arm: 130, toward: 6, away: 5 }, verdict: 'PASS (baseline outside, not worse)', set: 'A+B', code: 0 },
    { name: '(b) a base above 60% but a significant shift toward the end trips even at 66%', kind: 'both', a: { ...A, base: 116, arm: 127, toward: 12, away: 1 }, verdict: 'TRIP', set: 'A', code: 1 },
    { name: '(c) 66% is a RERUN', kind: 'friendly', a: { ...A, base: 100, arm: 127, toward: 27, away: 0 }, verdict: 'RERUN', set: 'A', code: 3 },
    { name: '(c) 71% is a TRIP', kind: 'friendly', a: { ...A, base: 96, arm: 136, toward: 40, away: 0 }, verdict: 'TRIP', set: 'A', code: 1 },
    { name: '(c) 60% exactly (115 of 192 is 59.9) passes', kind: 'friendly', a: { ...A, base: 100, arm: 115, toward: 15, away: 0 }, verdict: 'PASS', set: 'A', code: 0 },
    { name: '(c) 66% at A, 62.5% at B: pooled 64.3% passes against 65', kind: 'friendly', a: { ...A, base: 100, arm: 127, toward: 27, away: 0 }, b: { n: 192, base: 100, arm: 120, toward: 20, away: 0 }, verdict: 'PASS', set: 'A+B', code: 0 },
    { name: '(c) 67.7% at both: pooled 67.7% against 65 with a 52% base is a TRIP', kind: 'friendly', a: { ...A, base: 100, arm: 130, toward: 30, away: 0 }, b: { n: 192, base: 100, arm: 130, toward: 30, away: 0 }, verdict: 'TRIP', set: 'A+B', code: 1 },
    { name: '(c) the baseline clause is against 65: a base of 63% is not outside, even with flips 40/25 (p 0.0817)', kind: 'friendly', a: { ...A, base: 121, arm: 136, toward: 40, away: 25 }, verdict: 'TRIP', set: 'A', code: 1, p: '0.0817' },
    { name: '(c) 71% over a base of 68%, flips 10/4: outside before, not worse', kind: 'friendly', a: { ...A, base: 130, arm: 136, toward: 10, away: 4 }, verdict: 'PASS (baseline outside, not worse)', set: 'A', code: 0, p: '0.1796' },
    { name: '(c) the hostile end formed: 66% is a RERUN, read on end 1', kind: 'hostile', a: { ...A, base: 100, arm: 127, toward: 27, away: 0 }, end: 1, verdict: 'RERUN', set: 'A', code: 3 },
  ];
  it('has the cases the ruling names (a count, so an emptied table cannot pass)', () => {
    expect(cases).toHaveLength(27);
    expect(cases.filter((c) => c.kind === 'both')).toHaveLength(19);
    expect(cases.filter((c) => c.kind !== 'both')).toHaveLength(8);
  });
  for (const c of cases) {
    it(c.name, () => {
      const { r, line, report } = verdictOf(c.kind, c.a, c.b, c.end);
      expect(r.faults).toEqual([]);
      expect(report.verdict).toBe(c.verdict);
      expect(report.set).toBe(c.set);
      expect(r.code).toBe(c.code);
      expect(line).toContain(c.verdict);
      if (c.p !== undefined) expect(line).toContain(`${c.p} `);
    });
  }

  it('prints the cell with its base, share, delta, flips and p to four places', () => {
    const { line } = verdictOf('both', { n: 192, base: 128, arm: 142, toward: 21, away: 7 });
    expect(line).toContain('192 (n 0..191)');
    expect(line).toContain('friendly');
    expect(line).toContain('66.7');
    expect(line).toContain('74.0');
    expect(line).toContain('+7.3');
    expect(line).toContain('21/7');
    expect(line).toContain('0.0125');
  });

  it('(c) reads the FORMED end, not the leading one', () => {
    // End 0 is formed and wins 38 of 192 in the arm; the other end wins 154 (80%) in the arm and 100 (52%)
    // in the base. Read on the leading end this is a TRIP; on the formed end it is 19.8%: a PASS.
    const win = (w: (0 | 1 | null)[]): PerSeedRow[] => w.map((winner, i) => ({ n: i, seed: 1000 + 7919 * i, winner, by: 'annihilation', ticks: 100 }));
    const armRows = win([...Array<0>(38).fill(0), ...Array<1>(154).fill(1)]);
    const baseRows = win([...Array<0>(38).fill(0), ...Array<1>(100).fill(1), ...Array<null>(54).fill(null)]);
    const formed = judgeCell('friendly', { key: KEY, arr: 'kdf/kdf', baseA: baseRows, armA: armRows });
    expect(formed).toMatchObject({ end: 0, verdict: 'PASS' });
    expect(formed.counts.arm).toBe(38);
    const leading = judgeCell('both', { key: KEY, arr: 'kdf/kdf', baseA: baseRows, armA: armRows });
    expect(leading).toMatchObject({ end: 1, verdict: 'TRIP' });
  });
});

describe('the exit code of a table of cells', () => {
  /** Two cells: the first's verdict from `a`, the second's from `b`. */
  function two(kind: EndsCarrying, a: Spec, b: Spec) {
    const x = pair(a);
    const y = pair(b);
    const mk = (rowsA: PerSeedRow[], rowsB: PerSeedRow[], formation: PerSeedFile['formation']): PerSeedFile => ({
      ...file('cell one', rowsA, formation),
      cells: [
        { key: 'cell one', map: 'tel_marum', arr: 'kdf/kdf', world: 'placed', rows: rowsA },
        { key: 'cell two', map: 'wadi_tarfan', arr: 'kdf/sarim', world: 'economy', rows: rowsB },
      ],
    });
    return gate({ kind, baseA: [{ name: 'b', file: mk(x.base, y.base, null) }], armA: [{ name: 'a', file: mk(x.arm, y.arm, FORMED[kind]) }] });
  }
  const pass: Spec = { n: 192, base: 100, arm: 104, toward: 4, away: 0 };
  const rerun: Spec = { n: 192, base: 100, arm: 111, toward: 11, away: 0 };
  const trip: Spec = { n: 192, base: 128, arm: 142, toward: 21, away: 7 };
  it('is 0 when everything passes, 3 for a RERUN still unplayed, and 1 for any TRIP, which outranks a RERUN', () => {
    expect(two('both', pass, pass).code).toBe(0);
    expect(two('both', pass, rerun).code).toBe(3);
    expect(two('both', rerun, trip).code).toBe(1);
    expect(two('both', pass, trip).code).toBe(1);
    expect(two('both', pass, rerun).reports.map((r) => r.verdict)).toEqual(['PASS', 'RERUN']);
  });
  it('closes with a count line that names the exit code', () => {
    const r = two('both', rerun, trip);
    expect(r.lines[r.lines.length - 1]).toBe('S4 gate: 2 cells: 0 PASS, 0 PASS (baseline outside, not worse), 1 RERUN, 1 TRIP -> exit 1');
  });
});

describe('the pairing guard (exit 2)', () => {
  const ok = pair({ n: 192, base: 100, arm: 104, toward: 4, away: 0 });
  const input = (over: Partial<GateInput> = {}): GateInput => ({
    kind: 'both',
    baseA: [{ name: 'base-a', file: file(KEY, ok.base, null) }],
    armA: [{ name: 'arm-a', file: file(KEY, ok.arm, FORMED.both) }],
    ...over,
  });
  it('a well-formed pairing has no fault (so the refusals below are the guard, not the fixture)', () => {
    expect(gate(input()).faults).toEqual([]);
    expect(gate(input()).code).toBe(0);
  });
  it('refuses an arm whose seed list differs from its base\'s, even at the same length', () => {
    const shifted = ok.arm.map((r) => ({ ...r, seed: r.seed + 1 }));
    const r = gate(input({ armA: [{ name: 'arm-a', file: file(KEY, shifted, FORMED.both) }] }));
    expect(r.code).toBe(2);
    expect(r.faults.join('\n')).toContain('seed list differs');
    expect(r.reports).toEqual([]);
  });
  it('refuses an arm that played fewer seeds than its base', () => {
    const r = gate(input({ armA: [{ name: 'arm-a', file: file(KEY, ok.arm.slice(0, 191), FORMED.both) }] }));
    expect(r.code).toBe(2);
    expect(r.faults.join('\n')).toContain('seed list differs');
  });
  it('refuses a base file whose cell list differs from the arm\'s', () => {
    const other = file('wadi_tarfan kdf/kdf placed', ok.base, null);
    const r = gate(input({ baseA: [{ name: 'base-a', file: other }] }));
    expect(r.code).toBe(2);
    expect(r.faults.join('\n')).toContain('cell list differs');
    const both: PerSeedFile = { ...file(KEY, ok.base, null), cells: [...file(KEY, ok.base, null).cells, ...other.cells] };
    expect(gate(input({ baseA: [{ name: 'base-a', file: both }] })).code).toBe(2);
  });
  it('refuses an arm played under a formation other than the one named, and a base played under one', () => {
    expect(gate(input({ armA: [{ name: 'arm-a', file: file(KEY, ok.arm, FORMED.friendly) }] })).code).toBe(2);
    expect(gate(input({ armA: [{ name: 'arm-a', file: file(KEY, ok.arm, null) }] })).code).toBe(2);
    expect(gate(input({ baseA: [{ name: 'base-a', file: file(KEY, ok.base, FORMED.both) }] })).code).toBe(2);
    expect(gate(input({ kind: 'friendly' })).code).toBe(2);
  });
  it('refuses a one-end arm file played before the loose end ordered its aircraft separately, and takes both-ends files as they are', () => {
    const old = { id: 'attack', ends: [true, false] as [boolean, boolean] };
    const one = (arm: PerSeedFile['formation']) => gate(input({ kind: 'friendly', armA: [{ name: 'arm-a', file: file(KEY, ok.arm, arm) }] }));
    expect(one(FORMED.friendly).faults).toEqual([]);
    const r = one(old);
    expect(r.code).toBe(2);
    expect(r.faults.join('\n')).toContain('loose end ordered its aircraft separately');
    expect(gate(input()).faults).toEqual([]);
  });
  it('refuses arm files played under different formations, or under one that is not attack', () => {
    const other = { id: 'column', ends: [true, true] as [boolean, boolean] };
    const b = pair({ n: 192, from: 192, base: 100, arm: 104, toward: 4, away: 0 });
    const setB = { baseB: [{ name: 'base-b', file: file(KEY, b.base, null) }] };
    const armB = (f: PerSeedFile['formation']) => ({ ...setB, armB: [{ name: 'arm-b', file: file(KEY, b.arm, f) }] });
    expect(gate(input(armB(FORMED.both))).code).toBe(0);
    const mixed = gate(input(armB(other)));
    expect(mixed.code).toBe(2);
    expect(mixed.faults.join('\n')).toContain('attack, column');
    const column = gate(input({ armA: [{ name: 'arm-a', file: file(KEY, ok.arm, other) }] }));
    expect(column.code).toBe(2);
    expect(column.faults.join('\n')).toContain('S4 judges attack alone');
  });
  it('refuses a different seat table or cap, no cells, no games, and a cell twice', () => {
    expect(gate(input({ baseA: [{ name: 'base-a', file: file(KEY, ok.base, null, { rules: 'default' }) }] })).code).toBe(2);
    expect(gate(input({ baseA: [{ name: 'base-a', file: file(KEY, ok.base, null, { capSeconds: 300 }) }] })).code).toBe(2);
    expect(gate(input({ baseA: [{ name: 'base-a', file: file(KEY, ok.base, null, { cells: [] }) }], armA: [{ name: 'arm-a', file: file(KEY, ok.arm, FORMED.both, { cells: [] }) }] })).code).toBe(2);
    const noGames = file(KEY, [], null);
    expect(gate(input({ baseA: [{ name: 'base-a', file: noGames }], armA: [{ name: 'arm-a', file: file(KEY, [], FORMED.both) }] })).code).toBe(2);
    const twice = file(KEY, ok.base, null);
    twice.cells.push(twice.cells[0]);
    expect(gate(input({ baseA: [{ name: 'base-a', file: twice }] })).code).toBe(2);
  });
  it('refuses set B games that are set A\'s, or a cell set A never played, or half a set', () => {
    const b = pair({ n: 192, base: 100, arm: 111, toward: 11, away: 0 });
    const overlapping = gate(input({
      baseA: [{ name: 'base-a', file: file(KEY, ok.base, null) }],
      baseB: [{ name: 'base-b', file: file(KEY, b.base, null) }],
      armB: [{ name: 'arm-b', file: file(KEY, b.arm, FORMED.both) }],
    }));
    expect(overlapping.code).toBe(2);
    expect(overlapping.faults.join('\n')).toContain('both sets');
    const later = pair({ n: 192, from: 192, base: 100, arm: 111, toward: 11, away: 0 });
    expect(gate(input({ baseB: [{ name: 'base-b', file: file('wadi_tarfan kdf/kdf placed', later.base, null) }], armB: [{ name: 'arm-b', file: file('wadi_tarfan kdf/kdf placed', later.arm, FORMED.both) }] })).code).toBe(2);
    expect(gate(input({ baseB: [{ name: 'base-b', file: file(KEY, later.base, null) }] })).code).toBe(2);
    expect(gate(input({ baseB: [{ name: 'base-b', file: file(KEY, later.base, null) }], armB: [{ name: 'arm-b', file: file(KEY, later.arm, FORMED.both) }] })).code).toBe(0);
  });
});

describe('the command line', () => {
  let dir = '';
  afterEach(() => { vi.restoreAllMocks(); if (dir !== '') rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const write = (name: string, f: PerSeedFile): string => {
    if (dir === '') dir = mkdtempSync(join(tmpdir(), 's4-gate-'));
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(f));
    return p;
  };
  const run = (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
    return { code: main(args), out: out.join('\n'), err: err.join('\n') };
  };
  const ok = pair({ n: 192, base: 128, arm: 142, toward: 21, away: 7 });

  it('reads files, prints the table and exits 1 on a TRIP with p to four places', () => {
    const base = write('base.json', file(KEY, ok.base, null));
    const arm = write('arm.json', file(KEY, ok.arm, FORMED.both));
    const r = run(['--end=both', `--base-a=${base}`, `--arm-a=${arm}`]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('0.0125');
    expect(r.out).toContain('TRIP');
  });
  it('mismatched seeds exit 2 and print no table', () => {
    const base = write('base.json', file(KEY, ok.base, null));
    const arm = write('arm.json', file(KEY, ok.arm.map((r) => ({ ...r, seed: r.seed + 1 })), FORMED.both));
    const r = run(['--end=both', `--base-a=${base}`, `--arm-a=${arm}`]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('S4 GATE REFUSED');
    expect(r.out).toBe('');
  });
  it('exits 2 on a missing flag, an unreadable file, a malformed file, and an unknown --end', () => {
    expect(run(['--base-a=x', '--arm-a=y']).code).toBe(2);
    expect(run(['--end=both', '--base-a=/nonexistent/a.json', '--arm-a=/nonexistent/b.json']).code).toBe(2);
    const bad = write('bad.json', { ...file(KEY, ok.base, null), schema: 'nope' as typeof PER_SEED_SCHEMA });
    const good = write('good.json', file(KEY, ok.arm, FORMED.both));
    const r = run(['--end=both', `--base-a=${bad}`, `--arm-a=${good}`]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('schema');
    expect(run(['--end=left', `--base-a=${good}`, `--arm-a=${good}`]).code).toBe(2);
  });
  it('merges a comma list of files into one side', () => {
    const one = pair({ n: 192, base: 100, arm: 104, toward: 4, away: 0 });
    const two = { ...file('wadi_tarfan kdf/kdf placed', one.base, null), cells: [{ key: 'wadi_tarfan kdf/kdf placed', map: 'wadi_tarfan', arr: 'kdf/kdf', world: 'placed', rows: one.base }] };
    const twoArm = { ...file('wadi_tarfan kdf/kdf placed', one.arm, FORMED.both), cells: [{ key: 'wadi_tarfan kdf/kdf placed', map: 'wadi_tarfan', arr: 'kdf/kdf', world: 'placed', rows: one.arm }] };
    const r = run(['--end=both', `--base-a=${write('b1.json', file(KEY, one.base, null))},${write('b2.json', two)}`, `--arm-a=${write('a1.json', file(KEY, one.arm, FORMED.both))},${write('a2.json', twoArm)}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('S4 gate: 2 cells: 2 PASS');
  });
});
