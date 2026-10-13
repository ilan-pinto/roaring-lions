/**
 * Daily write budgets in D1 (#559 M-3, M-4). Cloudflare's rate-limit
 * bindings count per minute and per location, which bounds a burst but not a
 * day; D1 Free allows 100,000 rows written a day across everything, so the
 * public endpoints also count their writes per day here, in `rate_day`.
 *
 * An IP is never stored. `ipKey` is HMAC-SHA256(salt, ip), with the salt
 * itself HMAC-SHA256(secret, "rl-ip-salt:<day>") -- a key derived each UTC
 * day from an existing Worker secret -- truncated to 128 bits. Without the
 * secret a row cannot be linked to an address, and a day's keys cannot be
 * linked to the next day's.
 */
import type { D1Like, Env } from './d1';

export const DAY_MS = 86_400_000;
export const dayOf = (now: number): number => Math.floor(now / DAY_MS);

/** The secret the IP salt is derived from: the ticket secret, else the stats
 *  password. Null when neither is set; callers then skip their per-IP count
 *  (the per-minute binding still applies). */
export function ipSecret(env: Env): string | null {
  return env.TICKET_SECRET || env.STATS_PASSWORD || null;
}

async function hmac(key: string | Uint8Array<ArrayBuffer>, msg: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}

export async function ipKey(secret: string, ip: string, now: number): Promise<string> {
  const salt = await hmac(secret, `rl-ip-salt:${dayOf(now)}`);
  const mac = await hmac(salt, ip);
  let bin = '';
  for (const b of mac.subarray(0, 16)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Counts one against `scope`/`key` for today; false, and nothing written,
 *  when today's count has already reached `cap`. One row written when it
 *  counts (the table is WITHOUT ROWID: no second index entry). */
export async function bump(db: D1Like, scope: string, key: string, now: number, cap: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_day (scope, key, day, n) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (scope, key, day) DO UPDATE SET n = n + 1 WHERE rate_day.n < ?4
       RETURNING n`
    )
    .bind(scope, key, dayOf(now), cap)
    .first<{ n: number }>();
  return row !== null;
}

/** Today's count, without counting. */
export async function countToday(db: D1Like, scope: string, key: string, now: number): Promise<number> {
  const row = await db.prepare('SELECT n FROM rate_day WHERE scope = ? AND key = ? AND day = ?').bind(scope, key, dayOf(now)).first<{ n: number }>();
  return row?.n ?? 0;
}

/** The daily cron: counters older than yesterday go. Returns the rows deleted. */
export async function purgeRateDays(db: D1Like, now: number): Promise<number> {
  const gone = await db.prepare('DELETE FROM rate_day WHERE day < ? RETURNING scope').bind(dayOf(now) - 1).all<{ scope: string }>();
  return gone.results.length;
}
