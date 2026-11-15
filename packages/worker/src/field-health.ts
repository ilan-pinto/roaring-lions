/**
 * GH-1410: the `/stats` field-health panels, read from `client_error`, `perf_sample` and `boot` events.
 *
 *  - crash-free session rate: of the sessions that sent anything in the window, the share that sent no `client_error`;
 *  - the commonest crashes, by stack hash;
 *  - frame-time percentiles by GPU family: the median of the samples' own p50 / p95 / p99, grouped by the family the client sent;
 *  - the median time to first frame.
 *
 * Reads `events_all` through the same filter every other panel uses (`StatsFilter`: the window, the tester, dev traffic out). It stores
 * nothing and joins nothing: an event carries no IP, email or user agent to begin with.
 */
import type { D1Like } from './d1';
import type { StatsFilter } from './stats';

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const tenth = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

function where(f: StatsFilter): { sql: string; args: unknown[] } {
  const parts = ['t >= ?'];
  const args: unknown[] = [f.since];
  if (!f.includeDev) parts.push('dev = 0');
  if (f.tester !== undefined) {
    parts.push('tester = ?');
    args.push(f.tester);
  } else if (f.testersOnly) parts.push('tester IS NOT NULL');
  return { sql: parts.join(' AND '), args };
}

/** The most rows a panel reads; the page says so when it was reached. */
export const HEALTH_ROW_CAP = 20_000;

interface PayloadRow {
  session: string;
  payload: string;
}

function parse(row: PayloadRow): Record<string, unknown> | null {
  try {
    const x = JSON.parse(row.payload) as unknown;
    return typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null;
  } catch {
    return null; // a row ingest could never have written, but the panel must not 500 over it
  }
}

export async function fieldHealth(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const counts = await db
    .prepare(
      `SELECT COUNT(DISTINCT session) AS sessions,
              COUNT(DISTINCT CASE WHEN type = 'client_error' THEN session END) AS crashed
       FROM events_all WHERE ${w.sql}`
    )
    .bind(...w.args)
    .first<{ sessions: number; crashed: number }>();
  const sessions = counts?.sessions ?? 0;
  const crashedSessions = counts?.crashed ?? 0;

  const errRows = await db
    .prepare(`SELECT session, payload FROM events_all WHERE ${w.sql} AND type = 'client_error' LIMIT ${HEALTH_ROW_CAP}`)
    .bind(...w.args)
    .all<PayloadRow>();
  const byHash = new Map<string, { hash: string; name: string; message: string; count: number; sessions: Set<string> }>();
  for (const r of errRows.results) {
    const p = parse(r);
    if (p === null || typeof p.hash !== 'string') continue;
    let a = byHash.get(p.hash);
    if (!a) {
      a = { hash: p.hash, name: String(p.name ?? ''), message: String(p.message ?? ''), count: 0, sessions: new Set() };
      byHash.set(p.hash, a);
    }
    a.count++;
    a.sessions.add(r.session);
  }
  const topErrors = [...byHash.values()]
    .sort((a, b) => b.sessions.size - a.sessions.size || b.count - a.count || a.hash.localeCompare(b.hash))
    .slice(0, 10)
    .map((a) => ({ hash: a.hash, name: a.name, message: a.message, count: a.count, sessions: a.sessions.size }));

  const perfRows = await db
    .prepare(`SELECT session, payload FROM events_all WHERE ${w.sql} AND type = 'perf_sample' LIMIT ${HEALTH_ROW_CAP}`)
    .bind(...w.args)
    .all<PayloadRow>();
  const fam = new Map<string, { p50: number[]; p95: number[]; p99: number[]; units: number[]; sessions: Set<string> }>();
  for (const r of perfRows.results) {
    const p = parse(r);
    if (p === null || typeof p.p50 !== 'number' || typeof p.p95 !== 'number' || typeof p.p99 !== 'number') continue;
    // The client sends the FAMILY (`gpuFamily`, `@lions/data`); an event without one is Unknown.
    const key = typeof p.gpu === 'string' && p.gpu !== '' ? p.gpu : 'Unknown';
    let a = fam.get(key);
    if (!a) {
      a = { p50: [], p95: [], p99: [], units: [], sessions: new Set() };
      fam.set(key, a);
    }
    a.p50.push(p.p50);
    a.p95.push(p.p95);
    a.p99.push(p.p99);
    if (typeof p.units === 'number') a.units.push(p.units);
    a.sessions.add(r.session);
  }
  const frames = [...fam.entries()]
    .map(([family, a]) => ({
      family,
      samples: a.p50.length,
      sessions: a.sessions.size,
      p50: tenth(median(a.p50)),
      p95: tenth(median(a.p95)),
      p99: tenth(median(a.p99)),
      medianUnits: median(a.units),
    }))
    .sort((a, b) => b.samples - a.samples || a.family.localeCompare(b.family));

  const bootRows = await db
    .prepare(`SELECT session, payload FROM events_all WHERE ${w.sql} AND type = 'boot' LIMIT ${HEALTH_ROW_CAP}`)
    .bind(...w.args)
    .all<PayloadRow>();
  const ttff: number[] = [];
  for (const r of bootRows.results) {
    const p = parse(r);
    if (p !== null && typeof p.ttffMs === 'number') ttff.push(p.ttffMs);
  }

  return {
    sessions,
    crashedSessions,
    crashFreeRate: sessions === 0 ? null : (sessions - crashedSessions) / sessions,
    topErrors,
    frames,
    boot: { n: ttff.length, medianMs: median(ttff), p95Ms: ttff.length === 0 ? null : [...ttff].sort((a, b) => a - b)[Math.min(ttff.length - 1, Math.ceil(0.95 * ttff.length) - 1)] },
    capped: errRows.results.length >= HEALTH_ROW_CAP || perfRows.results.length >= HEALTH_ROW_CAP || bootRows.results.length >= HEALTH_ROW_CAP,
  };
}
