import { describe, expect, it } from 'vitest';
import { RED_SHARE_TARGET, fetchRuns, ledgerLine, redShare, type WorkflowRun } from './main-red-share';

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

describe('fetchRuns', () => {
  it('asks for ci.yml pushes to main since the day, and pages until a short page', () => {
    const calls: string[][] = [];
    const page = (n: number): string => JSON.stringify({ workflow_runs: Array.from({ length: n }, () => run({})) });
    const replies = [page(100), page(100), page(3)];
    const got = fetchRuns('o/r', NOW - 7 * 86_400_000, (args) => {
      calls.push([...args]);
      return replies[calls.length - 1] as string;
    });
    expect(got).toHaveLength(203);
    expect(calls).toHaveLength(3);
    const first = calls[0].join(' ');
    expect(first).toContain('repos/o/r/actions/workflows/ci.yml/runs');
    expect(first).toContain('branch=main');
    expect(first).toContain('event=push');
    expect(first).toContain('created=>=2026-11-08');
    expect(first).toContain('--jq');
    expect(calls[2].join(' ')).toContain('page=3');
  });
});
