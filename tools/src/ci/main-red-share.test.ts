import { describe, expect, it } from 'vitest';
import { FILTERED_QUERY_CAP, RED_SHARE_TARGET, fetchRuns, ledgerLine, parseArgs, parseIso, redShare, utcDays, type WorkflowRun } from './main-red-share';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const ago = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();
const run = (over: Partial<WorkflowRun>): WorkflowRun => ({
  status: 'completed', conclusion: 'success', created_at: ago(1), head_branch: 'main', event: 'push', ...over,
});

describe('redShare', () => {
  it('counts red over finished runs: 1 failure in 4 finished is 25%', () => {
    const r = redShare([run({}), run({}), run({}), run({ conclusion: 'failure' })], NOW, 7);
    expect(r).toEqual({ red: 1, green: 3, ignored: 0, share: 0.25 });
  });

  it('timed_out is red; cancelled, skipped and unfinished runs are neither', () => {
    const r = redShare(
      [run({ conclusion: 'timed_out' }), run({ conclusion: 'cancelled' }), run({ conclusion: 'skipped' }), run({ status: 'in_progress', conclusion: null }), run({})],
      NOW, 7,
    );
    expect(r).toEqual({ red: 1, green: 1, ignored: 3, share: 0.5 });
  });

  it('only the window counts: a run 8 days old is out of a 7-day window, 6.9 days old is in, a future run is out', () => {
    const r = redShare([run({ created_at: ago(8), conclusion: 'failure' }), run({ created_at: ago(6.9), conclusion: 'failure' }), run({ created_at: ago(-1), conclusion: 'failure' }), run({})], NOW, 7);
    expect(r.red).toBe(1);
    expect(r.green).toBe(1);
  });

  it('only pushes to main: a pull request run and another branch are not main', () => {
    const r = redShare([run({ event: 'pull_request', conclusion: 'failure' }), run({ head_branch: 'feature', conclusion: 'failure' }), run({})], NOW, 7);
    expect(r).toEqual({ red: 0, green: 1, ignored: 0, share: 0 });
  });

  it('no finished run gives a null share, not 0 or NaN', () => {
    expect(redShare([], NOW, 7).share).toBeNull();
    expect(redShare([run({ status: 'queued', conclusion: null })], NOW, 7).share).toBeNull();
  });
});

describe('ledgerLine', () => {
  it('says the counts, the percentage and which side of the 3% target it is on', () => {
    const over = ledgerLine({ red: 2, green: 29, ignored: 4, share: 2 / 31 }, NOW, 7);
    expect(over).toBe('CI red share on main, 7 days to 2026-11-15: 2 of 31 finished `ci` runs red (6.5%; target under 3%, over).');
    const inside = ledgerLine({ red: 0, green: 31, ignored: 0, share: 0 }, NOW, 7);
    expect(inside).toContain('0 of 31');
    expect(inside).toContain('inside');
    expect(RED_SHARE_TARGET).toBe(0.03);
  });

  it('exactly 3% is not under 3%', () => {
    expect(ledgerLine({ red: 3, green: 97, ignored: 0, share: 0.03 }, NOW, 7)).toContain('over');
  });

  it('an empty window says so', () => {
    expect(ledgerLine({ red: 0, green: 0, ignored: 2, share: null }, NOW, 7)).toContain('no finished `ci` run');
  });
});

describe('utcDays', () => {
  it('lists each UTC date from the first day to the last, inclusive', () => {
    expect(utcDays(Date.parse('2026-11-08T23:59:00Z'), Date.parse('2026-11-10T00:01:00Z'))).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
    expect(utcDays(Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'))).toEqual(['2026-11-15']);
    // A window that ends exactly at midnight still includes that day: a run created at 00:00:00 is inside it.
    expect(utcDays(Date.parse('2026-11-13T05:00:00Z'), Date.parse('2026-11-15T00:00:00Z'))).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
  });
});

describe('fetchRuns', () => {
  const reply = (n: number, total = n): string => JSON.stringify({ total_count: total, workflow_runs: Array.from({ length: n }, () => run({})) });

  it('asks for ci.yml pushes to main ONE DAY at a time, with total_count in the projection', () => {
    const calls: string[] = [];
    const got = fetchRuns('o/r', Date.parse('2026-11-13T05:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), (args) => {
      calls.push(args.join(' '));
      return reply(2);
    });
    expect(got).toHaveLength(6);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => /created=(\S+)/.exec(c)?.[1])).toEqual([
      '2026-11-13T00:00:00Z..2026-11-13T23:59:59Z',
      '2026-11-14T00:00:00Z..2026-11-14T23:59:59Z',
      // The last day ends at `untilMs`, not at midnight: a run created after the report started is outside the range.
      '2026-11-15T00:00:00Z..2026-11-15T12:00:00Z',
    ]);
    for (const c of calls) {
      expect(c).toContain('repos/o/r/actions/workflows/ci.yml/runs');
      expect(c).toContain('branch=main');
      expect(c).toContain('event=push');
      expect(c).toContain('total_count');
    }
  });

  it('pages within a day until a short page', () => {
    const replies = [reply(100, 203), reply(100, 203), reply(3, 203)];
    const calls: string[] = [];
    const got = fetchRuns('o/r', Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), (args) => {
      calls.push(args.join(' '));
      return replies[calls.length - 1] as string;
    });
    expect(got).toHaveLength(203);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('page=3');
  });

  it('a day AT the cap is read whole: ten full pages, then the empty one that ends it', () => {
    let n = 0;
    const got = fetchRuns('o/r', Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), () => (++n <= 10 ? reply(100, FILTERED_QUERY_CAP) : reply(0, FILTERED_QUERY_CAP)));
    expect(got).toHaveLength(FILTERED_QUERY_CAP);
    expect(n).toBe(11);
  });

  it('a source that never returns a short page cannot loop forever: paging stops after the 11th', () => {
    let n = 0;
    const got = fetchRuns('o/r', Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), () => (++n, reply(100, FILTERED_QUERY_CAP)));
    expect(n).toBe(11);
    expect(got).toHaveLength(1100);
  });

  it(`refuses a day over GitHub's ${FILTERED_QUERY_CAP}-result cap rather than count part of it`, () => {
    expect(() => fetchRuns('o/r', Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), () => reply(100, FILTERED_QUERY_CAP + 1))).toThrow(/2026-11-15: 1001 runs, over GitHub's 1000-result cap/);
    // Exactly at the cap is complete and is allowed.
    expect(() => fetchRuns('o/r', Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), () => reply(2, FILTERED_QUERY_CAP))).not.toThrow();
  });
});

