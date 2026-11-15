// GH-1409 part 2: the share of RED `ci` runs on main over the last N days, for the weekly ledger line.
//
//   npx tsx tools/src/ci/main-red-share.ts [--days=7] [--repo=owner/name] [--now=2026-11-15T12:00:00Z]
//
// Reads the workflow's runs through `gh api` (REST; GraphQL is not used), one query per UTC day (a filtered query is capped at 1,000 results), counts the runs that FINISHED on main, and prints one line:
//
//   CI red share on main, 7 days to 2026-11-15: 2 of 31 finished `ci` runs red (6.5%; target under 3%).
//
// What counts. A run is RED when its conclusion is `failure` or `timed_out`, GREEN when it is `success`. A `cancelled` or `skipped` run is
// neither (a superseded push is not a verdict), and a run still in progress has no conclusion yet. The share is red / (red + green).
// The window is the runs CREATED in the last N days. Pushes to main only (`event=push`): a pull request's red run is not main's.
//
// This is a REPORT. It writes nothing, gates nothing, and the rule that a red main blocks merges is not here (that is the lead's call,
// GH-1378). Exit codes: 0 the line was printed; 2 usage, or `gh` failed (the reason is on stderr).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface WorkflowRun {
  readonly status: string | null;
  readonly conclusion: string | null;
  /** ISO 8601. */
  readonly created_at: string;
  readonly head_branch?: string | null;
  readonly event?: string | null;
}

export interface RedShare {
  readonly red: number;
  readonly green: number;
  /** Cancelled, skipped or unfinished runs in the window: seen, not counted. */
  readonly ignored: number;
  /** red / (red + green), or null when no run finished in the window. */
  readonly share: number | null;
}

/** The target the issue sets: under 3% of finished runs red. */
export const RED_SHARE_TARGET = 0.03;

const DAY_MS = 86_400_000;

/** Counts the runs of `branch` pushes created inside the `days` before `nowMs`. */
export function redShare(runs: readonly WorkflowRun[], nowMs: number, days: number, branch = 'main'): RedShare {
  let red = 0;
  let green = 0;
  let ignored = 0;
  for (const r of runs) {
    if (r.head_branch !== undefined && r.head_branch !== null && r.head_branch !== branch) continue;
    if (r.event !== undefined && r.event !== null && r.event !== 'push') continue;
    const at = Date.parse(r.created_at);
    if (!Number.isFinite(at) || at < nowMs - days * DAY_MS || at > nowMs) continue;
    if (r.status !== 'completed') ignored++;
    else if (r.conclusion === 'failure' || r.conclusion === 'timed_out') red++;
    else if (r.conclusion === 'success') green++;
    else ignored++;
  }
  const done = red + green;
  return { red, green, ignored, share: done === 0 ? null : red / done };
}

/** The ledger line. */
export function ledgerLine(r: RedShare, nowMs: number, days: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const head = `CI red share on main, ${days} days to ${day}:`;
  if (r.share === null) return `${head} no finished \`ci\` run in the window (${r.ignored} cancelled or unfinished).`;
  const pct = (r.share * 100).toFixed(1);
  const verdict = r.share < RED_SHARE_TARGET ? 'inside' : 'over';
  return `${head} ${r.red} of ${r.red + r.green} finished \`ci\` runs red (${pct}%; target under ${RED_SHARE_TARGET * 100}%, ${verdict}).`;
}

function gh(args: readonly string[]): string {
  // A page of 100 full run objects is several MB; the `--jq` below trims it, and the buffer is sized for a page that is not trimmed.
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

/** GitHub answers at most this many results for a filtered query (`branch`, `event`, `created` are filters), however many pages are asked for. */
export const FILTERED_QUERY_CAP = 1000;

/** The UTC dates from the day of `sinceMs` to the day of `untilMs`, inclusive. */
export function utcDays(sinceMs: number, untilMs: number): string[] {
  const days: string[] = [];
  for (let t = Date.parse(new Date(sinceMs).toISOString().slice(0, 10)); t <= untilMs; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/**
 * Every `ci.yml` push run on main created from the day of `sinceMs` to the day of `untilMs`. One query per UTC DAY, a page of 100 at a time:
 * a filtered query returns at most 1,000 results (`FILTERED_QUERY_CAP`) and more pages cannot reach past it, so a wide window in one query
 * would silently count only its newest runs. A day whose `total_count` is over the cap throws, so a share is never computed from part of a day.
 */
export function fetchRuns(repo: string, sinceMs: number, untilMs: number, run: (args: readonly string[]) => string = gh): WorkflowRun[] {
  const out: WorkflowRun[] = [];
  for (const day of utcDays(sinceMs, untilMs)) {
    // A day under the cap fits in 10 pages of 100; the 11th is the guard against a source that never returns a short page.
    for (let page = 1; page <= FILTERED_QUERY_CAP / 100 + 1; page++) {
      const body = run([
        'api', '-X', 'GET', `repos/${repo}/actions/workflows/ci.yml/runs`,
        '-f', 'branch=main', '-f', 'event=push', '-f', `created=${day}`, '-f', 'per_page=100', '-f', `page=${page}`,
        '--jq', '{total_count, workflow_runs: [.workflow_runs[] | {status, conclusion, created_at, head_branch, event}]}',
      ]);
      const parsed = JSON.parse(body) as { total_count?: number; workflow_runs?: WorkflowRun[] };
      if (page === 1 && (parsed.total_count ?? 0) > FILTERED_QUERY_CAP) {
        throw new Error(`${day}: ${parsed.total_count} runs, over GitHub's ${FILTERED_QUERY_CAP}-result cap for a filtered query; the share cannot be computed from part of a day`);
      }
      const runs = parsed.workflow_runs ?? [];
      out.push(...runs);
      if (runs.length < 100) break;
    }
  }
  return out;
}

function repoFromRemote(): string {
  const env = process.env.GITHUB_REPOSITORY;
  if (env) return env;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
  if (!m?.[1]) throw new Error(`cannot read owner/name from the origin URL "${url}"; pass --repo=owner/name`);
  return m[1];
}

export interface Options {
  readonly days: number;
  readonly now: string | undefined;
  readonly repo: string | undefined;
}

/** `--days=N`, `--now=ISO`, `--repo=owner/name`: each needs `=value`. Anything else (a bare `--now`, `--days 30`, an unknown flag) is refused, never defaulted. */
export function parseArgs(argv: readonly string[]): Options | string {
  const seen: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--(days|now|repo)=(.+)$/.exec(a);
    if (m?.[1] === undefined || m[2] === undefined) return `unknown or incomplete option "${a}" (use --days=N, --now=ISO, --repo=owner/name)`;
    seen[m[1]] = m[2];
  }
  const days = Number(seen.days ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > 90) return '--days must be a whole number from 1 to 90';
  if (seen.now !== undefined && !Number.isFinite(Date.parse(seen.now))) return '--now is not a date';
  return { days, now: seen.now, repo: seen.repo };
}

function main(argv: readonly string[]): number {
  const opts = parseArgs(argv);
  if (typeof opts === 'string') {
    console.error(`[main-red-share] ${opts}`);
    return 2;
  }
  const { days } = opts;
  const nowMs = opts.now === undefined ? Date.now() : Date.parse(opts.now);
  try {
    const repo = opts.repo ?? repoFromRemote();
    const runs = fetchRuns(repo, nowMs - days * DAY_MS, nowMs);
    console.log(ledgerLine(redShare(runs, nowMs, days), nowMs, days));
    return 0;
  } catch (e) {
    console.error(`[main-red-share] ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
