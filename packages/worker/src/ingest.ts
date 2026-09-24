import { isTelemetryEvent, type TelemetryEvent } from '@lions/data/telemetry';
import type { D1Stmt, Env } from './d1';

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 50;
const HEARTBEAT_SECONDS = 60;
const NO_CONTENT = (): Response => new Response(null, { status: 204 });

function originAllowed(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true; // sendBeacon may omit it; the rate limit still applies
  const own = new URL(req.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin === own || extra.includes(origin);
}

/** POST /api/events. Always 204: the game never waits on this and never retries. */
export async function handleIngest(req: Request, env: Env, now: number): Promise<Response> {
  try {
    if (req.method !== 'POST' || !originAllowed(req, env)) return NO_CONTENT();
    const ip = req.headers.get('cf-connecting-ip');
    if (env.INGEST_LIMIT && ip) {
      const { success } = await env.INGEST_LIMIT.limit({ key: ip }); // held in memory by the binding, never stored
      if (!success) return NO_CONTENT();
    }
    const text = await req.text();
    if (text.length > MAX_BODY) return NO_CONTENT();
    const body = JSON.parse(text) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) return NO_CONTENT();
    const events = body.events.filter(isTelemetryEvent);
    if (events.length === 0) return NO_CONTENT();

    const stmts: D1Stmt[] = events.map((e) =>
      env.DB.prepare(
        'INSERT INTO events (type, player, session, tester, build, mission, t, received_at, dev, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(e.type, e.player, e.session, e.tester ?? null, e.build, 'mission' in e ? e.mission : null, e.t, now, e.dev ? 1 : 0, JSON.stringify(e))
    );
    for (const [player, mine] of groupByPlayer(events)) stmts.push(upsertPlayer(env, player, mine));
    await env.DB.batch(stmts);
  } catch {
    /* malformed JSON or a D1 hiccup: dropped, as the client expects */
  }
  return NO_CONTENT();
}

function groupByPlayer(events: TelemetryEvent[]): Map<string, TelemetryEvent[]> {
  const m = new Map<string, TelemetryEvent[]>();
  for (const e of events) m.set(e.player, [...(m.get(e.player) ?? []), e]);
  return m;
}

function upsertPlayer(env: Env, player: string, events: TelemetryEvent[]): D1Stmt {
  const first = Math.min(...events.map((e) => e.t));
  const last = Math.max(...events.map((e) => e.t));
  const seconds = HEARTBEAT_SECONDS * events.filter((e) => e.type === 'heartbeat').length;
  const progress = events.filter((e) => e.type === 'campaign_progress').at(-1);
  const won = progress?.type === 'campaign_progress' ? progress.missionsWon : null;
  const lastWon = progress?.type === 'campaign_progress' ? progress.mission : null;
  const tester = events.find((e) => e.tester !== undefined)?.tester ?? null;
  const dev = events.some((e) => e.dev) ? 1 : 0;
  return env.DB.prepare(
    `INSERT INTO players (player, first_seen, last_seen, seconds_played, missions_won, last_won, tester, dev)
     VALUES (?1, ?2, ?3, ?4, COALESCE(?5, 0), ?6, ?7, ?8)
     ON CONFLICT (player) DO UPDATE SET
       first_seen = MIN(first_seen, excluded.first_seen),
       last_seen = MAX(last_seen, excluded.last_seen),
       seconds_played = seconds_played + excluded.seconds_played,
       missions_won = MAX(missions_won, COALESCE(?5, missions_won)),
       last_won = COALESCE(?6, last_won),
       tester = COALESCE(excluded.tester, tester),
       dev = MAX(dev, excluded.dev)`
  ).bind(player, first, last, seconds, won, lastWon, tester, dev);
}
