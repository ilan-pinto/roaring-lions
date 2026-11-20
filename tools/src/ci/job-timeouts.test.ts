// GH-1409: every job in every workflow carries `timeout-minutes`. A job with none runs to GitHub's 6-hour default, so a hang that
// vitest's own timeout cannot stop (a synchronous loop in `pnpm test`) holds a runner for six hours and the run stays "in progress"
// instead of going red. These pins read the workflow files straight off disk, so the text tested is the text CI runs.
//
// Two kinds of check:
//  - EVERY job in `.github/workflows/*.yml` declares an integer `timeout-minutes` between 1 and CEILING_MINUTES (nothing here needs
//    the 6 h default, and the longest job we run is the 240 min nightly);
//  - each `ci.yml` job is not sized below its measured worst case. The floors are LITERALS: the slowest of the last 20 completed
//    `ci` runs on 19 Nov 2026 (gates 81, visual 93, visual-backends 44, visual-parity 35, memory 23, determinism 3, version 1,
//    changes under 1), scaled by FLOOR_MARGIN. A timeout under that would cut a healthy run.
//
// The parser is line based, like concurrency.test.ts: workflow files here are plain block YAML, and a job is a two-space key under
// `jobs:`; its own fields sit at four spaces. A step's `timeout-minutes` sits at eight spaces and does NOT count for the job.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOWS = new URL('../../../.github/workflows/', import.meta.url);

/** The longest a job may be allowed to run: 4 hours, the nightly's own number. */
const CEILING_MINUTES = 240;
/** A ci.yml timeout must be at least this multiple of the slowest healthy run. */
const FLOOR_MARGIN = 1.25;

interface JobTimeout {
  readonly job: string;
  /** The job-level `timeout-minutes` text after the colon, or null when the job has none. */
  readonly raw: string | null;
}

/** Every job of a workflow file's text, with its own job-level `timeout-minutes` (not a step's). */
function jobTimeouts(text: string): JobTimeout[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const out: { job: string; raw: string | null }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key ends the `jobs:` block
    const job = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line)?.[1];
    if (job) {
      out.push({ job, raw: null });
      continue;
    }
    const t = /^ {4}timeout-minutes:\s*(.*?)\s*(#.*)?$/.exec(line);
    const last = out[out.length - 1];
    if (t && last && last.raw === null) last.raw = t[1] ?? '';
  }
  return out;
}

/** The problem with one job's timeout, or null when it is acceptable. */
function timeoutProblem(raw: string | null): string | null {
  if (raw === null) return 'has no job-level timeout-minutes';
  if (!/^\d+$/.test(raw)) return `timeout-minutes is "${raw}", not a plain integer`;
  const n = Number(raw);
  if (n < 1) return `timeout-minutes ${n} is below 1`;
  if (n > CEILING_MINUTES) return `timeout-minutes ${n} is above the ${CEILING_MINUTES} min ceiling`;
  return null;
}

const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();

describe('every workflow job has a timeout', () => {
  it('the workflow directory is not empty and every file lists at least one job', () => {
    expect(files).toContain('ci.yml');
    for (const f of files) {
      const jobs = jobTimeouts(readFileSync(new URL(f, WORKFLOWS), 'utf8'));
      expect(jobs.length, `${f} lists no jobs: the parser is blind to it`).toBeGreaterThan(0);
    }
  });

  for (const f of files) {
    it(`${f}: every job declares a sane job-level timeout-minutes`, () => {
      const jobs = jobTimeouts(readFileSync(new URL(f, WORKFLOWS), 'utf8'));
      const bad = jobs.flatMap((j) => {
        const p = timeoutProblem(j.raw);
        return p ? [`${f}: job "${j.job}" ${p}`] : [];
      });
      expect(bad).toEqual([]);
    });
  }
});

describe('ci.yml jobs are not sized below their measured worst case', () => {
  // Slowest healthy run of the last 20 completed `ci` runs, minutes (19 Nov 2026). Literals, never read from the file under test.
  const SLOWEST: Record<string, number> = {
    gates: 81,
    visual: 93,
    'visual-backends': 44,
    'visual-parity': 35,
    memory: 23,
    determinism: 3,
    changes: 1,
    version: 1,
  };

  it('ci.yml has exactly the eight jobs the table knows', () => {
    const jobs = jobTimeouts(readFileSync(new URL('ci.yml', WORKFLOWS), 'utf8')).map((j) => j.job);
    expect([...jobs].sort()).toEqual(Object.keys(SLOWEST).sort());
  });

  for (const [job, slowest] of Object.entries(SLOWEST)) {
    it(`${job}: timeout is at least ${FLOOR_MARGIN}x the slowest run (${slowest} min)`, () => {
      const found = jobTimeouts(readFileSync(new URL('ci.yml', WORKFLOWS), 'utf8')).find((j) => j.job === job);
      expect(found, `${job} not found in ci.yml`).toBeDefined();
      expect(timeoutProblem(found?.raw ?? null)).toBeNull();
      expect(Number(found?.raw)).toBeGreaterThanOrEqual(Math.ceil(slowest * FLOOR_MARGIN));
    });
  }
});

describe('the parser itself (literal workflow text)', () => {
  const ok = ['name: x', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    timeout-minutes: 30', '    steps:', '      - run: x', '        timeout-minutes: 5', '  b:', '    runs-on: ubuntu-latest'].join('\n');

  it('reads a job-level timeout and ignores a step-level one', () => {
    expect(jobTimeouts(ok)).toEqual([
      { job: 'a', raw: '30' },
      { job: 'b', raw: null },
    ]);
  });

  it('a job whose only timeout is on a step has none', () => {
    const t = ['jobs:', '  a:', '    runs-on: x', '    steps:', '      - run: x', '        timeout-minutes: 5'].join('\n');
    expect(jobTimeouts(t)).toEqual([{ job: 'a', raw: null }]);
  });

  it('a top-level key after jobs: ends the block', () => {
    const t = ['jobs:', '  a:', '    timeout-minutes: 9', 'env:', '  b:', '    timeout-minutes: 1'].join('\n');
    expect(jobTimeouts(t)).toEqual([{ job: 'a', raw: '9' }]);
  });

  it('the problem text names each failure', () => {
    expect(timeoutProblem(null)).toMatch(/no job-level/);
    expect(timeoutProblem('${{ fromJSON(x) }}')).toMatch(/not a plain integer/);
    expect(timeoutProblem('0')).toMatch(/below 1/);
    expect(timeoutProblem('360')).toMatch(/above the 240/);
    expect(timeoutProblem('240')).toBeNull();
    expect(timeoutProblem('1')).toBeNull();
  });
});