describe('fetchRuns: a run seen twice is counted once', () => {
  it('drops a repeated id (a new run shifting the offsets between two pages)', () => {
    const page = (ids: number[]): string => JSON.stringify({ total_count: 150, workflow_runs: ids.map((id) => ({ ...run({}), id })) });
    const first = Array.from({ length: 100 }, (_, i) => i + 1);
    const second = [100, ...Array.from({ length: 49 }, (_, i) => 101 + i)]; // 100 again, then 49 new: 149 distinct
    const replies = [page(first), page(second)];
    let n = 0;
    const got = fetchRuns('o/r', Date.parse('2026-11-15T00:00:00Z'), Date.parse('2026-11-15T12:00:00Z'), () => replies[n++] as string);
    expect(got).toHaveLength(149);
    expect(new Set(got.map((r) => r.id)).size).toBe(149);
  });
});

describe('parseIso', () => {
  it('accepts ISO dates and date-times, with Z or an offset, and returns epoch ms', () => {
    expect(parseIso('2026-11-15T12:00:00Z')).toBe(Date.UTC(2026, 10, 15, 12));
    expect(parseIso('2026-11-15T12:00Z')).toBe(Date.UTC(2026, 10, 15, 12));
    expect(parseIso('2026-11-15T14:00:00+02:00')).toBe(Date.UTC(2026, 10, 15, 12));
    expect(parseIso('2026-11-15T12:00:00.250Z')).toBe(Date.UTC(2026, 10, 15, 12, 0, 0, 250));
    expect(parseIso('2026-11-15')).toBe(Date.UTC(2026, 10, 15));
    expect(parseIso('2028-02-29')).toBe(Date.UTC(2028, 1, 29)); // a real leap day
  });

  it.each([
    ['an RFC 2822 date Date.parse accepts', 'Sun, 15 Nov 2026 12:00:00 GMT'],
    ['a word', 'yesterday'],
    ['an impossible date', '2026-02-30'],
    ['a non-leap 29 February', '2027-02-29'],
    ['month 13', '2026-13-01'],
    ['hour 25', '2026-11-15T25:00:00Z'],
    ['minute 61', '2026-11-15T12:61:00Z'],
    ['no zone on a time', '2026-11-15T12:00:00'],
    ['a slash date', '2026/11/15'],
    ['trailing text', '2026-11-15T12:00:00Z later'],
  ])('rejects %s', (_why, s) => {
    expect(parseIso(s)).toBeNull();
    expect(typeof parseArgs([`--now=${s}`])).toBe('string');
  });
});

describe('parseArgs', () => {
  it('defaults only when an option is absent', () => {
    expect(parseArgs([])).toEqual({ days: 7, now: undefined, repo: undefined });
    expect(parseArgs(['--days=30', '--now=2026-11-15T12:00:00Z', '--repo=o/r'])).toEqual({ days: 30, now: '2026-11-15T12:00:00Z', repo: 'o/r' });
  });

  it.each([['a separated operand', ['--days', '30']], ['a bare --now', ['--now']], ['a bare --repo', ['--repo']], ['a bare --days', ['--days']], ['an empty operand', ['--days=']], ['an unknown flag', ['--week=1']], ['a stray word', ['30']]])(
    'refuses %s instead of defaulting',
    (_why, argv) => {
      expect(typeof parseArgs(argv)).toBe('string');
    }
  );

  it('refuses a days value out of range or not whole, and a now that is not a date', () => {
    for (const bad of ['--days=0', '--days=91', '--days=1.5', '--days=abc']) expect(typeof parseArgs([bad]), bad).toBe('string');
    expect(typeof parseArgs(['--now=yesterday'])).toBe('string');
  });
});
