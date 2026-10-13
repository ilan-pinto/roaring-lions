import { isTelemetryEvent, type TelemetryEvent } from '@lions/data/telemetry';
import type { D1Like, D1Stmt, Env } from './d1';
import { bump, ipKey, ipSecret } from './rate-day';

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 50;
const HEARTBEAT_SECONDS = 60;
const NO_CONTENT = (): Response => new Response(null, { status: 204 });
/**
 * #559 M-3: requests a day that may write. The game flushes at most every
 * 30 s while something is queued and beats once a minute, so a player sends
 * ~1-2 a minute: 600 is five to ten hours of play from one browser or one
 * address. The global ceiling bounds what any number of addresses can make
 * this endpoint write: each counted request writes ~5 rows (three counters,
 * its batch, the player summary; an account snapshot adds one), so 5,000 is
 * at most ~30,000 of D1 Free's 100,000 a day.
 */
export const INGEST_DAY = { ip: 600, player: 600, global: 5000 } as const;
/** #559 M-3: how long raw events are kept (the feedback tables' own 180 days). */
export const EVENTS_RETENTION_MS = 180 * 86_400_000;

function originAllowed(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return true; // sendBeacon may omit it; the rate limit still applies
  const own = new URL(req.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin === own || extra.includes(origin);
}

/** POST /api/events. Always 204: the game never waits on this and never retries. */
export async function handleIngest(req: Request, env: Env, now: number): Promise<Response> {
  let events: TelemetryEvent[] = [];
  try {
    if (req.method !== 'POST' || !originAllowed(req, env)) return NO_CONTENT();
    const ip = req.headers.get('cf-connecting-ip');
    if (env.INGEST_LIMIT && ip) {
      const { success } = await env.INGEST_LIMIT.limit({ key: ip }); // held in memory by the binding, never stored
      if (!success) return NO_CONTENT();
    }
    // M5: reject on the declared size before reading the body at all, so an
    // oversized request never gets buffered into memory just to be dropped.
    // The header can be absent or lie, so `text.length` below still guards.
    const contentLength = req.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_BODY) return NO_CONTENT();
    const text = await req.text();
    if (text.length > MAX_BODY) return NO_CONTENT();
    const body = JSON.parse(text) as { events?: unknown };
    if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) return NO_CONTENT();
    // One request speaks for one player (#559 M-3): the game only ever sends
    // its own, and a request naming fifty players cost fifty summary upserts.
    const valid = body.events.filter(isTelemetryEvent);
    const player = valid[0]?.player;
    events = valid.filter((e) => e.player === player);
    if (player === undefined || events.length === 0) return NO_CONTENT();
    if (!(await withinBudget(env, req, player, now))) return NO_CONTENT();

    // One row for the whole request: the events as a JSON array (`events_all` expands it).
    const stmts: D1Stmt[] = [
      env.DB.prepare('INSERT INTO event_batch (received_at, player, events) VALUES (?, ?, ?)').bind(now, player, JSON.stringify(events)),
      upsertPlayer(env, player, events),
    ];
    await env.DB.batch(stmts);
  } catch {
    /* malformed JSON or a D1 hiccup: dropped, as the client expects */
  }
  // R-6: its own batch and its own try. A missing `accounts` table (the
  // migration not yet applied) loses this summary and nothing else -- the
  // events above have already committed, and QUERIES.sql rebuilds it.
  try {
    const latest = latestAccountByPlayer(events);
    if (latest.length > 0) await env.DB.batch(latest.map((e) => upsertAccount(env, e)));
  } catch {
    /* summary only */
  }
  return NO_CONTENT();
}

/** The day's budgets, per address (keyed hash), per player and for all
 *  (#559 M-3); the address first, so one address spending its own does not
 *  spend anyone else's. False when any is spent. */
async function withinBudget(env: Env, req: Request, player: string, now: number): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip');
  const secret = ipSecret(env);
  if (ip && secret && !(await bump(env.DB, 'ingest-ip', await ipKey(secret, ip, now), now, INGEST_DAY.ip))) return false;
  if (!(await bump(env.DB, 'ingest-player', player, now, INGEST_DAY.player))) return false;
  return bump(env.DB, 'ingest-all', '', now, INGEST_DAY.global);
}

/** #559 M-3: the daily cron ages raw events out after `EVENTS_RETENTION_MS`,
 *  oldest first, a bounded slice a day so no run can spend the day's D1
 *  writes: up to 2,000 batch rows and 1,000 legacy event rows (each of those
 *  also carries four index entries). Returns the rows deleted. */
export async function purgeEvents(db: D1Like, now: number): Promise<number> {
  const cutoff = now - EVENTS_RETENTION_MS;
  const a = await db.prepare('DELETE FROM event_batch WHERE id IN (SELECT id FROM event_batch ORDER BY id LIMIT 2000) AND received_at < ? RETURNING id').bind(cutoff).all<{ id: number }>();
  const b = await db.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id LIMIT 1000) AND received_at < ? RETURNING id').bind(cutoff).all<{ id: number }>();
  return a.results.length + b.results.length;
}

type AccountEvent = Extract<TelemetryEvent, { type: 'account' }>;

/** The `account` event with the greatest `t` per player, in this request. */
function latestAccountByPlayer(events: TelemetryEvent[]): AccountEvent[] {
  const byPlayer = new Map<string, AccountEvent>();
  for (const e of events) {
    if (e.type !== 'account') continue;
    const cur = byPlayer.get(e.player);
    if (!cur || e.t > cur.t) byPlayer.set(e.player, e);
  }
  return [...byPlayer.values()];
}

function upsertAccount(env: Env, e: AccountEvent): D1Stmt {
  return env.DB.prepare(
    `INSERT INTO accounts (player, t, credits, earned, unlocks, tiers, tester, dev)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (player) DO UPDATE SET
       t = excluded.t, credits = excluded.credits, earned = excluded.earned,
       unlocks = excluded.unlocks, tiers = excluded.tiers,
       tester = COALESCE(excluded.tester, accounts.tester),
       dev = MAX(accounts.dev, excluded.dev)
     WHERE excluded.t >= accounts.t`
  ).bind(e.player, e.t, e.credits, e.earned, JSON.stringify(e.unlocks), JSON.stringify(e.tiers), e.tester ?? null, e.dev ? 1 : 0);
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
