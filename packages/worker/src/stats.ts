import type { D1Like, Env } from './d1';
import { CAMPAIGN_ORDER, MISSION_TARGET_MINUTES } from './campaign-order';
import { STATS_HTML } from './stats-page';
import { verifyAccessJwt } from './access';

export interface StatsFilter {
  since: number;
  tester?: string;
  testersOnly: boolean;
  includeDev: boolean;
}

const TICKS_PER_MINUTE = 20 * 60;
const DAY_MS = 86_400_000;

export function parseFilter(url: URL, now: number): StatsFilter {
  const range = url.searchParams.get('range');
  const since = range === '7d' ? now - 7 * DAY_MS : range === '30d' ? now - 30 * DAY_MS : 0;
  const tester = url.searchParams.get('tester') ?? undefined;
  return { since, tester, testersOnly: url.searchParams.get('who') === 'testers', includeDev: url.searchParams.has('dev') };
}

/** The shared WHERE clause, with its bound values in order. `prefix` (e.g. "e.")
 *  qualifies the column names for a query that joins another table. */
function where(f: StatsFilter, prefix = ''): { sql: string; args: unknown[] } {
  const parts = [`${prefix}t >= ?`];
  const args: unknown[] = [f.since];
  if (!f.includeDev) parts.push(`${prefix}dev = 0`);
  if (f.tester !== undefined) {
    parts.push(`${prefix}tester = ?`);
    args.push(f.tester);
  } else if (f.testersOnly) parts.push(`${prefix}tester IS NOT NULL`);
  return { sql: parts.join(' AND '), args };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function summary(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT player) AS players, COUNT(DISTINCT session) AS sessions,
              SUM(CASE WHEN type = 'heartbeat' THEN 1 ELSE 0 END) AS beats
       FROM events WHERE ${w.sql}`
    )
    .bind(...w.args)
    .first<{ players: number; sessions: number; beats: number | null }>();
  const perPlayer = await db
    .prepare(
      `SELECT player, SUM(CASE WHEN type = 'heartbeat' THEN 1 ELSE 0 END) AS beats,
              COUNT(DISTINCT date(t / 1000, 'unixepoch')) AS days
       FROM events WHERE ${w.sql} GROUP BY player`
    )
    .bind(...w.args)
    .all<{ player: string; beats: number; days: number }>();
  const players = row?.players ?? 0;
  const returnedDay2 = perPlayer.results.filter((r) => r.days >= 2).length;
  return {
    players,
    sessions: row?.sessions ?? 0,
    hoursPlayed: ((row?.beats ?? 0) * 60) / 3600,
    medianMinutesPerPlayer: median(perPlayer.results.map((r) => r.beats)) ?? 0,
    returnedDay2,
    returnRate: players > 0 ? returnedDay2 / players : 0,
  };
}

export async function perDay(db: D1Like, f: StatsFilter) {
  const w = where(f, 'e.');
  const rows = await db
    .prepare(
      `SELECT date(e.t / 1000, 'unixepoch') AS day, COUNT(DISTINCT e.player) AS players,
              COUNT(DISTINCT CASE WHEN date(p.first_seen / 1000, 'unixepoch') = date(e.t / 1000, 'unixepoch') THEN e.player END) AS new
       FROM events e JOIN players p ON p.player = e.player
       WHERE ${w.sql}
       GROUP BY day ORDER BY day`
    )
    .bind(...w.args)
    .all<{ day: string; players: number; new: number }>();
  return rows.results.map((r) => ({ day: r.day, new: r.new, returning: r.players - r.new }));
}

export async function funnel(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const rows = await db
    .prepare(
      `SELECT mission,
              COUNT(DISTINCT CASE WHEN type = 'mission_start' THEN player END) AS started,
              COUNT(DISTINCT CASE WHEN type = 'mission_end' AND json_extract(payload, '$.result') = 'victory' THEN player END) AS won
       FROM events WHERE ${w.sql} AND mission IS NOT NULL GROUP BY mission`
    )
    .bind(...w.args)
    .all<{ mission: string; started: number; won: number }>();
  const by = new Map(rows.results.map((r) => [r.mission, r]));
  return CAMPAIGN_ORDER.map((mission) => ({ mission, started: by.get(mission)?.started ?? 0, won: by.get(mission)?.won ?? 0 }));
}

export async function tutorialFunnel(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const rows = await db
    .prepare(
      `SELECT json_extract(payload, '$.step') AS step, COUNT(DISTINCT player) AS players
       FROM events WHERE ${w.sql} AND type = 'tutorial_step' GROUP BY step ORDER BY step`
    )
    .bind(...w.args)
    .all<{ step: number; players: number }>();
  return rows.results;
}

export async function missions(db: D1Like, f: StatsFilter) {
  const w = where(f);
  const ends = await db
    .prepare(
      `SELECT mission, json_extract(payload, '$.result') AS result, json_extract(payload, '$.cause') AS cause,
              json_extract(payload, '$.tick') AS tick, json_extract(payload, '$.roe') AS roe
       FROM events WHERE ${w.sql} AND type = 'mission_end'`
    )
    .bind(...w.args)
    .all<{ mission: string; result: string; cause: string | null; tick: number; roe: number }>();
  const starts = await db
    .prepare(`SELECT mission, COUNT(*) AS n FROM events WHERE ${w.sql} AND type = 'mission_start' GROUP BY mission`)
    .bind(...w.args)
    .all<{ mission: string; n: number }>();
  const failedObj = await db
    .prepare(
      `SELECT mission, json_extract(payload, '$.objective') AS objective, COUNT(*) AS n
       FROM events WHERE ${w.sql} AND type = 'objective' AND json_extract(payload, '$.status') = 'failed'
       GROUP BY mission, objective ORDER BY n DESC`
    )
    .bind(...w.args)
    .all<{ mission: string; objective: string; n: number }>();
  const attempts = new Map(starts.results.map((r) => [r.mission, r.n]));
  return CAMPAIGN_ORDER.filter((m) => attempts.has(m)).map((mission) => {
    const mine = ends.results.filter((e) => e.mission === mission);
    const wins = mine.filter((e) => e.result === 'victory');
    const causes = new Map<string, number>();
    for (const e of mine) if (e.cause) causes.set(e.cause, (causes.get(e.cause) ?? 0) + 1);
    const topCause = [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      mission,
      attempts: attempts.get(mission) ?? 0,
      wins: wins.length,
      winRate: mine.length ? wins.length / mine.length : null,
      medianWinMinutes: median(wins.map((e) => e.tick / TICKS_PER_MINUTE)),
      targetMinutes: MISSION_TARGET_MINUTES[mission] ?? null,
      topCause,
      meanRoe: mine.length ? mine.reduce((a, e) => a + e.roe, 0) / mine.length : null,
      mostFailedObjective: failedObj.results.find((r) => r.mission === mission)?.objective ?? null,
    };
  });
}

/** Testers are explicitly labelled people, not sandbox/dev traffic to be
 *  filtered out (F4) -- `players.dev` latches via MAX, so a tester who once
 *  opened free-play would otherwise vanish from this list entirely. */
export async function testers(db: D1Like, f: StatsFilter) {
  const rows = await db
    .prepare(
      `SELECT tester, MAX(missions_won) AS missionsWon,
              SUM(seconds_played) / 3600.0 AS hours, MAX(last_seen) AS lastSeen
       FROM players WHERE tester IS NOT NULL AND last_seen >= ?
       GROUP BY tester ORDER BY lastSeen DESC`
    )
    .bind(f.since)
    .all<{ tester: string; missionsWon: number; hours: number; lastSeen: number }>();

  // F5: "furthest won" is the CAMPAIGN_ORDER-highest mission among a tester's
  // own campaign_progress events, not MAX(last_won) (alphabetical, and blind
  // to a later win followed by an earlier replay).
  const progress = await db
    .prepare(`SELECT tester, mission FROM events WHERE type = 'campaign_progress' AND tester IS NOT NULL`)
    .all<{ tester: string; mission: string }>();
  const order = new Map(CAMPAIGN_ORDER.map((m, i) => [m, i]));
  const furthestByTester = new Map<string, string>();
  for (const { tester, mission } of progress.results) {
    const idx = order.get(mission);
    if (idx === undefined) continue;
    const cur = furthestByTester.get(tester);
    if (cur === undefined || idx > (order.get(cur) ?? -1)) furthestByTester.set(tester, mission);
  }

  return rows.results.map((r) => ({ ...r, furthestWon: furthestByTester.get(r.tester) ?? null }));
}

export async function timeline(db: D1Like, tester: string) {
  const rows = await db
    .prepare(
      `SELECT t, type, mission, json_extract(payload, '$.result') AS result, json_extract(payload, '$.tick') AS tick
       FROM events WHERE tester = ? AND type IN ('mission_start', 'mission_end', 'campaign_progress')
       ORDER BY t DESC LIMIT 200`
    )
    .bind(tester)
    .all<{ t: number; type: string; mission: string | null; result: string | null; tick: number | null }>();
  return rows.results;
}

const json = (x: unknown): Response =>
  new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** /stats and /stats/api/*. Access guards this at the edge, and the Worker verifies
 *  the Access JWT itself (`verifyAccessJwt`), failing closed until
 *  ACCESS_TEAM_DOMAIN and ACCESS_AUD are set. */
export async function handleStats(req: Request, env: Env, now: number): Promise<Response> {
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token || !(await verifyAccessJwt(token, env, now)))
    return new Response('Cloudflare Access is not protecting /stats.', { status: 403, headers: { 'cache-control': 'no-store' } });
  const url = new URL(req.url);
  const f = parseFilter(url, now);
  switch (url.pathname) {
    case '/stats':
    case '/stats/':
      return new Response(STATS_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    case '/stats/api/summary':
      return json(await summary(env.DB, f));
    case '/stats/api/per-day':
      return json(await perDay(env.DB, f));
    case '/stats/api/funnel':
      return json({ campaign: await funnel(env.DB, f), tutorial: await tutorialFunnel(env.DB, f) });
    case '/stats/api/missions':
      return json(await missions(env.DB, f));
    case '/stats/api/testers':
      return json(await testers(env.DB, f));
    case '/stats/api/timeline':
      return json(await timeline(env.DB, url.searchParams.get('tester') ?? ''));
    default:
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}
